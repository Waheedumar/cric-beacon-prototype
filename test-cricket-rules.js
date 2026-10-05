const assert = require('assert');

// --- Minimal dependencies extracted from index.html ---
const SHOT_MODEL = {
  cover: { t:'Cover Drive', d:24 }, straight: { t:'Straight Drive', d:30 }
};
function deriveShot(d){
  const base = SHOT_MODEL[d.dir] || { t:'Defensive Block', d:4 };
  let dist;
  if (d.runs === 6) dist = 68 + Math.round(Math.random() * 14);
  else if (d.runs === 4) dist = base.d + 10 + Math.round(Math.random() * 8);
  else if (d.runs >= 1) dist = Math.round(base.d * 0.55 + d.runs * 3);
  else dist = Math.round(base.d * 0.35);
  return { type: base.t, distance: dist, direction: (d.dir || 'unknown').replace(/-/g,' ') };
}
function parseDismissal(wicket){
  if (!wicket) return null;
  if (typeof wicket === 'object') return wicket.type || null;
  const s = String(wicket);
  if (/\brun\s*-?\s*out\b/i.test(s)) return 'runout';
  if (/\bst\.?\s+\S+[\s\S]*\bb\s+\S/i.test(s)) return 'stumped';
  if (/\blbw\b/i.test(s)) return 'lbw';
  if (/\bc\.?\s+\S+[\s\S]*\bb\s+\S/i.test(s)) return 'caught';
  if (/\bb\s+\S/i.test(s)) return 'bowled';
  return null;
}
const EXTRA_LABEL = { wide:'WIDE', noball:'NO BALL' };
const EXTRA_CHIP = { wide:'WD', noball:'NB' };
const DISMISSAL_LABEL = { caught:'CAUGHT', bowled:'BOWLED', lbw:'LBW', runout:'RUN OUT', stumped:'STUMPED' };
const DISMISSAL_CHIP = { caught:'c', bowled:'b', lbw:'lbw', runout:'ro', stumped:'st' };

function buildFeed(def){
  const s = JSON.parse(JSON.stringify(def.start));
  s.toCome = s.toCome.slice();
  const out = [];
  let wicketsInWindow = 0;
  const fmt = (def.format || '').toLowerCase();
  const isLimitedOvers = !fmt.includes('test') && !fmt.includes('first class');
  let prevWasNoBall = false;
  def.overs.forEach(ov => {
    let legalBallsThisOver = 0;
    ov.balls.forEach((b, i) => {
      const [runs, wicket, speed, length, line, dir, text, extraType] = b;
      const strikerIdx = s.batsmen.findIndex(x => x.onStrike);
      const striker = s.batsmen[strikerIdx];
      const bowler = s.bowlers[ov.bowler];
      const shot = deriveShot({ runs, dir });
      const dismissalType = parseDismissal(wicket);
      const freeHit = isLimitedOvers && prevWasNoBall;
      let freeHitRejected = false;
      let dismissed = !!wicket;
      if (freeHit && dismissed && dismissalType && dismissalType !== 'runout'){
        freeHitRejected = true;
        dismissed = false;
      }
      prevWasNoBall = extraType === 'noball';
      const outName = dismissed ? striker.name : null;
      let batRuns = runs, extraRuns = 0;
      const isExtraBall = extraType === 'wide' || extraType === 'noball';
      if (extraType === 'wide' || extraType === 'bye' || extraType === 'legbye') {
        batRuns = 0; extraRuns = runs;
      } else if (extraType === 'noball') {
        batRuns = runs > 0 ? runs - 1 : 0; extraRuns = 1;
      } else { batRuns = runs; extraRuns = 0; }
      const legal = !isExtraBall;
      if (legal) legalBallsThisOver++;
      if (legal) striker.balls++;
      striker.runs += batRuns;
      if (batRuns === 4) striker.fours++;
      if (batRuns === 6) striker.sixes++;
      s.runs += runs;
      s.partnership.runs += runs;
      if (legal) s.partnership.balls++;
      if (extraType === 'wide' || extraType === 'noball') bowler.runs += runs;
      else if (extraType === 'bye' || extraType === 'legbye') bowler.runs += 0;
      else bowler.runs += runs;
      if (i === 0) bowler.overs++;
      if (dismissed){
        s.wickets++; bowler.wickets++; wicketsInWindow++;
        const nextName = s.toCome.shift() || 'Not selected';
        s.batsmen[strikerIdx] = { name:nextName, short:nextName.split(' ').pop().toUpperCase(), runs:0, balls:0, fours:0, sixes:0, onStrike:true, form:5, pressure:8 };
        s.partnership = { runs:0, balls:0 };
        s.batsmen.forEach((x,k)=> x.onStrike = (k === strikerIdx));
      } else if (legal ? runs % 2 === 1 : extraType === 'legbye'){
        s.batsmen.forEach(x => x.onStrike = !x.onStrike);
      }
      s.over = ov.over; s.ball = legalBallsThisOver;
      if (legalBallsThisOver === 6) s.batsmen.forEach(x => x.onStrike = !x.onStrike);
      const baseChip = extraType === 'wide' ? EXTRA_CHIP.wide : extraType === 'noball' ? EXTRA_CHIP.noball : extraType === 'bye' ? `${runs}b` : extraType === 'legbye' ? `${runs}lb` : String(runs);
      const baseResult = extraType === 'wide' ? EXTRA_LABEL.wide : extraType === 'noball' ? EXTRA_LABEL.noball : extraType === 'bye' ? `${runs} BYE${runs>1?'S':''}` : extraType === 'legbye' ? `${runs} LEG BYE${runs>1?'S':''}` : runs === 0 ? 'DOT BALL' : runs === 4 ? 'FOUR' : runs === 6 ? 'SIX' : `${runs} RUN${runs>1?'S':''}`;
      const wicketChip = DISMISSAL_CHIP[dismissalType] || 'W';
      const wicketResult = DISMISSAL_LABEL[dismissalType] || 'WICKET';
      let chip = dismissed ? wicketChip : baseChip;
      let result = dismissed ? wicketResult : baseResult;
      if (freeHitRejected) result = `FREE HIT - ${wicketResult} VOID`;
      else if (freeHit) result = `FREE HIT - ${result}`;
      out.push({ key:`${ov.over}.${i+1}`, over:ov.over, ballNo:legalBallsThisOver, upcoming:!!ov.upcoming, bowlerKey:ov.bowler, bowlerName:s.bowlers[ov.bowler].name, strikerName:striker.name, runs, wicket:wicket || null, outName, speed, length, line, dir, text, shot, extraType: extraType || null, batRuns, extraRuns, dismissalType, dismissed, freeHit, freeHitRejected, result, chip, fieldSet: wicketsInWindow > 0 ? 'attacking' : 'standard', overMomentum: legalBallsThisOver === 6 ? ov.momentum : null, state: JSON.parse(JSON.stringify(s)) });
    });
  });
  return out;
}

