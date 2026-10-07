// test-mapstatus.js — Tests for the _mapStatus fix
//
// Covers the distinguishing signal between live chase and finished match
// with 2 completed innings.
//
// Scenario (a): Live chase — 2 scoreboards, ball data flowing, target NOT reached
//   → should return 'live'
// Scenario (b): Finished match — 2 scoreboards, no ball data, no note
//   → should return 'complete'
// Scenario (c): Chase successful — 2nd innings total >= 1st innings + 1
//   → should return 'complete'
// Scenario (d): All out — 2nd innings wickets = 10
//   → should return 'complete'
// Scenario (e): Overs completed — 2nd innings overs >= format max (T20=20, ODI=50)
//   → should return 'complete'
// Scenario (f): Test/First Class — 4+ scoreboards = complete; 2-3 = live
// Scenario (g): Sportmonks explicit status overrides all heuristics
//
// Usage: node test-mapstatus.js

const { normalizeSportMonksMatch } = require('./sportmonksAdapter');

const BASE_SM = {
  id: 999,
  name: 'Test Match',
  localteam: { id: 1, name: 'Team A', short_name: 'TA' },
  visitorteam: { id: 2, name: 'Team B', short_name: 'TB' },
  starts_at: '2025-01-01T00:00:00Z',
  season: { id: 1, name: '2025' },
  stage: 'Regular Season',
  league: 'T20 League',
  type: 'T20',
  status: null,
  note: '',
  balls: [],
  batting: [],
};

function makeSmResponse(overrides = {}) {
  return { ...BASE_SM, ...overrides };
}

// Build a minimal match doc just to extract the status field.
function getStatus(smResponse) {
  const doc = normalizeSportMonksMatch(smResponse);
  return doc ? doc.status : null;
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log('PASS:', name); passed++; }
  catch (e) { console.log('FAIL:', name, '-', e.message); failed++; }
}

function assertEqual(actual, expected) {
  if (actual !== expected) throw new Error(`expected "${expected}", got "${actual}"`);
}

// ── Scenario (a): Live chase — 2 scoreboards, ball data, target NOT reached ──
test('(a) Live T20 chase: 2 scoreboards, balls flowing, target not reached → live', () => {
  // Team A bats first: 150/5 in 20 overs
  // Team B batting: 80/3 after 12 overs (still chasing)
  const sm = makeSmResponse({
    type: 'T20',
    balls: [{ id: 1, over_id: 13, ball_number: 3, batsman_id: 10 }],
    scoreboards: [
      { type: 'total', team_id: 1, total: 150, wickets: 5, overs: 20, updated_at: '2025-01-01T12:00:00Z' },
      { type: 'total', team_id: 2, total: 80,  wickets: 3, overs: 12, updated_at: '2025-01-01T13:00:00Z' },
    ],
  });
  assertEqual(getStatus(sm), 'live');
});

// ── Scenario (b): Finished match — 2 scoreboards, NO ball data, NO note ──
test('(b) Finished T20: 2 scoreboards, no balls, no note → complete', () => {
  const sm = makeSmResponse({
    type: 'T20',
    balls: [],
    scoreboards: [
      { type: 'total', team_id: 1, total: 160, wickets: 8, overs: 20, updated_at: '2025-01-01T12:00:00Z' },
      { type: 'total', team_id: 2, total: 103, wickets: 10, overs: 18.3, updated_at: '2025-01-01T13:00:00Z' },
    ],
  });
  assertEqual(getStatus(sm), 'complete');
});

// ── Scenario (c): Chase successful — 2nd innings total >= 1st + 1 ──
test('(c) Chase successful (2nd total >= 1st + 1) → complete', () => {
  const sm = makeSmResponse({
    type: 'T20',
    balls: [],
    scoreboards: [
      { type: 'total', team_id: 1, total: 150, wickets: 5, overs: 20, updated_at: '2025-01-01T12:00:00Z' },
      { type: 'total', team_id: 2, total: 151, wickets: 7, overs: 19.2, updated_at: '2025-01-01T13:00:00Z' },
    ],
  });
  assertEqual(getStatus(sm), 'complete');
});

