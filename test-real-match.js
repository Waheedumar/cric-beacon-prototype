// test-real-match.js
// Fetches REAL Sportmonks match data via fixtures endpoint and validates trajectory building

const THREE = require('three');
const { SportMonksAdapter, normalizeSportMonksBall } = require('./sportmonksAdapter');

/* ===================================================================
   buildTrajectory + helpers — copied from index.html / test-trajectory.js
   =================================================================== */

const SHOT_DIRS = {
  'cover':      { x: -0.62, z: -0.42 },
  'point':      { x: -0.92, z:  0.14 },
  'third-man':  { x: -0.48, z:  0.80 },
  'mid-off':    { x: -0.34, z: -0.86 },
  'long-off':   { x: -0.28, z: -0.92 },
  'straight':   { x:  0.02, z: -0.98 },
  'long-on':    { x:  0.30, z: -0.90 },
  'mid-on':     { x:  0.36, z: -0.82 },
  'midwicket':  { x:  0.78, z: -0.32 },
  'square-leg': { x:  0.94, z:  0.16 },
  'fine-leg':   { x:  0.46, z:  0.82 },
  'keeper':     { x:  0.00, z:  0.30 },
  'slip':       { x: -0.12, z:  0.30 }
};

const LENGTHS = {
  yorker : { z: 9.30, rise: 0.30, label: 'Yorker' },
  full   : { z: 7.30, rise: 0.52, label: 'Full' },
  good   : { z: 5.00, rise: 0.80, label: 'Good Length' },
  short  : { z: 2.30, rise: 1.28, label: 'Short of a Length' },
  bouncer: { z: 0.60, rise: 1.80, label: 'Bouncer' }
};
const LINES = { off: -0.42, fourth: -0.72, middle: 0.0, leg: 0.40, body: 0.12, wide: -1.05 };
const GR = { rx: 66, rz: 73 };
const STUMP_Z = 10.06;

/* ===================================================================
   inferDelivery — outcome + phase → {length, line, dir}
   Only returns keys that exist in LENGTHS, LINES, SHOT_DIRS.
   Seeded by ball id so same ball always replays identically.
   =================================================================== */

const LENGTH_KEYS = Object.keys(LENGTHS);        // ['yorker','full','good','short','bouncer']
const LINE_KEYS   = Object.keys(LINES);          // ['off','fourth','middle','leg','body','wide']
const DIR_KEYS    = Object.keys(SHOT_DIRS);      // ['cover','point',...]

// Seeded random: xorshift32 from ball id
function seededRandom(id) {
  let x = (Number(id) || 1) >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  return (x >>> 0) / 4294967296;
}

// Phase from over.ball string like "18.3" → over number
function getPhase(overBall) {
  if (!overBall) return 'middle';
  const over = Math.floor(Number(overBall));
  if (over <= 6) return 'powerplay';
  if (over >= 16) return 'death';
  return 'middle';
}

