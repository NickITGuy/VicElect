import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { strFromU8, unzipSync } from 'fflate';
import { candidateKey, districts, pollsClose, slug } from '../src/election.ts';
import type { Breakdown, DistrictCount } from '../src/election.ts';

type Xml = { [key: string]: XmlValue };
type XmlValue = Xml | string | XmlValue[] | undefined;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  parseTagValue: false,
  processEntities: true,
});
const fileName = /^State2026mediafileverboselhv2_\d{8}_\d{6}\.zip$/i;
const maxZipBytes = 12_000_000;
const maxXmlBytes = 32_000_000;
const validDistricts = new Set(districts.map(district => district.id));

function object(value: XmlValue): Xml {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function items(value: XmlValue): Xml[] {
  return value === undefined || value === '' ? [] : (Array.isArray(value) ? value : [value]).map(object);
}

function content(value: XmlValue): string {
  return typeof value === 'string' ? value : typeof object(value)['#text'] === 'string'
    ? String(object(value)['#text']) : '';
}

function number(value: XmlValue) {
  const input = content(value);
  if (input === '') return 0;
  const result = Number(input);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('VEC feed contains an invalid vote total');
  return result;
}

function timestamp(value: XmlValue) {
  const input = content(value);
  if (!input) return null;
  // The root timestamp omits the offset in the VEC samples. State election counts fall in AEDT.
  const date = new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(input) ? input : input + '+11:00');
  if (Number.isNaN(date.getTime())) throw new Error('VEC feed contains an invalid timestamp');
  return date.toISOString();
}

export type Snapshot = {
  publishedAt: string;
  districts: Record<string, { count: DistrictCount; breakdown: Breakdown }>;
};

export function parseSnapshot(bytes: Uint8Array, sample = false): Snapshot {
  if (bytes.length > maxZipBytes) throw new Error('VEC archive exceeds size limit');
  const [payload, extra] = Object.values(unzipSync(bytes, {
    filter: file => file.name.toLowerCase().endsWith('.xml') && file.originalSize <= maxXmlBytes,
  }));
  if (!payload || extra) throw new Error('VEC archive must contain one results XML');

  const xml = strFromU8(payload);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('Invalid VEC XML');
  const feed = object((parser.parse(xml) as Xml).MediaFeed);
  const eventName = content(object(feed.EventIdentifier).EventName);
  const election = object(feed.Election);
  const electionName = content(object(election.ElectionIdentifier).ElectionName);
  const publishedAt = timestamp(feed['@Created']);
  if (
    !publishedAt || !/2026/.test(eventName) || !/\bstate\b/i.test(eventName) ||
    (!sample && (/test|trial/i.test(eventName + ' ' + electionName) || Date.parse(publishedAt) < pollsClose)) ||
    content(feed['@Verbose']) !== 'true' || content(object(election.ElectionIdentifier)['@Id']) !== 'L'
  ) throw new Error('Expected a production 2026 VEC Verbose Lower House snapshot');

  const results: Snapshot['districts'] = {};
  for (const contest of items(object(object(election.House).Contests).Contest)) {
    const name = content(object(contest.ContestIdentifier).ContestName).replace(/ District$/i, '');
    const id = slug(name);
    if (!validDistricts.has(id) || Object.hasOwn(results, id)) throw new Error('Unknown or duplicate district in VEC snapshot');
    const first = object(contest.FirstPreferences);
    const officialCandidates = items(first.Candidate).map(row => {
      const identifier = object(row.CandidateIdentifier);
      const candidate = content(identifier.CandidateName);
      const affiliation = object(object(row.Affiliation).AffiliationIdentifier);
      return {
        officialId: content(identifier['@Id']),
        elected: content(row.Elected) === 'true',
        key: candidateKey(candidate),
        name: candidate,
        party: content(affiliation.RegisteredName) || 'Independent',
        votes: number(row.Votes),
        position: number(row.BallotPosition),
      };
    });
    const keys = new Map(officialCandidates.map(row => [row.officialId, row.key]));
    if (!keys.size) continue;
    if (keys.has('') || keys.size !== officialCandidates.length ||
      new Set(keys.values()).size !== keys.size || [...keys.values()].includes('')) {
      throw new Error('Invalid candidate identifiers in VEC snapshot');
    }
    const formal = object(first.Formal);
    const informal = object(first.Informal);
    const two = object(contest.TwoCandidatePreferred);
    const masked = content(two['@Maverick']) === 'true';
    const preferred = masked ? [] : items(two.Candidate).map(row => ({
      key: keys.get(content(object(row.CandidateIdentifier)['@Id'])),
      votes: number(row.Votes),
    }));
    if (preferred.some(row => !row.key) || (preferred.length > 0 && (preferred.length !== 2 || preferred[0].key === preferred[1].key))) {
      throw new Error('Invalid 2CP candidate identifiers in VEC snapshot');
    }
    const declared = content(contest.Declared) === 'true';
    const types = new Map<string, Breakdown['types'][number]>();
    for (const [category, totals] of [['formal', formal], ['informal', informal]] as const) {
      for (const entry of items(object(totals.VotesByType).Votes)) {
        const type = content(entry['@Type']);
        if (!type) continue;
        const row = types.get(type) ?? { type, formal: 0, informal: 0 };
        row[category] = number(entry);
        types.set(type, row);
      }
    }
    const centres = items(object(contest.PollingPlaces).PollingPlace).map(row => {
      const centre = object(row.PollingPlaceIdentifier);
      const first = object(row.FirstPreferences);
      return {
        id: content(centre['@Id']), name: content(centre['@Name']), type: content(centre['@Classification']),
        formal: number(object(first.Formal).Votes), informal: number(object(first.Informal).Votes),
      };
    }).filter(row => row.formal + row.informal > 0);
    results[id] = {
      count: {
        candidates: officialCandidates.map(({ key, name, party, position, votes }) => ({ key, name, party, position, votes })),
        formal: number(formal.Votes), informal: number(informal.Votes), enrolment: number(contest.Enrolment),
        returned: number(first['@PollingPlacesReturned']), expected: number(first['@PollingPlacesExpected']),
        declared, elected: declared ? officialCandidates.find(row => row.elected)?.key ?? null : null,
        preferred: preferred.flatMap(row => row.key ? [{ key: row.key, votes: row.votes }] : []),
        masked,
        updated: timestamp(contest['@Updated']),
      },
      breakdown: { types: [...types.values()], centres },
    };
  }
  if (!Object.keys(results).length) throw new Error('VEC snapshot has no district counts');
  return { publishedAt, districts: results };
}

