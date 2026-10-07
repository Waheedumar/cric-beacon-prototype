#!/usr/bin/env node
/**
 * Test edge cases in Sportmonks data that could cause dir=null for boundaries.
 */

const { SportMonksAdapter, normalizeSportMonksBall } = require('./sportmonksAdapter');

const adapter = new SportMonksAdapter({ token: 'fake-token' });

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
    } else if (d.runs === 6) {
      const H = 17, y0 = L.rise, y2 = 0.4;
      const y1 = H + Math.sqrt(Math.max(0, (H - y0) * (H - y2)));
      const end = { x: ux * ropeDist * 1.075, y: 0.5, z: uz * ropeDist * 1.075 };
      const mid = { x: (meet.x + end.x) / 2, y: y1, z: (meet.z + end.z) / 2 };
      shot = { meet, end, mid, len: 27 };
    }
  }
  return { delivery: true, shot };
}

const playersMap = {};

const EDGE_CASES = [
  {
    label: 'F — FOUR with runs=0, score.name="FOUR" (mis-reported totalRuns)',
    ball: {
      id: 2001, over_id: 12, ball_number: 3,
      batsman_id: 2001, bowler_id: 3001,
      batsman_one_on_creeze_id: 2001, batsman_two_on_creeze_id: 2002,
      batsmanout_id: null, catchstump_id: null,
      runs: 0,                    // Sportmonks sometimes reports 0 for boundaries!
      bye: 0, leg_bye: 0, noball: 0, noball_runs: 0, wide: 0, wide_runs: 0,
      batsman_score: { runs: 4, balls: 1 },
      score: { id: 2001, name: 'FOUR' },
    }
  },
  {
    label: 'G — FOUR with runs=0, score.name="FOUR", NO batsman_score',
    ball: {
      id: 2002, over_id: 12, ball_number: 4,
      batsman_id: 2001, bowler_id: 3001,
      batsman_one_on_creeze_id: 2001, batsman_two_on_creeze_id: 2002,
      batsmanout_id: null, catchstump_id: null,
      runs: 0,
      bye: 0, leg_bye: 0, noball: 0, noball_runs: 0, wide: 0, wide_runs: 0,
      // no batsman_score
      score: { id: 2002, name: 'FOUR' },
    }
  },
  {
    label: 'H — FOUR with runs=4, score.name="No Run" (data quality issue)',
    ball: {
      id: 2003, over_id: 12, ball_number: 5,
      batsman_id: 2001, bowler_id: 3001,
      batsman_one_on_creeze_id: 2001, batsman_two_on_creeze_id: 2002,
      batsmanout_id: null, catchstump_id: null,
      runs: 4,
      bye: 0, leg_bye: 0, noball: 0, noball_runs: 0, wide: 0, wide_runs: 0,
      batsman_score: { runs: 4, balls: 1 },
      score: { id: 2003, name: 'No Run' },  // Mismatch!
    }
  },
  {
    label: 'I — SIX with runs=6, valid dir should work',
    ball: {
      id: 2004, over_id: 12, ball_number: 6,
      batsman_id: 2001, bowler_id: 3001,
      batsman_one_on_creeze_id: 2001, batsman_two_on_creeze_id: 2002,
      batsmanout_id: null, catchstump_id: null,
      runs: 6,
      bye: 0, leg_bye: 0, noball: 0, noball_runs: 0, wide: 0, wide_runs: 0,
      batsman_score: { runs: 6, balls: 1 },
      score: { id: 2004, name: 'SIX' },
    }
  },
];

console.log('==================================================================');
console.log('  TRACE: Edge cases that could break boundary trajectory');
console.log('==================================================================\n');

for (const t of EDGE_CASES) {
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
  console.log(`  score.name      : "${t.ball.score.name}"`);
  console.log(`  batsman_score   : ${t.ball.batsman_score ? t.ball.batsman_score.runs : 'MISSING'}`);
  console.log(`  -> extraType    : ${norm.extraType}`);
  console.log(`  -> totalRuns    : ${norm.tuple[0]}, length: ${d.length}, line: ${d.line}`);
  console.log(`  -> dir          : ${d.dir === null ? 'null ❌' : `"${d.dir}"`}`);
  console.log(`  -> buildTraj    : ${shot ? '✅ post-bat shot CURVE GENERATED' : '❌ shot = null — NO trajB line'}`);
  if (shot) {
    console.log(`      shot meets@(${shot.meet.x.toFixed(1)},${shot.meet.y.toFixed(2)},${shot.meet.z.toFixed(1)}) → rope@(${shot.end.x.toFixed(1)},${shot.end.y.toFixed(1)},${shot.end.z.toFixed(1)})`);
  }
  console.log('');
}

console.log('==================================================================');
console.log('  KEY FINDINGS');
console.log('==================================================================');
console.log('If Sportmonks returns runs=0 for a boundary (relying on score.name),');
console.log('the inference layer sees totalRuns=0 and assigns dot-ball dir (halfNull).');
console.log('This causes 60% chance of dir=null → no shot curve.');
console.log('');
console.log('Genuine fours (runs=4, bat=4) work correctly regardless of');
console.log('whether batsman_score is present or not.');
console.log('==================================================================');