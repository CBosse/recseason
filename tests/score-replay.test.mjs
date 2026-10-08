import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreHistoryEntry } from '../score-history.mjs';
import { scoreReplay } from '../score-replay.mjs';

function sample() {
  const initial = { id: 'g', status: 'scheduled' };
  const live = { ...initial, homeScore: 2, awayScore: 1, status: 'live', scoreRevision: 1, bases: { first: true, second: false, third: false } };
  const final = { ...live, status: 'completed', scoreRevision: 2 };
  const corrected = { ...final, homeScore: 3, scoreRevision: 3 };
  const events = [scoreHistoryEntry('g', initial, live, 's'), scoreHistoryEntry('g', live, final, 's'), scoreHistoryEntry('g', final, corrected, 'a', 'Official correction')];
  return { initial, live, final, corrected, events };
}

test('replay sorts events, preserves baseline, runners and final corrections without mutating input', () => {
  const { corrected, events } = sample();
  const reversed = [...events].reverse();
  const replay = scoreReplay(corrected, reversed);
  assert.deepEqual(replay.warnings, []);
  assert.deepEqual(replay.frames.map(frame => frame.state.homeScore), [null, 2, 2, 3]);
  assert.equal(replay.frames[1].state.bases.first, true);
  assert.equal(replay.frames[3].reason, 'Official correction');
  assert.equal(reversed[0].revision, 3);
});

test('replay surfaces partial history, gaps, duplicates, discontinuities and stale displayed games', () => {
  const { corrected, events, live } = sample();
  assert.match(scoreReplay(corrected, events.slice(1)).warnings.join(' '), /Earlier/);
  assert.match(scoreReplay(corrected, [events[0], events[2]]).warnings.join(' '), /Missing/);
  assert.match(scoreReplay(corrected, [...events, events[2]]).warnings.join(' '), /duplicate/);
  const changed = structuredClone(events); changed[1].before.homeScore = 99;
  assert.match(scoreReplay(corrected, changed).warnings.join(' '), /discontinuity/);
  assert.match(scoreReplay(live, events).warnings.join(' '), /does not match/);
});

test('replay rejects foreign and malformed events and reports empty history', () => {
  const { corrected, events } = sample();
  for (const event of [{ ...events[0], gameId: 'other' }, { ...events[0], revision: 0 }, { ...events[0], after: null }, { ...events[0], after: { ...events[0].after, bases: { first: 'yes' } } }]) {
    assert.equal(scoreReplay(corrected, [event]).frames.length, 0);
  }
  assert.equal(scoreReplay(corrected, []).frames.length, 0);
});

test('replay compares inning maps independent of property insertion order', () => {
  const state = { status: 'live', homeScore: 3, awayScore: 0, lineScore: { 1: { home: 3, away: 0 } }, scoreCarry: { home: 0, away: 0 } };
  const after = { ...state, scoreRevision: 1 };
  const event = scoreHistoryEntry('g', state, after, 's');
  const game = { ...after, id: 'g', lineScore: { 1: { away: 0, home: 3 } }, scoreCarry: { away: 0, home: 0 } };
  assert.deepEqual(scoreReplay(game, [event]).warnings, []);
});

test('replay fails closed on invalid counters, scores, inning maps and totals', () => {
  const { corrected, events } = sample();
  for (const patch of [{ homeScore: -1 }, { awayScore: '1' }, { inning: 0 }, { half: 'middle' }, { balls: 4 }, { strikes: 3 }, { outs: 3 },
    { status: 'unknown' }, { homeScore: null }, { lineScore: [] }, { lineScore: { 0: { home: 2, away: 1 } } },
    { lineScore: { 1: { home: 2, away: 1 } }, scoreCarry: null }, { lineScore: { 1: { home: 99, away: 1 } }, scoreCarry: { home: 0, away: 0 } }]) {
    const changed = structuredClone(events); changed[0].after = { ...changed[0].after, ...patch };
    const replay = scoreReplay(corrected, changed);
    assert.equal(replay.frames.length, 0, JSON.stringify(patch));
    assert.match(replay.warnings[0], /invalid state/);
  }
});

test('malformed event containers and corrupt displayed state do not throw', () => {
  const { corrected, events } = sample();
  for (const entries of [null, {}, [null], [undefined], [42], [[]]]) assert.equal(scoreReplay(corrected, entries).frames.length, 0);
  const replay = scoreReplay({ ...corrected, bases: { first: 'yes' } }, events);
  assert.equal(replay.frames.length, 4);
  assert.match(replay.warnings.join(' '), /displayed game.*invalid/);
});

test('replay accepts the same safe-integer score range as the database', () => {
  const state = { status: 'completed', homeScore: Number.MAX_SAFE_INTEGER, awayScore: 0 };
  const event = scoreHistoryEntry('g', state, { ...state, scoreRevision: 1 }, 'scorer', 'Legacy correction');
  assert.deepEqual(scoreReplay({ ...state, id: 'g', scoreRevision: 1 }, [event]).warnings, []);
});
