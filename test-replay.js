#!/usr/bin/env node
/**
 * Test replay behavior: call animateBall multiple times and log state at start of each call.
 */

const THREE = require('three');
const fs = require('fs');
const path = require('path');

// ========== Copy constants and helpers from index.html ==========
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

// ========== Copy state variables and functions from index.html ==========
let anim = { on:false, phase:0, t:0, dur:1, curves:[] };
let trajAnim = { on:false, t:0, dur:1, curves:[] };

// Mock Three.js objects needed by clearTrajectory and animateBall
let trajA, trajB; // declared globally like original
const ballGroup = {
  add: obj => {},
  remove: obj => {}
};
const ball = {
  visible: true,
  position: new THREE.Vector3(0, 0, 0) // start at origin
};
const bounceMark = { visible: true };
let flight = 1; // dummy, not used in test

function clearTrajectory(){
  [trajA, trajB].forEach(t => {
    if (t){
      ballGroup.remove(t);
      if (t.geometry) t.geometry.dispose();
      if (t.material) t.material.dispose();
    }
  });
  trajA = trajB = null;
  bounceMark.visible = false;
  ball.visible = false;
}

function resetAnimState(){
  anim.on = false; anim.phase = 0; anim.t = 0; anim.curves = []; anim.durs = [];
  trajAnim.on = false; trajAnim.t = 0; trajAnim.dur = 1; trajAnim.curves = []; trajAnim.durs = [];
}

// We'll copy animateBall but add logging at the start
let callCount = 0;
function animateBall(d, showPath = true, animate = true){
  callCount++;
  console.log(`Replay test: call #${callCount}, anim.t=${anim.t}, trajAnim.t=${trajAnim.t}, ball.position=${ball.position.toArray()}`);

  if (!d){ clearTrajectory(); return; }
  resetAnimState();
  clearTrajectory();

  const { delivery, shot, bounce } = buildTrajectory(d);

  // curves for delivery and shadow
  const cDel = new THREE.CatmullRomCurve3(delivery);
  let cShot = null;
  if (shot) cShot = new THREE.CatmullRomCurve3(shot);

  // === trajA (delivery) ===
  const trajA = {
    userData: { curve: cDel, drawProgress: 0, segments: 50 }
  };
  // === trajB (shot) ===
  let trajB = null;
  if (cShot){
    trajB = {
      userData: { curve: cShot, drawProgress: 0, segments: 40 }
    };
  }

  // === Animation state setup ===
  anim.phase = 0; anim.t = 0; anim.on = animate;
  trajAnim.curves = cShot ? [cDel, cShot] : [cDel];
  trajAnim.durs   = cShot ? [flight, 1.35] : [flight];
  trajAnim.on     = animate || true;
  trajAnim.t      = 0;
  trajAnim.dur    = flight;

  // For the test, we don't actually start the animation loop, so we just return the setup.
  // We return the state so we can inspect it if needed.
  return { anim, trajAnim, ball };
}

// ========== Load a delivery from the first match ==========
const MATCHES = ['lords', 'galle', 'mcg', 'hambantota', 'premadasa'];
let testDelivery = null;
for (const matchId of MATCHES) {
  const file = path.join('matches', `match-${matchId}.json`);
  if (!fs.existsSync(file)) continue;
  const def = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!def.overs || !def.overs.length) continue;
  for (const ov of def.overs) {
    if (!ov.balls || !ov.balls.length) continue;
    const b = ov.balls[0]; // first ball of first over
    const [runs, wicket, speed, length, line, dir, text, extraType] = b;
    testDelivery = {
      speed,
      length,
      line,
      dir,
      runs,
      dismissed: !!wicket
    };
    break;
  }
  if (testDelivery) break;
}
if (!testDelivery) {
  console.error('Failed to load a test delivery');
  process.exit(1);
}

console.log('Test delivery:', testDelivery);

// ========== Run the test ==========
console.log('\n--- Starting replay test ---');
for (let i = 0; i < 3; i++) {
  animateBall(testDelivery, true, true); // show trajectory and animate
}
console.log('\n--- Test complete ---');