function formatInningsScore(runs, wickets, declared) {
  if (runs == null || runs === '') return '-';
  const r = Number(runs);
  const w = wickets != null ? Number(wickets) : undefined;
  if (declared) { if (w != null) return `${r}/${w} dec`; return `${r} dec`; }
  if (w != null && w >= 10) return `${r}`;
  if (w != null) return `${r}/${w}`;
  return `${r}`;
}

// --- helper to build minimal match def ---
function mkDef(overs, format = 'T20I'){
  return {
    format,
    start: {
      runs:0, wickets:0, over:0, ball:0,
      batsmen:[
        { name:'Striker', short:'STR', runs:0, balls:0, fours:0, sixes:0, onStrike:true, form:5, pressure:5 },
        { name:'NonStriker', short:'NON', runs:0, balls:0, fours:0, sixes:0, onStrike:false, form:5, pressure:5 }
      ],
      partnership:{ runs:0, balls:0 },
      bowlers:{ bowler1:{ name:'Bowler One', style:'Right-arm', overs:0, maidens:0, runs:0, wickets:0 } },
      toCome:['Next Batsman']
    },
    overs
  };
}

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); console.log('PASS:', name); passed++; }
  catch(e){ console.log('FAIL:', name, '-', e.message); failed++; }
}

// Test 1: Wide adds 1 run, doesn't count as legal ball
test('wide: 1 extra run, not legal, balls not incremented', () => {
  const def = mkDef([{ over:0, bowler:'bowler1', balls:[
    [1, null, 130, 'full', 'off', null, 'wide ball', 'wide']
  ]}]);
  const feed = buildFeed(def);
  assert.strictEqual(feed[0].batRuns, 0);
  assert.strictEqual(feed[0].extraRuns, 1);
  assert.strictEqual(feed[0].state.runs, 1);
  assert.strictEqual(feed[0].state.batsmen[0].balls, 0);
});

