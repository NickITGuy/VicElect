import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import express from 'express';
import type { Request, Response } from 'express';
import { districts } from '../src/election.ts';
import type { Editorial, Election } from '../src/election.ts';
import { getBreakdown, getElection, latestFilename, setEditorial, storeSnapshot } from './store.ts';
import { feedConfigured, latestSnapshot } from './vec.ts';

const app = express();
const publicOrigin = process.env.PUBLIC_ORIGIN ? new URL(process.env.PUBLIC_ORIGIN).origin : null;
const secure = publicOrigin?.startsWith('https:') ?? false;
const password = process.env.ADMIN_PASSWORD;
if (password && password.length < 16) throw new Error('ADMIN_PASSWORD must contain at least 16 characters.');

const sessionDuration = 12 * 60 * 60 * 1000;
const sessions = new Map<string, number>();
const attempts = new Map<string, { count: number; expires: number }>();
const digest = (input: string) => createHash('sha256').update(input).digest();
const passwordDigest = password ? digest(password) : null;
let feed: Election['feed'] = feedConfigured ? 'waiting' : 'unconfigured';

app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  next();
});
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use('/api/admin', (req, res, next) => {
  const origin = req.get('origin');
  const requestOrigin = publicOrigin ?? `${req.protocol}://${req.get('host')}`;
  if (req.method !== 'GET' && (req.get('sec-fetch-site') === 'cross-site' || (origin && origin !== requestOrigin))) {
    res.status(403).json({ error: 'This request must come from VicElect.' });
    return;
  }
  next();
});
app.use('/api/admin', express.json({ limit: '4kb' }));

function token(req: Request) {
  return req.headers.cookie?.match(/(?:^|; *)vicelect_session=([a-f0-9]{64})(?:;|$)/)?.[1];
}

function signedIn(req: Request) {
  const id = token(req);
  return Boolean(id && (sessions.get(id) ?? 0) > Date.now());
}

function sessionCookie(res: Response, value: string, maxAge: number) {
  res.cookie('vicelect_session', value, { httpOnly: true, sameSite: 'strict', secure, path: '/api/admin', maxAge });
}

app.get('/api/election', (_req, res) => res.json(getElection(feed)));
app.get('/api/districts/:id', (req, res) => {
  if (!districts.some(district => district.id === req.params.id)) return res.status(404).json({ error: 'Electorate not found.' });
  return res.json(getBreakdown(req.params.id));
});
app.get('/api/admin/session', (req, res) => res.json({ configured: Boolean(passwordDigest), signedIn: signedIn(req) }));
app.post('/api/admin/login', (req, res) => {
  if (!passwordDigest) return res.status(503).json({ error: 'Set the owner password on the server to enable sign-in.' });
  const now = Date.now();
  for (const [key, value] of attempts) if (value.expires <= now) attempts.delete(key);
  for (const [key, expiry] of sessions) if (expiry <= now) sessions.delete(key);
  const ip = req.ip ?? 'unknown';
  const attempt = attempts.get(ip) ?? { count: 0, expires: now + 15 * 60_000 };
  if (attempt.count >= 8 || attempts.size > 1_000 && !attempts.has(ip)) {
    return res.status(429).json({ error: 'Too many sign-in attempts. Try again in 15 minutes.' });
  }
  const supplied: unknown = req.body?.password;
  if (typeof supplied !== 'string' || !timingSafeEqual(passwordDigest, digest(supplied))) {
    attempts.set(ip, { ...attempt, count: attempt.count + 1 });
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  attempts.delete(ip);
  const previous = token(req);
  if (previous) sessions.delete(previous);
  const id = randomBytes(32).toString('hex');
  sessions.set(id, now + sessionDuration);
  sessionCookie(res, id, sessionDuration);
  return res.json({ signedIn: true });
});
app.post('/api/admin/logout', (req, res) => {
  const id = token(req);
  if (id) sessions.delete(id);
  sessionCookie(res, '', 0);
  res.json({ signedIn: false });
});
app.put('/api/admin/districts/:id', (req, res) => {
  if (!signedIn(req)) return res.status(401).json({ error: 'Sign in to save changes.' });
  const input: unknown = req.body;
  if (!input || typeof input !== 'object') return res.status(400).json({ error: 'Enter a seat call or candidate pair.' });
  const patch: Partial<Pick<Editorial, 'winner' | 'pair'>> = {};
  if ('winner' in input) {
    if (typeof input.winner !== 'string' && input.winner !== null) return res.status(400).json({ error: 'Select a valid candidate.' });
    patch.winner = input.winner;
  }
  if ('pair' in input) {
    const pair = input.pair;
    if (pair !== null && (!Array.isArray(pair) || pair.length !== 2 ||
      typeof pair[0] !== 'string' || typeof pair[1] !== 'string' || pair[0] === pair[1])) {
      return res.status(400).json({ error: 'Choose two different candidates.' });
    }
    patch.pair = pair === null ? null : [pair[0], pair[1]];
  }
  if (!Object.keys(patch).length || !setEditorial(req.params.id, patch)) {
    return res.status(400).json({ error: 'Use candidates from this electorate and check whether the VEC has declared the seat.' });
  }
  return res.json(getElection(feed));
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));

const client = resolve('dist');
app.use(express.static(client, { index: false, redirect: false }));
app.get(/.*/, (_req, res) => res.sendFile(resolve(client, 'index.html')));

async function refreshFeed() {
  try {
    const latest = await latestSnapshot(latestFilename());
    if (latest) storeSnapshot(latest.name, latest.snapshot);
    feed = getElection('connected').publishedAt ? 'connected' : 'waiting';
  } catch (error) {
    feed = 'delayed';
    // URLs may carry access tokens. Log only the error type and known safe HTTP status messages.
    const message = error instanceof Error ? error.message : '';
    console.error('VEC refresh failed', /^VEC HTTP \d+$/.test(message) ? message : error instanceof Error ? error.name : '');
  } finally {
    setTimeout(() => void refreshFeed(), 60_000).unref();
  }
}

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
app.listen(port, host, () => console.log(`VicElect API listening on http://${host}:${port}`));
if (feedConfigured) void refreshFeed();
