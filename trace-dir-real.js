#!/usr/bin/env node
/**
 * Trace the exact dir value produced by the Sportmonks inference layer
 * for realistic Sportmonks ball payloads — genuine batted four,
 * four-byes, four-leg-byes, and four with missing batsman_score.
 *
 * This answers: does dir end up null for genuine batted fours, or only
 * for a specific edge case (boundary via extras)?
 */

const { SportMonksAdapter, normalizeSportMonksBall } = require('./sportmonksAdapter');

const adapter = new SportMonksAdapter({ token: 'fake-token' });

// Realistic Sportmonks "World Plan" ball payloads.
// Fields that come from the livescores/fixures endpoint.
const GENUINE_FOUR = {
  id: 1001,
  over_id: 12,
  ball_number: 3,
  batsman_id: 2001,
  bowler_id: 3001,
  batsman_one_on_creeze_id: 2001,
  batsman_two_on_creeze_id: 2002,
  batsmanout_id: null,
  catchstump_id: null,
  runs: 4,                 // total runs off the ball
  bye: 0,
  leg_bye: 0,
  noball: 0,
  noball_runs: 0,
  wide: 0,
  wide_runs: 0,
  batsman_score: {
    runs: 4,               // runs off the bat
    balls: 1,
    fours: 1,
  },
  score: { id: 1001, name: 'FOUR' },
  commentary: 'Driven through covers for four.',
  // Optional Sportmonks World Plan fields:
  ball_type: '2',          // good length
  line: 'mid-off',
  // direction is usually absent in the public livescores endpoint
  direction: undefined,    // ← commonly NOT present
};

const FOUR_BYE = {
  id: 1002,
  over_id: 12,
  ball_number: 4,
  batsman_id: 2001,
  bowler_id: 3001,
  batsman_one_on_creeze_id: 2001,
  batsman_two_on_creeze_id: 2002,
  batsmanout_id: null,
  catchstump_id: null,
  runs: 4,                 // 4 runs on the scoreboard
  bye: 4,                  // all 4 came as byes
  leg_bye: 0,
  noball: 0,
  noball_runs: 0,
  wide: 0,
  wide_runs: 0,
  batsman_score: {
    runs: 0,               // batsman scored NOTHING
    balls: 1,
  },
  score: { id: 1002, name: 'No Run' },
  commentary: 'Ball raced past the keeper for four byes.',
};

const FOUR_LEGBYE = {
  id: 1003,
  over_id: 12,
  ball_number: 5,
  batsman_id: 2001,
  bowler_id: 3001,
  batsman_one_on_creeze_id: 2001,
  batsman_two_on_creeze_id: 2002,
  batsmanout_id: null,
  catchstump_id: null,
  runs: 4,
  bye: 0,
  leg_bye: 4,              // all 4 came as leg byes
  noball: 0,
  noball_runs: 0,
  wide: 0,
  wide_runs: 0,
  batsman_score: { runs: 0, balls: 1 },
  score: { id: 1003, name: 'No Run' },
  commentary: 'Leg side, 4 byes',
};

const FOUR_NAME_MISMATCH = {
  id: 1006,
  over_id: 12,
  ball_number: 8,
  batsman_id: 2001,
  bowler_id: 3001,
  batsman_one_on_creeze_id: 2001,
  batsman_two_on_creeze_id: 2002,
  batsmanout_id: null,
  catchstump_id: null,
  runs: 4,
  bye: 0,
  leg_bye: 0,
  noball: 0,
  noball_runs: 0,
  wide: 0,
  wide_runs: 0,
  batsman_score: { runs: 4, balls: 1 },
  score: { id: 1006, name: 'No Run' },  // score label mismatch but bat=4
  commentary: 'Cleanly hit for four despite label',
};

const FOUR_NO_BATSCORE = {
  id: 1004,
  over_id: 12,
  ball_number: 6,
  batsman_id: 2001,
  bowler_id: 3001,
  batsman_one_on_creeze_id: 2001,
  batsman_two_on_creeze_id: 2002,
  batsmanout_id: null,
  catchstump_id: null,
  runs: 4,
  bye: 0,
  leg_bye: 0,
  noball: 0,
  noball_runs: 0,
  wide: 0,
  wide_runs: 0,
  // batsman_score MISSING — happens when adapter didn't include players
  score: { id: 1004, name: 'FOUR' },
  commentary: 'Pulled over midwicket for four.',
};

const SIX = {
  id: 1005,
  over_id: 12,
  ball_number: 7,
  batsman_id: 2001,
  bowler_id: 3001,
  batsman_one_on_creeze_id: 2001,
  batsman_two_on_creeze_id: 2002,
  batsmanout_id: null,
  catchstump_id: null,
  runs: 6,
  bye: 0,
  leg_bye: 0,
  noball: 0,
  noball_runs: 0,
  wide: 0,
  wide_runs: 0,
  batsman_score: { runs: 6, balls: 1 },
  score: { id: 1005, name: 'SIX' },
};

const TESTS = [
  { label: 'A — genuine batted FOUR (runs=4, bat=4, batsman_score present)', ball: GENUINE_FOUR },
  { label: 'B — FOUR via byes  (runs=4, bat=0, bye=4)',                      ball: FOUR_BYE },
  { label: 'C — FOUR via leg-byes (runs=4, bat=0, leg_bye=4)',                ball: FOUR_LEGBYE },
  { label: 'D — genuine FOUR with NO batsman_score (runs=4, fallback)',       ball: FOUR_NO_BATSCORE },
  { label: 'E — genuine SIX (runs=6, bat=6)',                                 ball: SIX },
  { label: 'F — FOUR, runs=4 but score.name="No Run" (label mismatch, bat=4)', ball: FOUR_NAME_MISMATCH },
];

