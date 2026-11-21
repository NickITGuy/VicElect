import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Activity, ArrowDownRight, ArrowLeft, ArrowUpRight, CalendarClock, ChevronRight, Map, Search } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { candidateName, districts, laborSwing, majority, parties, partyGroup, partyLabel, pollsClose, preferredFor, seatCandidates, timeZone, vec, winnerFor } from './election.ts';
import type { Breakdown, District, Election, Party, ResultEvent, Seat } from './election.ts';
import { request } from './api.ts';

const blocks = ['labor', 'coalition', 'greens', 'other', 'pending'] satisfies Party[];
const number = new Intl.NumberFormat('en-AU');
const clock = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone });
const date = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', timeZone });
const percent = (part: number, total: number) => total ? (part * 100 / total).toFixed(1) + '%' : '—';
const voteType: Record<string, string> = {
  Ordinary: 'Election day', EVCEarly: 'Early voting centres', MobileVotingEarly: 'Mobile voting',
  Postal: 'Postal', Early: 'Other early votes', MarkedAsVoted: 'Marked as voted', Provisional: 'Provisional',
  Absent: 'Absent', VotingCentre: 'Election day', EarlyVotingCentre: 'Early voting centre', MobileVoting: 'Mobile voting',
};

function winner(district: District, seat?: Seat) {
  const key = winnerFor(seat);
  return key ? seatCandidates(district, seat).find(candidate => candidate.key === key) : undefined;
}

function seatLabel(district: District, seat?: Seat) {
  const called = winner(district, seat);
  if (called) return partyGroup(called.party);
  return 'pending';
}

function clockText(at: number | string) {
  return clock.format(new Date(at)).replace(/\s+/g, ' ').toUpperCase();
}

function eventTime(at: string) {
  const instant = new Date(at);
  return date.format(instant) + ' · ' + clockText(at);
}

function recentlyUpdated(seat: Seat | undefined, now: number) {
  return Boolean(seat?.updated && now - Date.parse(seat.updated) < 15 * 60_000);
}