// Test 2: No-ball gives bat runs minus 1 penalty, triggers free hit next ball
test('noball: penalty run extra, bat gets runs-1, next ball is free hit', () => {
  const def = mkDef([{ over:0, bowler:'bowler1', balls:[
    [4, null, 140, 'full', 'off', 'cover', 'no ball four', 'noball'],
    [0, null, 135, 'good', 'off', null, 'dot on free hit', null]
  ]}]);
  const feed = buildFeed(def);
  assert.strictEqual(feed[0].batRuns, 3);
  assert.strictEqual(feed[0].extraRuns, 1);
  assert.strictEqual(feed[1].freeHit, true);
});

// Test 3: Dismissal on a free hit (non-runout) is voided
test('free hit: caught dismissal voided, runout stands', () => {
  const def = mkDef([{ over:0, bowler:'bowler1', balls:[
    [0, null, 140, 'full', 'off', null, 'noball', 'noball'],
    [0, 'c fielder b bowler1', 130, 'good', 'off', null, 'caught but free hit', null]
  ]}]);
  const feed = buildFeed(def);
  assert.strictEqual(feed[1].freeHitRejected, true);
  assert.strictEqual(feed[1].dismissed, false);

  const def2 = mkDef([{ over:0, bowler:'bowler1', balls:[
    [0, null, 140, 'full', 'off', null, 'noball', 'noball'],
    [0, 'run out', 130, 'good', 'off', null, 'runout on free hit', null]
  ]}]);
  const feed2 = buildFeed(def2);
  assert.strictEqual(feed2[1].dismissed, true);
  assert.strictEqual(feed2[1].freeHitRejected, false);
});

// Test 4: Odd runs on legal ball swap strike; odd runs on wide do NOT (documented current behavior)
test('strike rotation: odd runs swap on legal ball, NOT on wide (known gap)', () => {
  const def = mkDef([{ over:0, bowler:'bowler1', balls:[
    [1, null, 130, 'good', 'off', null, 'single', null]
  ]}]);
  const feed = buildFeed(def);
  assert.strictEqual(feed[0].state.batsmen[0].onStrike, false);
  assert.strictEqual(feed[0].state.batsmen[1].onStrike, true);

  const defWide = mkDef([{ over:0, bowler:'bowler1', balls:[
    [1, null, 130, 'good', 'off', null, 'wide plus one run', 'wide']
  ]}]);
  const feedWide = buildFeed(defWide);
  assert.strictEqual(feedWide[0].state.batsmen[0].onStrike, true);
});

// Test 5: Bye/legbye count as legal balls, no bat runs
test('bye/legbye: extras runs, legal ball, no bat runs credited', () => {
  const def = mkDef([{ over:0, bowler:'bowler1', balls:[
    [1, null, 130, 'good', 'off', null, 'bye', 'bye'],
    [1, null, 130, 'good', 'off', null, 'legbye', 'legbye']
  ]}]);
  const feed = buildFeed(def);
  assert.strictEqual(feed[0].batRuns, 0);
  assert.strictEqual(feed[0].extraRuns, 1);
});

// Test 6: Over boundary: strike swaps after 6th legal ball even with extras present (fixes known gap)
test('over boundary: strike swaps after 6th legal ball, not at array position 5', () => {
  // Case 1: 6 legal balls — strike swaps after 6th legal ball (feed[5])
  const balls = [];
  for (let k = 0; k < 6; k++) balls.push([0, null, 130, 'good', 'off', null, 'dot', null]);
  const def = mkDef([{ over:0, bowler:'bowler1', balls }]);
  const feed = buildFeed(def);
  assert.strictEqual(feed[5].state.batsmen[0].onStrike, false, 'after 6th legal ball, striker has swapped');

  // Case 2: wide at position 0 — strike should NOT swap at array index 5 (only 5 legal balls bowled)
  const ballsWide = [];
  ballsWide.push([0, null, 130, 'good', 'off', null, 'wide', 'wide']);
  for (let k = 0; k < 5; k++) ballsWide.push([0, null, 130, 'good', 'off', null, 'dot', null]);
  const defWide = mkDef([{ over:0, bowler:'bowler1', balls: ballsWide }]);
  const feedWide = buildFeed(defWide);
  assert.strictEqual(feedWide[5].state.batsmen[0].onStrike, true, 'at 5th legal ball (6th array entry with wide), striker still on strike');
  assert.strictEqual(feedWide[5].ballNo, 5, 'ballNo should be 5 after 5 legal balls');
});

// Test 7: Multi-innings score formatting
test('formatInningsScore: all out, declared, in-progress', () => {
  assert.strictEqual(formatInningsScore(342, 10, false), '342');
  assert.strictEqual(formatInningsScore(280, 5, true), '280/5 dec');
  assert.strictEqual(formatInningsScore(287, 8, false), '287/8');
});

console.log('');
console.log(`=== ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