function inferDelivery(smBall, context) {
  // Priority: use real Sportmonks fields if present
  const realLength = smBall.ball_type ? _mapBallType(smBall.ball_type) : null;
  const realLine   = smBall.line      ? _mapLine(smBall.line)       : null;
  const realDir    = smBall.direction ? _mapDirection(smBall.direction) : null;

  // If all three present, nothing to infer
  if (realLength && realLine && realDir) {
    return { length: realLength, line: realLine, dir: realDir, inferred: false };
  }

  const scoreName = (smBall.score?.name || '').trim();
  const runs = Number(smBall.score?.runs) || 0;
  const isWide = smBall.score?.wide === 1 || /wide/i.test(scoreName);
  const isNoBall = smBall.score?.noball === 1 || /no.?ball/i.test(scoreName);
  const isBye = /bye/i.test(scoreName) && !isNoBall;
  const isWicket = smBall.batsmanout_id != null;
  const isFour = scoreName === 'FOUR' || runs === 4;
  const isSix = scoreName === 'SIX' || runs === 6;
  const isDot = scoreName === 'No Run' || (runs === 0 && !isWicket && !isWide && !isNoBall && !isBye);

  const phase = getPhase(smBall.ball);  // e.g. "18.3"
  const r = seededRandom(smBall.id);

  // Start with nulls — we'll fill in missing ones
  let length = realLength;
  let line   = realLine;
  let dir    = realDir;

  // ---- LENGTH inference ----
  if (!length) {
    if (isWicket && (scoreName.includes('Bowled') || scoreName.includes('LBW'))) {
      // Bowled/LBW → full or yorker
      length = (phase === 'death' || r < 0.35) ? 'yorker' : 'full';
    } else if (isWicket && scoreName.includes('Stump')) {
      // Stumping → full
      length = 'full';
    } else if (isWide) {
      length = 'full';  // wides tend to be fuller
    } else if (isSix) {
      length = r < 0.5 ? 'full' : 'short';
    } else if (isFour) {
      length = r < 0.4 ? 'full' : 'good';
    } else if (isDot) {
      length = phase === 'death' ? 'good' : (r < 0.5 ? 'good' : 'short');
    } else {
      // 1/2/3 runs, leg byes, etc.
      if (phase === 'death') {
        length = r < 0.6 ? 'full' : 'yorker';
      } else if (phase === 'powerplay') {
        length = r < 0.5 ? 'good' : 'full';
      } else {
        length = r < 0.6 ? 'good' : 'full';
      }
    }
  }

  // ---- LINE inference ----
  if (!line) {
    if (isWide) {
      line = 'wide';
    } else if (isWicket) {
      if (scoreName.includes('Bowled') || scoreName.includes('LBW')) {
        line = r < 0.6 ? 'middle' : 'off';
      } else if (scoreName.includes('Catch') && (scoreName.includes('behind') || r < 0.3)) {
        line = r < 0.5 ? 'off' : 'fourth';
      } else if (scoreName.includes('Stump')) {
        line = 'off';
      } else if (scoreName.includes('Run Out')) {
        line = r < 0.5 ? 'off' : 'middle';
      } else {
        line = 'off';
      }
    } else if (isSix) {
      line = r < 0.4 ? 'middle' : (r < 0.7 ? 'off' : 'leg');
    } else if (isFour) {
      line = r < 0.4 ? 'off' : (r < 0.7 ? 'middle' : 'leg');
    } else if (isDot) {
      line = r < 0.4 ? 'off' : (r < 0.7 ? 'middle' : 'leg');
    } else {
      line = r < 0.5 ? 'off' : 'middle';
    }
  }

  // ---- DIR inference ----
  if (!dir) {
    if (isWicket) {
      if (scoreName.includes('Catch')) {
        // Caught behind → keeper/slip, elsewhere → infield/outfield
        if (r < 0.4 || scoreName.includes('behind')) {
          dir = r < 0.5 ? 'keeper' : 'slip';
        } else {
          dir = DIR_KEYS[Math.floor(r * DIR_KEYS.length)];
        }
      } else if (scoreName.includes('Bowled') || scoreName.includes('LBW') || scoreName.includes('Stump')) {
        dir = null;  // no shot direction for bowled/lbw/stumped
      } else if (scoreName.includes('Run Out')) {
        dir = DIR_KEYS[Math.floor(r * DIR_KEYS.length)];
      } else {
        dir = null;
      }
    } else if (isSix) {
      dir = r < 0.3 ? 'long-on' : (r < 0.55 ? 'midwicket' : (r < 0.75 ? 'long-off' : 'straight'));
    } else if (isFour) {
      dir = r < 0.25 ? 'cover' : (r < 0.45 ? 'midwicket' : (r < 0.65 ? 'point' : (r < 0.85 ? 'square-leg' : 'third-man')));
    } else if (isDot) {
      // Dot balls — often soft hands into infield or no shot
      dir = r < 0.6 ? null : DIR_KEYS[Math.floor(r * DIR_KEYS.length)];
    } else if (isWide || isNoBall) {
      dir = null;
    } else {
      // 1/2/3 runs, leg byes
      dir = DIR_KEYS[Math.floor(r * DIR_KEYS.length)];
    }
  }

  return { length, line, dir, inferred: true };
}

// Mapping helpers (copied from sportmonksAdapter.js to avoid dependency)
function _mapBallType(bt) {
  if (!bt) return null;
  const BALL_TYPE_MAP = {
    '0': 'yorker', '1': 'full', '2': 'good', '3': 'short', '4': 'bouncer',
    yorker: 'yorker', full: 'full', good: 'good', short: 'short', bouncer: 'bouncer',
  };
  const mapped = BALL_TYPE_MAP[String(bt).toLowerCase()];
  return LENGTH_KEYS.includes(mapped) ? mapped : null;
}