function Countdown({ now }: { now: number }) {
  const closed = now >= pollsClose;
  const minutes = Math.max(0, Math.ceil((pollsClose - now) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes % 1440 / 60);
  const left = minutes % 60;
  return <div className="polls">
    <div className="polls-caption"><CalendarClock size={17} aria-hidden /> {closed ? 'Polls closed' : 'Polls close in'}</div>
    {!closed && <div className="countdown" aria-label={`${days} days, ${hours} hours and ${left} minutes`}>
      <span>{String(days).padStart(2, '0')}<small>d</small></span><b>:</b>
      <span>{String(hours).padStart(2, '0')}<small>h</small></span><b>:</b>
      <span>{String(left).padStart(2, '0')}<small>m</small></span>
    </div>}
    <time dateTime="2026-11-28T18:00:00+11:00">Sat 28 Nov · 6:00 PM AEDT</time>
  </div>;
}

function Majority({ election }: { election: Election | null }) {
  const totals = { labor: 0, coalition: 0, greens: 0, other: 0, pending: 0 };
  for (const district of districts) totals[seatLabel(district, election?.seats[district.id])]++;
  const order = ['labor', 'greens', 'other', 'pending', 'coalition'] satisfies Party[];
  const cells = order.flatMap(group => Array.from({ length: totals[group] }, () => group));
  const controlling = (['labor', 'coalition', 'greens'] as const).find(group => totals[group] >= majority);
  const thresholdWidth = (majority * 2 - districts.length) / districts.length * 100;
  return <section className="majority" aria-labelledby="majority-heading">
    <div className="section-top">
      <h2 id="majority-heading">Race to 45</h2>
      <span className="mono muted">{districts.length - totals.pending} OF {districts.length} SEATS CALLED</span>
    </div>
    <div className="seat-meter" role="img" aria-label={blocks.map(group => `${parties[group].label} ${totals[group]}`).join(', ') + '. 45 for majority.'}>
      <div className="threshold" style={{ width: `${thresholdWidth}%` }}><span>45 for majority</span></div>
      {cells.map((group, index) => <span key={index} className="meter-cell" style={{ background: parties[group].color }} />)}
    </div>
    <div className="majority-totals">
      {blocks.map(group => <div key={group} className="majority-group" style={{ '--party': parties[group].color } as CSSProperties}>
        <span className="group-name"><i />{parties[group].label}</span><strong>{totals[group]}</strong>
      </div>)}
    </div>
    {controlling && <p className="majority-winner">{parties[controlling].label} reaches 45 seats</p>}
  </section>;
}

function DistrictMap({ election, now }: { election: Election | null; now: number }) {
  const [mapPaths, setMapPaths] = useState<Record<string, string>>();
  const [mapError, setMapError] = useState(false);
  const [requested, setRequested] = useState<'current' | 'past' | null>(null);
  const [metro, setMetro] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const mode = requested ?? (now < pollsClose && !election?.events.length ? 'past' : 'current');
  const selected = districts.find(district => district.id === active);
  const selectedSeat = selected ? election?.seats[selected.id] : undefined;
  const selectedParty = selected
    ? mode === 'past' ? partyGroup(selected.history.party) : seatLabel(selected, selectedSeat)
    : null;
  const keyBox = metro ? '302 367 166 118' : '-29 -24 880 640';
  const mapStatus = mode === 'past' ? '2022 election results' : '2026 seat calls';
  useEffect(() => {
    import('./data/map.json').then(module => setMapPaths(module.default)).catch(() => setMapError(true));
  }, []);

  return <section className="map-section" aria-labelledby="district-map-title">
    <div className="section-top map-top">
      <h2 id="district-map-title">Electorate map</h2>
      <div className="switch" role="group" aria-label="Election year">
        <button type="button" aria-pressed={mode === 'current'} onClick={() => setRequested('current')}>2026</button>
        <button type="button" aria-pressed={mode === 'past'} onClick={() => setRequested('past')}>2022</button>
      </div>
    </div>
    <div className="map-frame">
      <div className="map-tools">
        <span className="mono"><Map size={13} aria-hidden /> {mapStatus}</span>
        <div className="map-scope" role="group" aria-label="Map area">
          <button type="button" aria-pressed={!metro} onClick={() => setMetro(false)}>Victoria</button>
          <button type="button" aria-pressed={metro} onClick={() => setMetro(true)}>Melbourne</button>
        </div>
      </div>
      {mapPaths ? <svg className="district-map" viewBox={keyBox} role="group" aria-label={mapStatus + ' map'} onMouseLeave={() => setActive(null)}>
        {districts.map(district => {
          const seat = election?.seats[district.id];
          const group = mode === 'past' ? partyGroup(district.history.party) : seatLabel(district, seat);
          const fresh = mode === 'current' && recentlyUpdated(seat, now);
          return <Link key={district.id} to={'/district/' + district.id} tabIndex={-1}
            aria-label={district.name + ', ' + parties[group].label}
            className={`map-district ${group} ${active === district.id ? 'is-active' : ''} ${fresh ? 'is-recent' : ''}`}
            onMouseEnter={() => setActive(district.id)}>
            <path d={mapPaths[district.id]} fillRule="evenodd" />
          </Link>;
        })}
        {!metro && <g className="map-labels" aria-hidden="true">
          <text x="165" y="45">NSW</text><text x="-8" y="172" textAnchor="middle">SA</text>
          <text x="509" y="525">BASS STRAIT</text>
          <circle cx="369" cy="429" r="3.2" /><path d="M 369,436 L 371,555 L 326,555" />
          <text x="322" y="559" textAnchor="end">MELBOURNE</text>
        </g>}
      </svg> : <p className="map-loading muted" role="status">{mapError ? 'The electorate map is temporarily unavailable.' : 'Loading electorate boundaries…'}</p>}
      {selected && selectedParty && <div className="map-tooltip">
        <strong>{selected.name}</strong><span>{parties[selectedParty].label}</span>
      </div>}
      <div className="map-legend">
        {blocks.filter(group => mode === 'current' || group !== 'pending').map(group =>
          <span key={group} style={{ '--party': parties[group].color } as CSSProperties}><i />{parties[group].label}</span>)}
      </div>
    </div>
    {mode === 'past' && <p className="map-note">2022 winners, including the 2023 Narracan supplementary election.</p>}
  </section>;
}

function eventDetail(event: ResultEvent) {
  if (event.kind === 'votes') {
    if (event.delta > 0) return '+' + number.format(event.delta) + ' ballots counted';
    if (event.delta < 0) return number.format(event.delta) + ' ballots after a count correction';
    return 'First-preference figures revised';
  }
  if (event.kind === 'preferred') return 'Two-candidate-preferred count updated';
  if (event.kind === 'uncalled') return 'VicElect seat call withdrawn';
  const name = event.candidate ? candidateName(event.candidate) : 'Winner';
  return name + (event.kind === 'declared' ? ' declared by the VEC' : ' called by VicElect');
}

function Updates({ election, now, fetchError }: { election: Election | null; now: number; fetchError: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const events = election?.events ?? [];
  const source = fetchError ? 'Connection interrupted' : election?.feed === 'delayed' ? 'VEC feed delayed'
    : election?.publishedAt ? 'Latest VEC release ' + eventTime(election.publishedAt)
    : election?.feed === 'unconfigured' ? 'VEC feed awaiting connection' : 'Awaiting first VEC release';

  return <aside id="updates" className="updates" aria-labelledby="updates-heading">
    <div className="section-top"><h2 id="updates-heading">Live updates</h2><Activity size={20} aria-hidden /></div>
    <div className="feed-source" role="status"><i data-connected={election?.feed === 'connected' && !fetchError} />{source}</div>
    {events.length ? <>
      <ol className="event-list" aria-live="polite">
        {events.slice(0, expanded ? 100 : 7).map(event => {
          const district = districts.find(row => row.id === event.district);
          return <li key={event.id}><Link to={'/district/' + event.district}>
            <time dateTime={event.at}>{eventTime(event.at)}</time>
            <strong>{district?.name ?? event.district}</strong>
            <span>{eventDetail(event)}</span><ChevronRight size={16} aria-hidden />
          </Link></li>;
        })}
      </ol>
      {events.length > 7 && <button className="text-button" type="button" onClick={() => setExpanded(!expanded)}>
        {expanded ? 'Show fewer updates' : 'Show all recent updates'}
      </button>}
    </> : <div className="empty-feed">
      <div className="feed-graphic" aria-hidden="true"><Activity size={28} /></div>
      <h3>{now < pollsClose ? 'Counting starts at 6 PM' : 'No results updates yet'}</h3>
      <p>New vote totals and seat calls will appear here as they come in.</p>
    </div>}
    <a className="feed-link" href={vec.feed}>VEC results feed <ArrowUpRight size={14} aria-hidden /></a>
  </aside>;
}

function Swing({ value }: { value: number | null }) {
  if (value === null) return <span className="muted">—</span>;
  const neutral = Math.abs(value) < 0.05;
  return <span className={`swing ${neutral ? '' : value > 0 ? 'labor-text' : 'coalition-text'}`}>
    {!neutral && (value > 0 ? <ArrowUpRight size={14} aria-hidden /> : <ArrowDownRight size={14} aria-hidden />)}
    {Math.abs(value).toFixed(1)} pp{neutral ? '' : value > 0 ? ' to Labor' : ' to Coalition'}
  </span>;
}

function DistrictTable({ election, now }: { election: Election | null; now: number }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('name');
  const rows = districts.filter(district => {
    const seat = election?.seats[district.id];
    return district.name.toLowerCase().includes(query.trim().toLowerCase()) &&
      (filter === 'all' || (filter === 'called' && winner(district, seat)) ||
      (filter === 'reporting' && seat?.count && seat.count.formal + seat.count.informal > 0) ||
      (filter === 'recent' && recentlyUpdated(seat, now)));
  });
  if (sort === 'latest') rows.sort((a, b) => (election?.seats[b.id]?.updated ?? '').localeCompare(election?.seats[a.id]?.updated ?? ''));
  if (sort === 'margin') rows.sort((a, b) => Math.abs((a.history.labor ?? 100) - 50) - Math.abs((b.history.labor ?? 100) - 50));
  return <section id="districts" className="district-list" aria-labelledby="district-list-title">
    <div className="section-top"><h2 id="district-list-title">Electorate results</h2><span className="mono muted">{rows.length} {rows.length === 1 ? 'ELECTORATE' : 'ELECTORATES'}</span></div>
    <div className="table-tools">
      <label className="search"><Search size={18} aria-hidden /><input type="search" aria-label="Find an electorate" placeholder="Find an electorate" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <select aria-label="Filter electorates" value={filter} onChange={event => setFilter(event.target.value)}>
        <option value="all">All electorates</option><option value="called">Seats called</option><option value="reporting">Reporting votes</option><option value="recent">Recently updated</option>
      </select>
      <select aria-label="Sort electorates" value={sort} onChange={event => setSort(event.target.value)}>
        <option value="name">Electorate A–Z</option><option value="latest">Latest update</option><option value="margin">Closest 2022 2PP</option>
      </select>
    </div>
    <div className="table-scroll">
      <table>
        <thead><tr><th>Electorate</th><th>2022 winner</th><th>2026 status</th><th className="right">Ballots counted</th><th className="right">2PP swing</th><th aria-label="Open electorate" /></tr></thead>
        <tbody>{rows.map(district => {
          const seat = election?.seats[district.id];
          const called = winner(district, seat);
          const total = (seat?.count?.formal ?? 0) + (seat?.count?.informal ?? 0);
          const group = partyGroup(district.history.party);
          return <tr key={district.id}>
            <th scope="row"><Link to={'/district/' + district.id}>{district.name}</Link></th>
            <td><span className="party-marker" style={{ '--party': parties[group].color } as CSSProperties}><i />{partyLabel(district.history.party)}</span></td>
            <td className={recentlyUpdated(seat, now) ? 'recent' : 'muted'}>
              {seat?.count?.elected ? 'VEC declared' : called ? partyLabel(called.party) + ' called' : recentlyUpdated(seat, now) ? 'Updated' : total ? 'Counting' : 'Awaiting votes'}
            </td>
            <td className="right numeric">{total ? number.format(total) : '—'}</td>
            <td className="right"><Swing value={laborSwing(district, seat)} /></td>
            <td className="row-open"><Link to={'/district/' + district.id} tabIndex={-1} aria-hidden="true"><ChevronRight size={17} /></Link></td>
          </tr>;
        })}</tbody>
      </table>
      {!rows.length && <p className="empty-row">No electorates match your search.</p>}
    </div>
  </section>;
}

export function Dashboard({ election, now, fetchError }: { election: Election | null; now: number; fetchError: boolean }) {
  return <>
    <div className="hero">
      <div><div className="hero-label"><i /> LEGISLATIVE ASSEMBLY RESULTS</div><h1>Victorian election <span>2026</span></h1></div>
      <Countdown now={now} />
    </div>
    <Majority election={election} />
    <div className="results-grid"><DistrictMap election={election} now={now} /><Updates election={election} now={now} fetchError={fetchError} /></div>
    <DistrictTable election={election} now={now} />
  </>;
}

export function DistrictPage({ election, now }: { election: Election | null; now: number }) {
  const { id } = useParams();
  const district = districts.find(row => row.id === id);
  const [breakdown, setBreakdown] = useState<{ id: string; data: Breakdown | null }>();
  const [breakdownError, setBreakdownError] = useState(false);
  const version = election?.publishedAt;
  useEffect(() => {
    if (!id || !version) return;
    const controller = new AbortController();
    request<Breakdown | null>('/api/districts/' + id, { signal: controller.signal }).then(data => {
      setBreakdown({ id, data });
      setBreakdownError(false);
    }).catch(() => { if (!controller.signal.aborted) setBreakdownError(true); });
    return () => controller.abort();
  }, [id, version]);
  if (!district) return <div className="inner-page"><h1>Electorate not found</h1><Link to="/#districts">Browse electorates</Link></div>;
  const seat = election?.seats[district.id];
  const count = seat?.count;
  const candidates = [...seatCandidates(district, seat)].sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0) || a.position - b.position);
  const chosen = seat?.editorial.pair;
  const preferred = preferredFor(seat);
  const preferredTotal = preferred.reduce((sum, row) => sum + row.votes, 0);
  const viewed = (chosen ?? preferred.map(row => row.key)).map(key => ({
    candidate: candidates.find(row => row.key === key),
    votes: preferred.find(row => row.key === key)?.votes,
  })).filter(row => row.candidate !== undefined);
  const standard = viewed.some(row => partyGroup(row.candidate!.party) === 'labor') &&
    viewed.some(row => partyGroup(row.candidate!.party) === 'coalition');
  const called = winner(district, seat);
  const detail = breakdown?.id === id ? breakdown?.data : null;
  const total = (count?.formal ?? 0) + (count?.informal ?? 0);
  return <div className="inner-page">
    <Link className="back-link" to="/#districts"><ArrowLeft size={16} aria-hidden /> All electorates</Link>
    <div className="hero district-hero"><div><div className="hero-label"><i /> {district.region.toUpperCase()}</div><h1>{district.name}</h1></div>
      <Countdown now={now} /></div>
    {called ? <p className="callout"><strong>{candidateName(called.name)} · {partyLabel(called.party)}</strong> {count?.elected ? 'Declared elected by the VEC' : 'Seat called by VicElect'}</p>
      : <p className="callout">{total ? 'Counting underway' : 'Awaiting first results'}{seat?.updated && <span>Updated {eventTime(seat.updated)} AEDT</span>}</p>}
    <div className="district-stats">
      <div><span>Formal votes</span><strong>{total ? number.format(count?.formal ?? 0) : '—'}</strong></div>
      <div><span>Informal votes</span><strong>{total ? number.format(count?.informal ?? 0) : '—'}</strong></div>
      <div><span>Voting centres reporting</span><strong>{count?.expected ? count.returned + ' / ' + count.expected : '—'}</strong></div>
      <div><span>Ballots / enrolment</span><strong>{count?.enrolment ? percent(total, count.enrolment) : '—'}</strong></div>
    </div>
    <div className="detail-grid">
      <section><div className="section-top"><h2>First preferences</h2><span className="mono muted">{candidates.length} CANDIDATES</span></div>
        <div className="table-scroll"><table className="preferences">
          <thead><tr><th>Candidate</th><th className="right">Votes</th><th className="right">Share</th></tr></thead>
          <tbody>{candidates.map(candidate => <tr key={candidate.key}>
            <th scope="row" style={{ '--party': parties[partyGroup(candidate.party)].color } as CSSProperties}>
              <span className="candidate-name">{candidateName(candidate.name)}</span><small>{partyLabel(candidate.party)}</small>
              {total > 0 && candidate.votes !== null && <span className="mini-bar" style={{ width: percent(candidate.votes, count?.formal ?? 0).replace('—', '0%') }} />}
            </th><td className="right numeric">{total && candidate.votes !== null ? number.format(candidate.votes) : '—'}</td>
            <td className="right numeric">{candidate.votes !== null ? percent(candidate.votes, count?.formal ?? 0) : '—'}</td>
          </tr>)}</tbody>
        </table></div>
        {detail?.types.some(row => row.formal + row.informal) && <details className="breakdown">
          <summary>Results by vote type</summary>
          <table><thead><tr><th>Vote type</th><th className="right">Formal</th><th className="right">Informal</th></tr></thead>
            <tbody>{detail.types.filter(row => row.formal + row.informal).map(row => <tr key={row.type}>
              <th scope="row">{voteType[row.type] ?? row.type}</th><td className="right numeric">{number.format(row.formal)}</td><td className="right numeric">{number.format(row.informal)}</td>
            </tr>)}</tbody></table>
        </details>}
        {detail?.centres.length ? <details className="breakdown">
          <summary>Voting centres reporting ({detail.centres.length})</summary>
          <table><thead><tr><th>Voting centre</th><th className="right">Formal</th><th className="right">Informal</th></tr></thead>
            <tbody>{detail.centres.map(row => <tr key={row.id}><th scope="row">{row.name}<small>{voteType[row.type] ?? row.type}</small></th>
              <td className="right numeric">{number.format(row.formal)}</td><td className="right numeric">{number.format(row.informal)}</td></tr>)}</tbody></table>
        </details> : null}
        {breakdownError && <p className="muted">Voting centre details are temporarily unavailable.</p>}
      </section>
      <div className="district-side">
        <section>
          <div className="section-top"><h2>Two-candidate preferred</h2></div>
          {viewed.map(({ candidate, votes }) => candidate && <div className="pair-row" key={candidate.key}>
            <span><strong>{candidateName(candidate.name)}</strong><small>{partyLabel(candidate.party)}</small></span>
            <span className="numeric">{votes !== undefined && preferredTotal ? percent(votes, preferredTotal) : '—'}
              {votes !== undefined && preferredTotal > 0 && <small>{number.format(votes)} votes</small>}</span>
          </div>)}
          {!preferredTotal && <p className="muted">{count?.masked ? 'The VEC has temporarily withheld this count.' :
            chosen ? 'Awaiting a VEC count for this candidate pair.' : 'Awaiting the VEC’s two-candidate count.'}</p>}
          {preferredTotal > 0 && <p className="muted">{standard ? 'Labor–Coalition 2PP from the VEC’s 2CP count for this electorate.' : 'VEC two-candidate count.'}</p>}
        </section>
        <section>
          <div className="section-top"><h2>Previous election</h2></div>
          <dl className="history">
            <div><dt>{district.id === 'narracan' ? '2023 supplementary winner' : '2022 winner'}</dt><dd>{candidateName(district.history.winner)}<small>{partyLabel(district.history.party)}</small></dd></div>
            {district.history.labor !== null && <div><dt>2022 Labor 2PP</dt><dd className="numeric">{district.history.labor.toFixed(1)}%</dd></div>}
            <div><dt>2PP swing</dt><dd><Swing value={laborSwing(district, seat)} /></dd></div>
          </dl>
          <a className="feed-link" href={district.history.url}>Previous VEC result <ArrowUpRight size={14} aria-hidden /></a>
        </section>
      </div>
    </div>
  </div>;
}
