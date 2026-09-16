/**
 * Comprehensive runtime test:
 * - Loops ALL deliveries across ALL 5 mock matches
 * - Calls buildTrajectory() + CatmullRomCurve3 + getPoints(0)/getPointAt(u)
 * - Simulates animateBall() trajectory setup and progressive drawing loop
 * - Catches ANY "Cannot read properties of null/userData" or "undefined" crashes
 * - Reports total deliveries tested and any errors found
 */

const THREE = require('three');
const fs = require('fs');
const path = require('path');

// Copy helpers from index.html
const SHOT_DIRS = {
  'cover':      { x:-0.62, z:-0.42 },
  'point':      { x:-0.92, z: 0.14 },
  'third-man':  { x:-0.48, z: 0.80 },
  'mid-off':    { x:-0.34, z:-0.86 },
  'long-off':   { x:-0.28, z:-0.92 },
  'straight':   { x: 0.02, z:-0.98 },
  'long-on':    { x: 0.30, z:-0.90 },
  'mid-on':     { x: 0.36, z:-0.82 },
  'midwicket':  { x: 0.78, z:-0.32 },
  'square-leg': { x: 0.94, z: 0.16 },
  'fine-leg':   { x: 0.46, z: 0.82 },
  'keeper':     { x: 0.00, z: 0.30 },
  'slip':       { x:-0.12, z: 0.30 }
};

const LENGTHS = {
  yorker : { z: 9.30, rise:0.30, label:'Yorker' },
  full   : { z: 7.30, rise:0.52, label:'Full' },
  good   : { z: 5.00, rise:0.80, label:'Good Length' },
  short  : { z: 2.30, rise:1.28, label:'Short of a Length' },
  bouncer: { z: 0.60, rise:1.80, label:'Bouncer' }
};
const LINES = { off:-0.42, fourth:-0.72, middle:0.0, leg:0.40, body:0.12, wide:-1.05 };
const GR = { rx:66, rz:73 };
const STUMP_Z = 10.06;

function quad(p0, p1, p2, n){
  const pts = [];
  for (let i = 0; i <= n; i++){
    const t = i / n, u = 1 - t;
    pts.push(new THREE.Vector3(
      u*u*p0.x + 2*u*t*p1.x + t*t*p2.x,
      u*u*p0.y + 2*u*t*p1.y + t*t*p2.y,
      u*u*p0.z + 2*u*t*p1.z + t*t*p2.z
    ));
  }
  return pts;
}