function _mapLine(line) {
  if (!line) return null;
  const l = String(line).toLowerCase();
  const map = { off:'off', fourth:'fourth', middle:'middle', leg:'leg', body:'body', wide:'wide' };
  return LINE_KEYS.includes(map[l]) ? map[l] : null;
}

function _mapDirection(dir) {
  if (!dir) return null;
  const d = String(dir).toLowerCase();
  const map = {
    cover:'cover', point:'point', 'third man':'third-man', 'third-man':'third-man',
    'mid-off':'mid-off', 'long off':'long-off', 'long-off':'long-off',
    straight:'straight', 'long on':'long-on', 'long-on':'long-on',
    'mid-on':'mid-on', midwicket:'midwicket', 'square leg':'square-leg', 'square-leg':'square-leg',
    'fine leg':'fine-leg', 'fine-leg':'fine-leg', keeper:'keeper', slip:'slip',
  };
  return DIR_KEYS.includes(map[d]) ? map[d] : null;
}

function quad(p0, p1, p2, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push(new THREE.Vector3(
      u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
      u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z
    ));
  }
  return pts;
}

function buildTrajectory(d) {
  const L  = LENGTHS[d.length] || LENGTHS.good;
  const lx = LINES[d.line] !== undefined ? LINES[d.line] : 0;

  const release = new THREE.Vector3(lx * 0.5 + 0.34, 2.16, -9.4);
  const bounce  = new THREE.Vector3(lx, 0.045, L.z);
  const apex    = new THREE.Vector3((release.x + bounce.x) / 2, 2.34, (release.z + bounce.z) / 2);
  const pre = quad(release, apex, bounce, 20);

  const meet   = new THREE.Vector3(lx * 1.18, L.rise, STUMP_Z - 0.35);
  const apex2  = new THREE.Vector3((bounce.x + meet.x) / 2, L.rise * 1.42 + 0.16, (bounce.z + meet.z) / 2);
  const post = quad(bounce, apex2, meet, 16);

  const delivery = pre.concat(post.slice(1));

  let shot = null;
  if (d.dir && SHOT_DIRS[d.dir]) {
    const dir = SHOT_DIRS[d.dir];
    const reach = d.runs >= 4 ? 1.0 : d.dismissed ? 0.24 : 0.42 + d.runs * 0.10;
    const end = new THREE.Vector3(dir.x * GR.rx * reach, d.runs === 6 ? 0.4 : 0.14, dir.z * GR.rz * reach);
    if (d.dismissed) end.set(dir.x * 18, 0.95, 12 + dir.z * 8);
    const height = d.runs === 6 ? 13 : d.runs === 4 ? 2.4 : d.dismissed ? 1.9 : 3.2;
    const mid = new THREE.Vector3((meet.x + end.x) / 2, height, (meet.z + end.z) / 2);
    shot = quad(meet, mid, end, 26);
  }
  return { delivery, shot, bounce };
}

/* ===================================================================
   MAIN
   =================================================================== */