// ── Scenario (d): All out — 2nd innings wickets = 10 ──
test('(d) All out (2nd innings wickets = 10) → complete', () => {
  const sm = makeSmResponse({
    type: 'T20',
    balls: [],
    scoreboards: [
      { type: 'total', team_id: 1, total: 150, wickets: 5, overs: 20, updated_at: '2025-01-01T12:00:00Z' },
      { type: 'total', team_id: 2, total: 140, wickets: 10, overs: 18.0, updated_at: '2025-01-01T13:00:00Z' },
    ],
  });
  assertEqual(getStatus(sm), 'complete');
});

// ── Scenario (e): Overs completed — 2nd innings overs >= format max ──
test('(e) Overs completed (T20: 2nd overs >= 20) → complete', () => {
  const sm = makeSmResponse({
    type: 'T20',
    balls: [],
    scoreboards: [
      { type: 'total', team_id: 1, total: 150, wickets: 5, overs: 20, updated_at: '2025-01-01T12:00:00Z' },
      { type: 'total', team_id: 2, total: 145, wickets: 9, overs: 20, updated_at: '2025-01-01T13:00:00Z' },
    ],
  });
  assertEqual(getStatus(sm), 'complete');
});

// ── Scenario (f): Test match — 4+ scoreboards = complete; 2-3 = live ──
test('(f1) Test match: 4 scoreboards (both teams x 2 innings) → complete', () => {
  const sm = makeSmResponse({
    type: 'Test',
    balls: [],
    scoreboards: [
      { type: 'total', team_id: 1, total: 300, wickets: 10, overs: 90, updated_at: '2025-01-01T10:00:00Z' },
      { type: 'total', team_id: 2, total: 250, wickets: 10, overs: 75, updated_at: '2025-01-01T12:00:00Z' },
      { type: 'total', team_id: 1, total: 400, wickets: 8, overs: 110, updated_at: '2025-01-01T14:00:00Z' },
      { type: 'total', team_id: 2, total: 350, wickets: 9, overs: 100, updated_at: '2025-01-01T16:00:00Z' },
    ],
  });
  assertEqual(getStatus(sm), 'complete');
});

test('(f2) Test match: 2 scoreboards (each team batted once) → live', () => {
  const sm = makeSmResponse({
    type: 'Test',
    balls: [],
    scoreboards: [
      { type: 'total', team_id: 1, total: 300, wickets: 10, overs: 90, updated_at: '2025-01-01T10:00:00Z' },
      { type: 'total', team_id: 2, total: 250, wickets: 10, overs: 75, updated_at: '2025-01-01T12:00:00Z' },
    ],
  });
  assertEqual(getStatus(sm), 'live');
});

// ── Scenario (g): Sportmonks explicit status overrides ──
test('(g1) Explicit status=finished → complete', () => {
  const sm = makeSmResponse({ status: 'finished', balls: [{ id: 1 }], scoreboards: [] });
  assertEqual(getStatus(sm), 'complete');
});

test('(g2) Explicit status=live → live', () => {
  const sm = makeSmResponse({ status: 'live', balls: [], scoreboards: [] });
  assertEqual(getStatus(sm), 'live');
});

test('(g3) Explicit status=scheduled → not_started', () => {
  const sm = makeSmResponse({ status: 'scheduled', balls: [], scoreboards: [] });
  assertEqual(getStatus(sm), 'not_started');
});

// ── Edge cases ──
test('(h1) No scoreboards, no balls → live', () => {
  const sm = makeSmResponse({ balls: [], scoreboards: [] });
  assertEqual(getStatus(sm), 'live');
});

test('(h2) 1 scoreboard, balls flowing → live', () => {
  const sm = makeSmResponse({
    balls: [{ id: 1 }],
    scoreboards: [{ type: 'total', team_id: 1, total: 100, wickets: 2, overs: 10, updated_at: '2025-01-01T12:00:00Z' }],
  });
  assertEqual(getStatus(sm), 'live');
});

test('(h3) 1 scoreboard, no balls → complete', () => {
  const sm = makeSmResponse({
    balls: [],
    scoreboards: [{ type: 'total', team_id: 1, total: 160, wickets: 8, overs: 20, updated_at: '2025-01-01T12:00:00Z' }],
  });
  assertEqual(getStatus(sm), 'complete');
});

// ── Summary ──
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