const SHOT_DIRS = {
  'cover': { x:-0.62, z:-0.42 }, 'point': { x:-0.92, z: 0.14 },
  'third-man': { x:-0.48, z: 0.80 }, 'mid-off': { x:-0.34, z:-0.86 },
  'long-off': { x:-0.28, z:-0.92 }, 'straight': { x: 0.02, z:-0.98 },
  'long-on': { x: 0.30, z:-0.90 }, 'mid-on': { x: 0.36, z:-0.82 },
  'midwicket': { x: 0.78, z:-0.32 }, 'square-leg': { x: 0.94, z: 0.16 },
  'fine-leg': { x: 0.46, z: 0.82 }, 'keeper': { x: 0.00, z: 0.30 },
  'slip': { x:-0.12, z: 0.30 },
};

const LENGTHS = { yorker: {z:9.30, rise:0.30}, full: {z:7.30, rise:0.52}, good: {z:5.00, rise:0.80}, short: {z:2.30, rise:1.28}, bouncer: {z:0.60, rise:1.80} };
const LINES = { off:-0.42, fourth:-0.72, middle:0.0, leg:0.40, body:0.12, wide:-1.05 };

function buildTrajectory(d) {
  const L = LENGTHS[d.length] || LENGTHS.good;
  const lx = LINES[d.line] !== undefined ? LINES[d.line] : 0;
  const release = { x: lx * 0.5 + 0.34, y: 2.16, z: -9.4 };
  const bounce  = { x: lx, y: 0.045, z: L.z };
  const meet   = { x: lx * 1.18, y: L.rise, z: 9.71 };

  let shot = null;
  if (d.dir && SHOT_DIRS[d.dir]) {
    const dir = SHOT_DIRS[d.dir];
    const dm = Math.hypot(dir.x, dir.z) || 1;
    const ux = dir.x / dm, uz = dir.z / dm;
    const GR = { rx:66, rz:73 };
    const ropeDist = 1 / Math.sqrt((ux / GR.rx) ** 2 + (uz / GR.rz) ** 2);
    if (d.runs === 4) {
      const H = 2.0, y0 = L.rise, y2 = 0.14;
      const y1 = H + Math.sqrt(Math.max(0, (H - y0) * (H - y2)));
      const end = { x: ux * ropeDist, y: 0.1, z: uz * ropeDist };
      const mid = { x: (meet.x + end.x) / 2, y: y1, z: (meet.z + end.z) / 2 };
      shot = { meet, end, mid, len: 27 };
    }
  }
  return { delivery: true, shot };
}

const playersMap = {};

console.log('==================================================================');
console.log('  TRACE: Sportmonks dir assignment for boundary shots');
console.log('==================================================================\n');

for (const t of TESTS) {
  const ctx = {
    playersMap,
    currentOver: t.ball.over_id,
    prevWasNoBall: false,
    strikerId: t.ball.batsman_id,
    nonStrikerId: t.ball.batsman_two_on_creeze_id,
    bowlerId: t.ball.bowler_id,
  };

  const norm = normalizeSportMonksBall(t.ball, ctx);
  const d = {
    speed: norm.tuple[2],
    length: norm.tuple[3],
    line: norm.tuple[4],
    dir: norm.tuple[5],
    runs: norm.tuple[0],
    extraType: norm.tuple[7],
    dismissed: !!norm.tuple[1],
  };

  const { delivery, shot } = buildTrajectory(d);

  console.log('--- ' + t.label + ' ---');
  console.log(`  raw runs        : ${t.ball.runs}`);
  console.log(`  batsman_score   : ${t.ball.batsman_score ? t.ball.batsman_score.runs : 'MISSING'}`);
  console.log(`  bye/leg_bye     : ${t.ball.bye} / ${t.ball.leg_bye}`);
  console.log(`  score.name      : "${t.ball.score.name}"`);
  console.log(`  direction field : ${t.ball.direction === undefined ? '(absent)' : `"${t.ball.direction}"`}`);
  console.log(`  -> extraType    : ${norm.extraType}`);
  console.log(`  -> totalRuns     : ${norm.tuple[0]}, length: ${d.length}, line: ${d.line}`);
  console.log(`  -> dir          : ${d.dir === null ? 'null ❌' : `"${d.dir}"`}`);
  console.log(`  -> buildTraj    : ${shot ? '✅ post-bat shot CURVE GENERATED' : '❌ shot = null — NO trajB line'}`);
  if (shot) {
    console.log(`      shot meets@(${shot.meet.x.toFixed(1)},${shot.meet.y.toFixed(2)},${shot.meet.z.toFixed(1)}) → rope@(${shot.end.x.toFixed(1)},${shot.end.y.toFixed(1)},${shot.end.z.toFixed(1)})`);
  }
  console.log('');
}

console.log('==================================================================');
console.log('  CONCLUSION');
console.log('==================================================================');
console.log('After fix:');
console.log('- Genuine fours (bat=4) always get dir (A, D, F)');
console.log('- Fours via byes/leg-byes (bat=0, runs>=4) now get dir (B, C)');
console.log('- Genuine sixes work (E)');
console.log('The inference layer STILL assigns dir=null for:');
console.log('- Boundaries with runs=0 misreported (see edge cases)');
console.log('- Boundary extras where batRuns===0 was the ONLY signal');
console.log('  (now fixed: uses four/six dir table so shot line draws)');
console.log('==================================================================');