async function run() {
  console.log('🏏 Fetching REAL Sportmonks fixture data...\n');

  // 1. Get token (never printed)
  const token = process.env.SPORTMONKS_API_TOKEN || process.env.VITE_SPORTMONKS_API_TOKEN;
  if (!token) {
    console.error('❌ No token found. Set SPORTMONKS_API_TOKEN or VITE_SPORTMONKS_API_TOKEN in .env.local');
    process.exit(1);
  }

  const adapter = new SportMonksAdapter({
    token,
    retry: { maxAttempts: 3, baseDelay: 500, jitter: 0.3 }
  });

  let fixtureId = null;
  let fixtureData = null;

  // 2. Fetch finished fixtures, sorted by start time desc
  try {
    console.log('1️⃣  Fetching finished fixtures...');
    const fixturesResp = await adapter.fetch('/fixtures?filter[status]=Finished&sort=-starting_at');
    const fixtures = fixturesResp.data || fixturesResp;
    if (!fixtures || !fixtures.length) {
      console.error('❌ No finished fixtures returned');
      process.exit(1);
    }
    console.log(`   Found ${fixtures.length} finished fixtures. Checking first 5 for ball-by-ball data...\n`);

    // 3. Check first 5 for balls
    for (let i = 0; i < Math.min(5, fixtures.length); i++) {
      const f = fixtures[i];
      const id = f.id;
      console.log(`   Checking fixture ${id}...`);
      try {
        const detailResp = await adapter.fetch(`/fixtures/${id}?include=balls`);
        const detail = detailResp.data || detailResp;
        const balls = detail.balls || [];
        if (balls.length > 0) {
          fixtureId = id;
          fixtureData = detail;
          console.log(`   ✅ Fixture ${id} has ${balls.length} balls. Using this one.\n`);
          break;
        } else {
          console.log(`   ⏭️  Fixture ${id} has 0 balls.`);
        }
      } catch (err) {
        console.log(`   ⚠️  Fixture ${id} fetch failed: ${err.message}`);
      }
    }

    if (!fixtureId) {
      console.error('❌ No fixture with ball-by-ball data found in first 5 finished fixtures');
      process.exit(1);
    }

  } catch (err) {
    handleFetchError(err, 'fixtures list');
  }

  // 4. Print raw field names of one sample ball
  const sampleBall = fixtureData.balls[0];
  console.log('2️⃣  Raw field names of one sample ball:');
  console.log('   ', Object.keys(sampleBall).sort().join(', '));
  console.log();

  // 5. Build playersMap from ball data (sub-objects with fullname)
  const playersMap = {};
  fixtureData.balls.forEach(b => {
    [b.batsman, b.bowler, b.batsmanone, b.batsmantwo, b.batsmanout, b.catchstump]
      .forEach(p => { if (p && p.id && p.fullname) playersMap[String(p.id)] = p.fullname; });
  });
  // Also from batting array if present
  (fixtureData.batting || []).forEach(e => {
    if (e.player_id && e.player?.fullname) playersMap[String(e.player_id)] = e.player.fullname;
    if (e.bowling_player_id && e.bowling_player?.fullname) playersMap[String(e.bowling_player_id)] = e.bowling_player.fullname;
    if (e.catch_stump_player_id && e.catch_stump_player?.fullname) playersMap[String(e.catch_stump_player_id)] = e.catch_stump_player.fullname;
    if (e.runout_by_id && e.runout_by?.fullname) playersMap[String(e.runout_by_id)] = e.runout_by.fullname;
  });

  // 6. Normalize every ball through adapter + run buildTrajectory
  console.log('3️⃣  Normalizing all balls and testing trajectory generation...\n');

  let totalBalls = 0;
  let crashCount = 0;
  let nanCount = 0;
  let unmappedCount = 0;
  const unmappedDetails = [];

  // Distribution counters for length / line / dir (after adapter)
  const lenDist = {};
  const lineDist = {};
  const dirDist = {};
  const extraDist = {};

  let prevWasNoBall = false;

  for (const smBall of fixtureData.balls) {
    totalBalls++;
    const overNum = smBall.over_id || smBall.over || 1;

    const ctx = {
      playersMap,
      currentOver: overNum,
      prevWasNoBall,
      strikerId: smBall.batsman?.id || smBall.batsman_id,
      nonStrikerId: smBall.batsmanone?.id || smBall.batsman_two_on_creeze_id,
      bowlerId: smBall.bowler?.id || smBall.bowler_id,
    };

    let normResult;
    try {
      normResult = normalizeSportMonksBall(smBall, ctx);
    } catch (e) {
      crashCount++;
      unmappedCount++;
      unmappedDetails.push({ ballId: smBall.id || totalBalls, reason: `normalizeSportMonksBall threw: ${e.message}` });
      prevWasNoBall = false;
      continue;
    }

    const tuple = normResult.tuple;
    if (!Array.isArray(tuple) || tuple.length < 7 || tuple[0] === undefined) {
      crashCount++;
      unmappedCount++;
      unmappedDetails.push({ ballId: smBall.id || totalBalls, reason: 'normalized tuple invalid/missing runs' });
      prevWasNoBall = false;
      continue;
    }

    // Build delivery object for buildTrajectory
    const d = {
      speed: tuple[2],
      length: tuple[3],
      line: tuple[4],
      dir: tuple[5],
      runs: tuple[0],
      dismissed: !!tuple[1]
    };

    // Record distribution (after adapter)
    const lenKey = d.length === null || d.length === undefined ? '(null)' : d.length;
    const lineKey = d.line === null || d.line === undefined ? '(null)' : d.line;
    const dirKey = d.dir === null || d.dir === undefined ? '(null)' : d.dir;
    lenDist[lenKey] = (lenDist[lenKey] || 0) + 1;
    lineDist[lineKey] = (lineDist[lineKey] || 0) + 1;
    dirDist[dirKey] = (dirDist[dirKey] || 0) + 1;
    if (normResult.extraType) extraDist[normResult.extraType] = (extraDist[normResult.extraType] || 0) + 1;

    // Test trajectory
    try {
      const { delivery, shot } = buildTrajectory(d);
      const cDel = new THREE.CatmullRomCurve3(delivery);

      // Sample points
      for (let u = 0; u <= 1; u += 0.1) {
        const pt = cDel.getPointAt(u);
        if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y) || !Number.isFinite(pt.z)) {
          console.log(`  ❌ NaN point at u=${u} for ball ${totalBalls}`);
          nanCount++;
        }
      }

      // getPoints with various segment counts (guarded)
      for (const seg of [0, 1, 2, 5, 10, 50]) {
        try {
          const pts = cDel.getPoints(Math.max(1, seg));
          if (pts.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z))) {
            console.log(`  ❌ NaN in getPoints(${seg}) for ball ${totalBalls}`);
            nanCount++;
          }
        } catch (e) {
          console.log(`  ❌ ERROR getPoints(${seg}) for ball ${totalBalls}: ${e.message}`);
          crashCount++;
        }
      }

      if (shot) {
        const cShot = new THREE.CatmullRomCurve3(shot);
        for (const seg of [0, 1, 2, 5, 10, 40]) {
          try {
            const pts = cShot.getPoints(Math.max(1, seg));
            if (pts.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z))) {
              console.log(`  ❌ NaN in shot getPoints(${seg}) for ball ${totalBalls}`);
              nanCount++;
            }
          } catch (e) {
            console.log(`  ❌ ERROR shot getPoints(${seg}) for ball ${totalBalls}: ${e.message}`);
            crashCount++;
          }
        }
      }
    } catch (e) {
      console.log(`  ❌ ERROR buildTrajectory for ball ${totalBalls}: ${e.message}`);
      crashCount++;
    }

    // Update prevWasNoBall for next ball
    prevWasNoBall = normResult.extraType === 'noball';

    // Progress log every 50 balls
    if (totalBalls % 50 === 0) {
      console.log(`   Processed ${totalBalls} balls...`);
    }
  }

  // 7. Distribution report
  console.log('\n📈 DISTRIBUTION (after adapter):');
  console.log('   Length:', Object.entries(lenDist).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join(' '));
  console.log('   Line:  ', Object.entries(lineDist).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join(' '));
  console.log('   Dir:   ', Object.entries(dirDist).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join(' '));
  console.log('   Extra: ', Object.entries(extraDist).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join(' '));

  // 8. Report
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`Fixture ID:        ${fixtureId}`);
  console.log(`Total balls:       ${totalBalls}`);
  console.log(`Crashes:           ${crashCount}`);
  console.log(`NaN points:        ${nanCount}`);
  console.log(`Unmapped balls:    ${unmappedCount}`);
  if (unmappedDetails.length > 0) {
    console.log('\n🔍 Unmapped ball details:');
    unmappedDetails.forEach(u => console.log(`   - Ball ${u.ballId}: ${u.reason}`));
  }
  console.log('='.repeat(60));

  // 8. Exit code
  if (crashCount > 0 || nanCount > 0 || unmappedCount > 0 || totalBalls === 0) {
    console.log('❌ VALIDATION FAILED');
    process.exit(1);
  } else {
    console.log('✅ ALL BALLS PASSED');
    process.exit(0);
  }
}

function handleFetchError(err, context) {
  const msg = err.message || String(err);
  if (msg.includes('401')) {
    console.error('❌ 401 Unauthorized — invalid or missing API token');
  } else if (msg.includes('403')) {
    console.error('❌ 403 Forbidden — token valid but plan does not cover this endpoint');
  } else {
    console.error(`❌ Failed to fetch ${context}: ${msg}`);
  }
  process.exit(1);
}

run().catch(err => {
  handleFetchError(err, 'unexpected');
});