const { VEC_FEED_DIRECTORY: directory, VEC_FEED_LIST_URL: listing, VEC_FEED_SNAPSHOT_URL: snapshotUrl, VEC_FEED_BEARER_TOKEN: bearer } = process.env;
export const feedConfigured = Boolean(directory || listing || snapshotUrl);

async function download(url: URL, limit: number) {
  if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('VEC feed requires HTTPS');
  const response = await fetch(url, {
    headers: bearer ? { Authorization: 'Bearer ' + bearer } : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok || !response.body) throw new Error('VEC HTTP ' + response.status);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > limit) {
      await reader.cancel();
      throw new Error('VEC response exceeds size limit');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, bytes);
}

export async function latestSnapshot(previousFile: string | null) {
  if (directory) {
    const name = (await readdir(directory)).filter(name => fileName.test(name)).sort().at(-1);
    if (!name || name === previousFile) return null;
    return { name, snapshot: parseSnapshot(await readFile(join(directory, name))) };
  }
  if (snapshotUrl) return { name: null, snapshot: parseSnapshot(await download(new URL(snapshotUrl), maxZipBytes)) };
  if (!listing) return null;

  const listUrl = new URL(listing);
  const body = (await download(listUrl, 8_000_000)).toString('utf8');
  const entries = new Map<string, URL>();
  const hrefs = [...body.matchAll(/href=["']([^"']+)["']/gi)].map(match => match[1].replaceAll('&amp;', '&'));
  for (const href of hrefs) {
    const url = new URL(href, listUrl);
    const name = decodeURIComponent(url.pathname.split('/').at(-1) ?? '');
    if (url.origin === listUrl.origin && fileName.test(name)) entries.set(name, url);
  }
  // Azure blob listings provide file names in Name elements. Keep the SAS query and drop listing parameters.
  for (const [, path] of body.matchAll(/<Name>([^<]+)<\/Name>/gi)) {
    const name = path.split('/').at(-1) ?? '';
    if (!fileName.test(name) || entries.has(name)) continue;
    const url = new URL(listUrl);
    url.pathname = url.pathname.replace(/\/$/, '') + '/' + path.split('/').map(encodeURIComponent).join('/');
    for (const parameter of ['restype', 'comp', 'prefix', 'delimiter', 'maxresults', 'marker', 'include']) url.searchParams.delete(parameter);
    entries.set(name, url);
  }
  const name = [...entries.keys()].sort().at(-1);
  if (!name) throw new Error('No VEC Verbose Lower House snapshots in feed listing');
  if (name === previousFile) return null;
  const url = entries.get(name)!;
  return { name, snapshot: parseSnapshot(await download(url, maxZipBytes)) };
}