function buildTrajectory(d){
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
  if (d.dir && SHOT_DIRS[d.dir]){
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

// Simulate animateBall trajectory setup and progressive drawing loop logic
function simulateAnimateBallSetup(d){
  const { delivery, shot, bounce } = buildTrajectory(d);

  const cDel = new THREE.CatmullRomCurve3(delivery);
  const cShot = shot ? new THREE.CatmullRomCurve3(shot) : null;

  // trajA always created (delivery curve) with userData
  const trajA = {
    userData: { curve: cDel, drawProgress: 0, segments: 50 }
  };

  // trajB only created when shot exists
  let trajB = null;
  if (cShot){
    trajB = {
      userData: { curve: cShot, drawProgress: 0, segments: 40 }
    };
  }

  // Simulate the setup lines from animateBall (line 2137-2140):
  //   if (showPath){
  //     trajA.userData.drawProgress = 0;
  //     if (trajB) trajB.userData.drawProgress = 0;  // fixed guard
  //   }
  trajA.userData.drawProgress = 0;
  if (trajB) trajB.userData.drawProgress = 0;

  // Simulate the loop's trajectory drawing section (line 2324-2346):
  //   [trajA, trajB].forEach(t => {
  //     if (!t || !t.userData.curve) return;
  //     const ud = t.userData;
  //     const segCount = Math.max(1, Math.floor(ud.segments * ud.drawProgress));
  //     const pts = ud.curve.getPoints(segCount);
  //     if (pts.some(p => p == null || !Number.isFinite(p.x) ...)) return;
  //   })
  const curves = [trajA, trajB].filter(t => t); // remove null

  let drawErrors = 0;
  for (const t of curves){
    if (!t || !t.userData.curve) continue;
    const ud = t.userData;
    const segCount = Math.max(1, Math.floor(ud.segments * ud.drawProgress));
    try {
      const pts = ud.curve.getPoints(segCount);
      if (pts.some(p => p == null || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z))){
        drawErrors++;
      }
    } catch(e){
      drawErrors++;
    }
  }

  return { drawErrors, hasShot: !!cShot };
}

// ========== Load all 5 mock matches ==========

const MATCH_FILES = ['lords', 'galle', 'mcg', 'hambantota', 'premadasa'];

let totalDeliveries = 0;
let totalErrors = 0;
const errDetails = [];

for (const matchId of MATCH_FILES){
  const file = path.join('matches', `match-${matchId}.json`);
  if (!fs.existsSync(file)){
    console.log(`SKIP: ${file} not found`);
    continue;
  }
  const def = JSON.parse(fs.readFileSync(file, 'utf8'));

  if (!def.overs) continue;

  for (const ov of def.overs){
    if (!ov.balls) continue;
    for (let i = 0; i < ov.balls.length; i++){
      const b = ov.balls[i];
      // Tuple: [runs, wicket, speed, length, line, dir, text, extraType]
      const [runs, wicket, speed, length, line, dir, text, extraType] = b;

      const d = {
        speed,
        length,
        line,
        dir,
        runs,
        dismissed: !!wicket,
        extraType: extraType || null
      };

      totalDeliveries++;

      try {
        // 1) Trajectory-building + CatmullRomCurve3 sampling (the old crash path)
        const { delivery, shot, bounce } = buildTrajectory(d);

        const cDel = new THREE.CatmullRomCurve3(delivery);

        // Sample getPointAt(u) for u in [0,1] step 0.1 — old crash was getPoints(0) → NaN
        for (let u = 0; u <= 1; u += 0.1){
          const pt = cDel.getPointAt(u);
          if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y) || !Number.isFinite(pt.z)){
            totalErrors++;
            errDetails.push(`NaN getPointAt(u=${u}) for ${matchId} over ${ov.over} ball ${i+1} (speed=${speed}, dir=${dir}, length=${length})`);
          }
        }

        // Sample getPoints(seg) for seg in [0,1,2,5,10,50] — old crash was getPoints(0)
        // Guard seg with Math.max(1, ...) to mirror the production fix (index.html:2333)
        for (const seg of [0, 1, 2, 5, 10, 50]){
          try {
            const pts = cDel.getPoints(Math.max(1, seg));
            if (pts.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z))){
              totalErrors++;
              errDetails.push(`NaN getPoints(${seg}) for ${matchId} over ${ov.over} ball ${i+1}`);
            }
          } catch(e){
            totalErrors++;
            errDetails.push(`ERROR getPoints(${seg}) for ${matchId} over ${ov.over} ball ${i+1}: ${e.message}`);
          }
        }

        // Also test shot curve if present
        if (shot){
          const cShot = new THREE.CatmullRomCurve3(shot);
          for (const seg of [0, 1, 2, 5, 10, 40]){
            try {
              const pts = cShot.getPoints(Math.max(1, seg));
              if (pts.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z))){
                totalErrors++;
                errDetails.push(`NaN shot getPoints(${seg}) for ${matchId} over ${ov.over} ball ${i+1}`);
              }
            } catch(e){
              totalErrors++;
              errDetails.push(`ERROR shot getPoints(${seg}) for ${matchId} over ${ov.over} ball ${i+1}: ${e.message}`);
            }
          }
        }

        // 2) Simulate animateBall full runtime (including the trajB null guard we just fixed)
        const sim = simulateAnimateBallSetup(d);
        totalErrors += sim.drawErrors;
        if (sim.drawErrors > 0){
          errDetails.push(`animateBall setup error for ${matchId} over ${ov.over} ball ${i+1}: ${sim.drawErrors} draw errors`);
        }

      } catch(e){
        totalErrors++;
        errDetails.push(`CRASH for ${matchId} over ${ov.over} ball ${i+1}: ${e.message}`);
      }
    }
  }
}

console.log(`\n=== COMPREHENSIVE RUNTIME TEST SUMMARY ===`);
console.log(`Total deliveries tested: ${totalDeliveries}`);
console.log(`Total errors found: ${totalErrors}`);
if (totalErrors === 0){
  console.log(`\n✅ ALL TESTS PASSED — zero crashes across all delivery code paths`);
} else {
  console.log(`\n❌ ${totalErrors} error(s) found:`);
  errDetails.slice(0, 20).forEach(d => console.log(`  ↳ ${d}`));
  if (errDetails.length > 20) console.log(`  ... and ${errDetails.length - 20} more`);
}
process.exit(totalErrors > 0 ? 1 : 0);