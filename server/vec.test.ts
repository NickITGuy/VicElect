import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { districts, laborSwing, preferredFor } from '../src/election.ts';
import type { Editorial } from '../src/election.ts';
import { parseSnapshot } from './vec.ts';

function archive({
  event = 'State Election 2026',
  created = '2026-11-28T19:02:00',
  masked = false,
}: { event?: string; created?: string; masked?: boolean } = {}) {
  const preferred = masked ? '<TwoCandidatePreferred Maverick="true" />' : `
    <TwoCandidatePreferred>
      <Candidate><eml:CandidateIdentifier Id="1" /><Votes>600</Votes></Candidate>
      <Candidate><eml:CandidateIdentifier Id="2" /><Votes>400</Votes></Candidate>
    </TwoCandidatePreferred>`;
  return zipSync({ 'results.xml': strToU8(`
    <MediaFeed xmlns:eml="urn:oasis:names:tc:evs:schema:eml" Created="${created}" Verbose="true">
      <eml:EventIdentifier><eml:EventName>${event}</eml:EventName></eml:EventIdentifier>
      <Election><eml:ElectionIdentifier Id="L" /><House><Contests>
        <Contest>
          <eml:ContestIdentifier><eml:ContestName>Albert Park District</eml:ContestName></eml:ContestIdentifier>
          <Declared>false</Declared><Enrolment>5000</Enrolment>
          <FirstPreferences PollingPlacesReturned="1" PollingPlacesExpected="9">
            <Candidate><eml:CandidateIdentifier Id="1"><eml:CandidateName>TAYLOR, Nina</eml:CandidateName></eml:CandidateIdentifier>
              <Affiliation><eml:AffiliationIdentifier><eml:RegisteredName>Australian Labor Party - Victorian Branch</eml:RegisteredName></eml:AffiliationIdentifier></Affiliation>
              <BallotPosition>2</BallotPosition><Votes>550</Votes></Candidate>
            <Candidate><eml:CandidateIdentifier Id="2"><eml:CandidateName>COOK, Andrew</eml:CandidateName></eml:CandidateIdentifier>
              <Affiliation><eml:AffiliationIdentifier><eml:RegisteredName>Liberal Party of Australia - Victorian Division</eml:RegisteredName></eml:AffiliationIdentifier></Affiliation>
              <BallotPosition>1</BallotPosition><Votes>350</Votes></Candidate>
            <Candidate><eml:CandidateIdentifier Id="3"><eml:CandidateName>SEMMENS, Sonya</eml:CandidateName></eml:CandidateIdentifier>
              <BallotPosition>3</BallotPosition><Votes>100</Votes></Candidate>
            <Formal><Votes>1000</Votes><VotesByType><Votes Type="Ordinary">1000</Votes></VotesByType></Formal>
            <Informal><Votes>20</Votes><VotesByType><Votes Type="Ordinary">20</Votes></VotesByType></Informal>
          </FirstPreferences>
          ${preferred}
        </Contest>
      </Contests></House></Election>
    </MediaFeed>`) });
}

test('joins VEC preferences by candidate ID and compares only a measured Labor–Coalition pair', () => {
  const snapshot = parseSnapshot(archive());
  const { count, breakdown } = snapshot.districts['albert-park'];
  const editable: Editorial = { pair: ['cookandrew', 'taylornina'], winner: null, calledAt: null };
  const seat = { id: 'albert-park', count, updated: null, editorial: editable };
  const district = districts[0];
  assert.equal(snapshot.publishedAt, '2026-11-28T08:02:00.000Z');
  assert.equal(count.formal + count.informal, 1020);
  assert.deepEqual(breakdown.types, [{ type: 'Ordinary', formal: 1000, informal: 20 }]);
  assert.deepEqual(preferredFor(seat).map(row => row.votes), [400, 600]);
  assert.equal(laborSwing(district, seat), 60 - district.history.labor!);
  editable.pair = ['taylornina', 'semmenssonya'];
  assert.deepEqual(preferredFor(seat), []);
  assert.equal(laborSwing(district, seat), null);
});

test('withheld 2CP preserves first preferences and exposes no 2CP values', () => {
  const { count } = parseSnapshot(archive({ masked: true })).districts['albert-park'];
  assert.equal(count.formal, 1000);
  assert.equal(count.masked, true);
  assert.deepEqual(count.preferred, []);
});

test('production ingestion rejects trial data and archives published before polls close', () => {
  assert.throws(() => parseSnapshot(archive({ event: 'Test State Election 2026' })), /production/);
  assert.throws(() => parseSnapshot(archive({ created: '2026-11-28T17:59:59' })), /production/);
});
