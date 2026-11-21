import districtData from './data/districts.json' with { type: 'json' };

export const pollsClose = Date.parse('2026-11-28T18:00:00+11:00');
export const majority = 45;
export const timeZone = 'Australia/Melbourne';
export const vec = {
  election: 'https://www.vec.vic.gov.au/voting/2026-state-election',
  candidates: 'https://www.vec.vic.gov.au/voting/2026-state-election/find-candidates',
  archive: 'https://www.vec.vic.gov.au/results/state-election-results/2022-state-election-results',
  feed: 'https://www.vec.vic.gov.au/about-us/media/2026-results-data-feed',
  boundaries: 'https://discover.data.vic.gov.au/dataset/vicmap-admin-state-assembly-polygon-2022',
};

export function slug(name: string) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
}

export function candidateKey(name: string) {
  return name.toLowerCase().normalize('NFKC').replace(/[\s\u2018\u2019'.,-]+/g, '');
}

export function candidateName(name: string) {
  const [surname, given] = name.split(',').map(part => part.trim());
  if (!given) return name;
  const displaySurname = surname === surname.toUpperCase() ? surname.toLocaleLowerCase('en-AU')
    .replace(/(^|[\s'’-])\p{L}/gu, initial => initial.toLocaleUpperCase('en-AU'))
    .replace(/\bMc(\p{L})/gu, (_, initial: string) => 'Mc' + initial.toUpperCase()) : surname;
  return given + ' ' + displaySurname;
}

export const parties = {
  labor: { label: 'Labor', color: '#ff6268' },
  coalition: { label: 'Coalition', color: '#689cff' },
  greens: { label: 'Greens', color: '#5bd196' },
  other: { label: 'Other', color: '#d7a9ff' },
  pending: { label: 'Uncalled', color: '#32373b' },
};
export type Party = keyof typeof parties;

export function partyGroup(party: string): Exclude<Party, 'pending'> {
  const name = party.toLowerCase().trim();
  if (/^(australian labor party|labor$)/.test(name)) return 'labor';
  if (/^(liberal party of australia|liberal$|national party of australia|(?:the )?nationals?(?: victoria)?$|the nationals -)/.test(name)) return 'coalition';
  if (name.includes('australian greens') || name === 'greens') return 'greens';
  return 'other';
}

export function partyLabel(party: string) {
  if (partyGroup(party) === 'coalition') return /national/i.test(party) ? 'Nationals' : 'Liberal';
  if (partyGroup(party) === 'labor') return 'Labor';
  if (partyGroup(party) === 'greens') return 'Greens';
  if (/one nation/i.test(party)) return 'One Nation';
  return party;
}

export type Candidate = { key: string; name: string; party: string; position: number; votes: number | null };
export type PreferredVote = { key: string; votes: number };
export type Pair = [string, string];
export type Editorial = { winner: string | null; pair: Pair | null; calledAt: string | null };
export type DistrictCount = {
  candidates: Candidate[];
  formal: number;
  informal: number;
  enrolment: number;
  returned: number;
  expected: number;
  declared: boolean;
  elected: string | null;
  preferred: PreferredVote[];
  masked: boolean;
  updated: string | null;
};
export type Breakdown = {
  types: { type: string; formal: number; informal: number }[];
  centres: { id: string; name: string; type: string; formal: number; informal: number }[];
};
export type District = typeof districtData[number];
export const districts = districtData;
export type Seat = {
  id: string;
  count: DistrictCount | null;
  editorial: Editorial;
  updated: string | null;
};
export type ResultEvent = {
  id: number;
  district: string;
  at: string;
  kind: 'votes' | 'preferred' | 'called' | 'uncalled' | 'declared';
  delta: number;
  candidate: string | null;
};
export type Election = {
  seats: Record<string, Seat>;
  events: ResultEvent[];
  publishedAt: string | null;
  feed: 'unconfigured' | 'waiting' | 'connected' | 'delayed';
};

export function seatCandidates(district: District, seat?: Seat): Candidate[] {
  return seat?.count?.candidates ?? district.candidates.map(candidate => ({
    ...candidate, key: candidateKey(candidate.name), votes: null,
  }));
}

export function winnerFor(seat?: Seat) {
  return seat?.count?.elected ?? seat?.editorial.winner ?? null;
}

export function preferredFor(seat?: Seat) {
  const votes = seat?.count?.preferred ?? [];
  const pair = seat?.editorial.pair;
  if (!pair) return votes;
  const first = votes.find(entry => entry.key === pair[0]);
  const second = votes.find(entry => entry.key === pair[1]);
  return first && second ? [first, second] : [];
}

export function laborSwing(district: District, seat?: Seat) {
  const preferred = preferredFor(seat);
  if (preferred.length !== 2 || district.history.labor === null) return null;
  const candidates = seatCandidates(district, seat);
  const group = (key: string) => partyGroup(candidates.find(candidate => candidate.key === key)?.party ?? '');
  const labor = preferred.find(row => group(row.key) === 'labor');
  const coalition = preferred.find(row => group(row.key) === 'coalition');
  if (!labor || !coalition || labor.votes + coalition.votes === 0) return null;
  return 100 * labor.votes / (labor.votes + coalition.votes) - district.history.labor;
}
