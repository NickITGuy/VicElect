import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { DistrictCount, Editorial, Election, ResultEvent, Seat } from '../src/election.ts';
import { districts, seatCandidates } from '../src/election.ts';
import type { Snapshot } from './vec.ts';

const dataDirectory = process.env.DATA_DIRECTORY || '.data';
mkdirSync(dataDirectory, { recursive: true });
const db = new DatabaseSync(join(dataDirectory, 'election.sqlite'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS feed (id INTEGER PRIMARY KEY CHECK (id = 1), filename TEXT, snapshot TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS editorial (district TEXT PRIMARY KEY, state TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY, district TEXT NOT NULL, at TEXT NOT NULL, kind TEXT NOT NULL,
    delta INTEGER NOT NULL, candidate TEXT
  );
  CREATE INDEX IF NOT EXISTS events_district ON events (district, id DESC);
`);

const getFeed = db.prepare('SELECT filename, snapshot FROM feed WHERE id = 1');
const putFeed = db.prepare('INSERT OR REPLACE INTO feed (id, filename, snapshot) VALUES (1, ?, ?)');
const putEditorial = db.prepare('INSERT OR REPLACE INTO editorial (district, state) VALUES (?, ?)');
const addEvent = db.prepare('INSERT INTO events (district, at, kind, delta, candidate) VALUES (?, ?, ?, ?, ?)');

let cachedRaw: string | undefined;
let cachedSnapshot: Snapshot | null = null;

function currentFeed() {
  const row = getFeed.get();
  const raw = typeof row?.snapshot === 'string' ? row.snapshot : undefined;
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedSnapshot = raw ? JSON.parse(raw) as Snapshot : null;
  }
  return { filename: typeof row?.filename === 'string' ? row.filename : null, snapshot: cachedSnapshot };
}

export function latestFilename() {
  return currentFeed().filename;
}

function changes<T>(work: () => T) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function signature(count: DistrictCount | undefined) {
  const totals = count?.candidates.filter(row => row.votes).map(row => row.key + ':' + row.votes).sort();
  return JSON.stringify([totals ?? [], count?.formal ?? 0, count?.informal ?? 0]);
}

function preferredSignature(count: DistrictCount | undefined) {
  if (!count?.masked && !count?.preferred.some(row => row.votes)) return '';
  return JSON.stringify([count.masked, count.preferred.map(row => row.key + ':' + row.votes).sort()]);
}

export function storeSnapshot(filename: string | null, snapshot: Snapshot) {
  return changes(() => {
    const previous = currentFeed().snapshot;
    if (previous && previous.publishedAt >= snapshot.publishedAt) return false;
    putFeed.run(filename, JSON.stringify({
      publishedAt: snapshot.publishedAt,
      districts: { ...previous?.districts, ...snapshot.districts },
    } satisfies Snapshot));
    for (const [id, { count }] of Object.entries(snapshot.districts)) {
      const before = previous?.districts[id]?.count;
      const at = count.updated ?? snapshot.publishedAt;
      if (signature(count) !== signature(before)) {
        const delta = count.formal + count.informal - (before?.formal ?? 0) - (before?.informal ?? 0);
        addEvent.run(id, at, 'votes', delta, null);
      } else if (preferredSignature(count) !== preferredSignature(before)) {
        addEvent.run(id, at, 'preferred', 0, null);
      }
      if (count.elected && count.elected !== before?.elected) {
        addEvent.run(id, at, 'declared', 0, count.candidates.find(candidate => candidate.key === count.elected)?.name ?? null);
      }
    }
    return true;
  });
}

export function getElection(feed: Election['feed']): Election {
  const snapshot = currentFeed().snapshot;
  const editorial = new Map(db.prepare('SELECT district, state FROM editorial').all()
    .map(row => [String(row.district), JSON.parse(String(row.state)) as Editorial]));
  const last = new Map(db.prepare(`
    SELECT event.district, event.at FROM events event JOIN
      (SELECT district, MAX(id) AS id FROM events WHERE kind IN ('votes', 'preferred') GROUP BY district) latest
      ON latest.id = event.id
  `).all().map(row => [String(row.district), String(row.at)]));
  const seats = Object.fromEntries(districts.map(({ id }) => [id, {
    id, count: snapshot?.districts[id]?.count ?? null,
    editorial: editorial.get(id) ?? { pair: null, winner: null, calledAt: null },
    updated: last.get(id) ?? null,
  } satisfies Seat]));
  const events = db.prepare('SELECT id, district, at, kind, delta, candidate FROM events ORDER BY at DESC, id DESC LIMIT 100').all() as ResultEvent[];
  return { seats, events, publishedAt: snapshot?.publishedAt ?? null, feed };
}

export function getBreakdown(id: string) {
  return currentFeed().snapshot?.districts[id]?.breakdown ?? null;
}

export function setEditorial(id: string, changeset: Partial<Pick<Editorial, 'winner' | 'pair'>>) {
  return changes(() => {
    const district = districts.find(district => district.id === id);
    if (!district) return false;
    const snapshot = currentFeed().snapshot;
    const count = snapshot?.districts[id]?.count ?? null;
    const previous = db.prepare('SELECT state FROM editorial WHERE district = ?').get(id);
    const state: Editorial = previous ? JSON.parse(String(previous.state)) : { winner: null, pair: null, calledAt: null };
    const candidates = seatCandidates(district, { id, count, editorial: state, updated: null });
    const available = new Map(candidates.map(candidate => [candidate.key, candidate.name]));
    if ((changeset.winner && (!available.has(changeset.winner) || count?.elected)) ||
      changeset.pair?.some(key => !available.has(key))) return false;
    const next = { ...state, ...changeset };
    if (next.winner !== state.winner) {
      const now = new Date().toISOString();
      next.calledAt = next.winner ? now : null;
      addEvent.run(id, now, next.winner ? 'called' : 'uncalled', 0, next.winner ? available.get(next.winner) ?? null : null);
    }
    putEditorial.run(id, JSON.stringify(next));
    return true;
  });
}
