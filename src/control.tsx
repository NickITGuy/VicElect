import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router';
import { LockKeyhole, LogOut } from 'lucide-react';
import { request } from './api.ts';
import { candidateName, districts, partyLabel, preferredFor, seatCandidates } from './election.ts';
import type { District, Editorial, Election, Seat } from './election.ts';

type Session = { configured: boolean; signedIn: boolean };
type Feedback = { kind: 'error' | 'success'; text: string };
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Unable to save changes.';

export function ControlPanel({ election, refresh }: { election: Election | null; refresh: () => Promise<void> }) {
  const [session, setSession] = useState<Session>();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [districtId, setDistrictId] = useState(districts[0].id);
  const [feedback, setFeedback] = useState<Feedback>();
  const district = districts.find(row => row.id === districtId) ?? districts[0];
  const seat = election?.seats[district.id];
  useEffect(() => {
    const controller = new AbortController();
    request<Session>('/api/admin/session', { signal: controller.signal }).then(setSession)
      .catch(() => { if (!controller.signal.aborted) setError('The control panel is temporarily unavailable.'); });
    return () => controller.abort();
  }, []);

  async function login(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await request('/api/admin/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
      });
      setPassword('');
      setSession({ configured: true, signedIn: true });
    } catch (error) { setError(errorText(error)); }
    finally { setSubmitting(false); }
  }

  async function logout() {
    setError('');
    try {
      await request('/api/admin/logout', { method: 'POST' });
      setFeedback(undefined);
      setSession({ configured: true, signedIn: false });
    } catch (error) { setError(errorText(error)); }
  }

  return <div className="inner-page control-page">
    <div className="section-top control-top"><h1>Control panel</h1>
      {session?.signedIn && <button className="text-button" onClick={() => void logout()}>Sign out <LogOut size={16} aria-hidden /></button>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {session && (session.signedIn ? <>
      <div className="choose-panel">
        <label>Electorate<select value={district.id} onChange={event => { setFeedback(undefined); setDistrictId(event.target.value); }}>
          {districts.map(row => <option value={row.id} key={row.id}>{row.name}</option>)}
        </select></label>
        <Link to={'/district/' + district.id}>View electorate results</Link>
      </div>
      {feedback && <p className={'form-' + feedback.kind} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.text}</p>}
      <SeatControls key={district.id + JSON.stringify(seat?.editorial ?? null)} district={district} seat={seat} refresh={refresh} setFeedback={setFeedback} />
    </> : session.configured ? <form className="login-form" onSubmit={login}>
      <p><LockKeyhole size={18} aria-hidden /> Owner sign-in</p>
      <label>Password<input type="password" name="password" required autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
      <button className="primary-button" disabled={submitting}>Sign in</button>
    </form> : <p className="muted">Set <code>ADMIN_PASSWORD</code> on the server to enable owner sign-in.</p>)}
    {!session && !error && <p className="muted" role="status">Checking sign-in…</p>}
  </div>;
}

function SeatControls({ district, seat, refresh, setFeedback }: {
  district: District; seat?: Seat; refresh: () => Promise<void>; setFeedback: (feedback?: Feedback) => void;
}) {
  const candidates = seatCandidates(district, seat);
  const [winner, setWinner] = useState(seat?.editorial.winner ?? '');
  const [first, setFirst] = useState(seat?.editorial.pair?.[0] ?? '');
  const [second, setSecond] = useState(seat?.editorial.pair?.[1] ?? '');
  const [saving, setSaving] = useState(false);
  const officialWinner = candidates.find(row => row.key === seat?.count?.elected);
  const hasOfficialPair = seat?.count?.preferred.length === 2;
  const options = candidates.map(row => <option key={row.key} value={row.key}>{candidateName(row.name)} · {partyLabel(row.party)}</option>);

  async function save(changes: Partial<Pick<Editorial, 'winner' | 'pair'>>) {
    setSaving(true);
    setFeedback(undefined);
    try {
      await request('/api/admin/districts/' + district.id, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes),
      });
      setFeedback({ kind: 'success', text: 'Saved.' });
      if (changes.winner === null) setWinner('');
      if (changes.pair === null) { setFirst(''); setSecond(''); }
      await refresh();
    } catch (error) { setFeedback({ kind: 'error', text: errorText(error) }); }
    finally { setSaving(false); }
  }

  return <>
    <section className="control-section">
      <div className="section-top"><h2>Seat call</h2></div>
      {officialWinner ? <p>{candidateName(officialWinner.name)} has been declared elected by the VEC.</p>
        : <form onSubmit={event => { event.preventDefault(); void save({ winner }); }}>
          <p>Calling a seat adds it to the majority tally and publishes it as a VicElect call.</p>
          <label>Winning candidate<select required value={winner} onChange={event => setWinner(event.target.value)}>
            <option value="">Select a candidate</option>{options}
          </select></label>
          <div className="form-actions">
            <button className="primary-button" disabled={!winner || winner === seat?.editorial.winner || saving}>Publish seat call</button>
            {seat?.editorial.winner && <button className="secondary-button" type="button" disabled={saving} onClick={() => void save({ winner: null })}>Withdraw call</button>}
          </div>
        </form>}
    </section>
    <section className="control-section">
      <div className="section-top"><h2>Preferred candidate pair</h2></div>
      <form onSubmit={event => { event.preventDefault(); void save({ pair: [first, second] }); }}>
        <p>By default the electorate page uses the pair published by the VEC. Pick a pair to display its count when VEC figures are available.</p>
        {hasOfficialPair && seat?.editorial.pair && !preferredFor(seat).length && <p className="muted">The current VEC count uses a different pair.</p>}
        <div className="pair-control">
          <label>First candidate<select value={first} onChange={event => setFirst(event.target.value)} required>
            <option value="">Select a candidate</option>{options}
          </select></label>
          <label>Second candidate<select value={second} onChange={event => setSecond(event.target.value)} required>
            <option value="">Select a candidate</option>{options}
          </select></label>
        </div>
        <div className="form-actions">
          <button className="primary-button" disabled={saving || !first || !second || first === second ||
            (first === seat?.editorial.pair?.[0] && second === seat.editorial.pair[1])}>Save candidate pair</button>
          {seat?.editorial.pair && <button className="secondary-button" type="button" disabled={saving} onClick={() => void save({ pair: null })}>Use VEC pair</button>}
        </div>
      </form>
    </section>
  </>;
}
