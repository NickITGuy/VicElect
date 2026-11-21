import '@fontsource-variable/inter';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import './style.css';
import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router';
import { Activity, Grid2X2, LockKeyhole } from 'lucide-react';
import { Dashboard, DistrictPage } from './results.tsx';
import { ControlPanel } from './control.tsx';
import { request } from './api.ts';
import type { Election } from './election.ts';
import { pollsClose, vec } from './election.ts';

function App() {
  const [election, setElection] = useState<Election | null>(null);
  const [fetchError, setFetchError] = useState(false);
  const [now, setNow] = useState(Date.now);
  const location = useLocation();
  const beforeClose = now < pollsClose;
  const refresh = useCallback(async () => {
    try {
      setElection(await request<Election>('/api/election'));
      setFetchError(false);
    } catch {
      setFetchError(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 15_000);
    const clock = setInterval(() => setNow(Date.now()), 5000);
    return () => { clearInterval(id); clearInterval(clock); };
  }, [refresh]);

  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [location.pathname, location.hash]);

  const activity = fetchError ? 'Connection interrupted' : election?.feed === 'delayed' ? 'VEC feed delayed'
    : beforeClose ? 'Pre-election' : election?.publishedAt ? 'Count underway' : 'Awaiting results';

  return <>
    <a className="skip-link" href="#main">Skip to results</a>
    <header className="masthead">
      <div className="shell masthead-inner">
        <Link className="brand" to="/"><Grid2X2 size={19} aria-hidden /> Vic<span>Elect</span></Link>
        <nav aria-label="Main navigation">
          <Link to="/" className={location.pathname === '/' && !location.hash ? 'active' : ''}>Overview</Link>
          <Link to="/#districts" className={location.hash === '#districts' || location.pathname.startsWith('/district/') ? 'active' : ''}>Electorates</Link>
          <Link to="/#updates" className={location.hash === '#updates' ? 'active' : ''}>Live updates</Link>
        </nav>
        <div className="masthead-right">
          <span className="status"><span />{activity}</span>
          <Link to="/control" className="control-link" title="Owner control panel" aria-label="Owner control panel"><LockKeyhole size={16} aria-hidden /></Link>
        </div>
      </div>
    </header>
    <main id="main" className="shell">
      <Routes>
        <Route path="/" element={<Dashboard election={election} now={now} fetchError={fetchError} />} />
        <Route path="/district/:id" element={<DistrictPage election={election} now={now} />} />
        <Route path="/control" element={<ControlPanel election={election} refresh={refresh} />} />
        <Route path="*" element={<div className="inner-page"><h1>Page not found</h1><Link to="/">Return to results</Link></div>} />
      </Routes>
    </main>
    <footer className="site-footer">
      <div className="shell footer-inner"><span><Activity size={16} aria-hidden /> VicElect · Independent election coverage</span>
        <div><a href={vec.election}>Victorian Electoral Commission</a><a href={vec.boundaries}>Vicmap boundaries</a></div>
      </div>
    </footer>
  </>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>);
