/**
 * validateMatches.js
 * ==================
 * Regression test for Phase 2 schema extension (extraType, legal, batRuns,
 * structured wicket, freeHit) across all 5 mock matches.
 *
 * The buildFeed() function lives in index.html. This script ports the same
 * per-ball logic in pure JS so it can run under Node and exercise the 5
 * JSON fixture files in matches/.
 *
 * Run:   node validateMatches.js
 *
 * Exit:  0 if all 5 matches pass, 1 otherwise.
 */

'use strict';
const fs   = require('fs');
const path = require('path');

/* ===================================================================
   buildFeed() — Node port of index.html:1464-1616
   Returns { deliveries, errors, state }
   =================================================================== */
function buildFeed(def) {
  const errors = [];
  const s = JSON.parse(JSON.stringify(def.start));
  s.toCome = s.toCome.slice();
  const out = [];
  let wicketsInWindow = 0;
  let prevWasNoBall = false;

  // Per-bowler over tracking for maiden detection
  const bowlerState = {};

  if (!def.overs || !Array.isArray(def.overs)) {
    errors.push(`match ${def.id}: def.overs missing or not an array`);
    return { deliveries: [], errors, state: s };
  }

  def.overs.forEach((ov, ovi) => {
    if (!ov.balls || !Array.isArray(ov.balls)) {
      errors.push(`match ${def.id}, over[${ovi}]: balls missing or not an array`);
      return;
    }
    if (!ov.bowler || !s.bowlers[ov.bowler]) {
      errors.push(`match ${def.id}, over ${ov.over}: bowler "${ov.bowler}" not in start.bowlers`);
    }

    ov.balls.forEach((b, i) => {
      try {
        const [runs, wicket, speed, length, line, dir, text, shotDetail] = b;
        const extraType = b[7] || null;
        const strikerIdx = s.batsmen.findIndex(x => x.onStrike);
        if (strikerIdx < 0) {
          errors.push(`match ${def.id}, over ${ov.over} ball ${i+1}: no batsman on strike`);
        }
        const striker = s.batsmen[strikerIdx] || s.batsmen[0];
        const bowler  = s.bowlers[ov.bowler];
        const outName = wicket ? (striker ? striker.name : null) : null;
        const shot    = shotDetail || null;

        // --- Phase 2: extras / legal-ball accounting
        const isExtra = extraType === 'wide' || extraType === 'noball';
        const legal   = !isExtra;
        let batRuns   = runs;
        if (extraType === 'wide' || extraType === 'bye' || extraType === 'legbye') batRuns = 0;
        if (extraType === 'noball' && b.batRuns === undefined) {
          batRuns = runs > 0 ? runs - 1 : 0;
        }
        if (b.batRuns !== undefined) batRuns = b.batRuns;
        const extraRuns = runs - batRuns;

        // --- structured wicket
        let dismissalType = null, caughtBy = null, runoutEnd = null, bowledBy = null;
        let dismissed = !!wicket;
        if (wicket) {
          if (typeof wicket === 'object' && wicket !== null) {
            dismissalType = wicket.type || null;
            caughtBy     = wicket.caughtBy || null;
            runoutEnd    = wicket.runoutEnd || null;
            bowledBy     = wicket.bowledBy || null;
          } else {
            // Legacy free-text parsing
            const m = String(wicket).match(
              /^([A-Z][A-Za-z' .-]+?)\s+(c|st|lbw)(?:\s+(.+?))?\s+b\s+([A-Z][A-Za-z' .-]+)\s+\d+\s*$/
            );
            if (m) {
              dismissalType = m[2] === 'st' ? 'stumped' : m[2] === 'lbw' ? 'lbw' : 'caught';
              caughtBy  = m[3] || null;
              bowledBy  = m[4] || null;
            } else {
              const m2 = String(wicket).match(
                /^([A-Z][A-Za-z' .-]+?)\s+b\s+([A-Z][A-Za-z' .-]+)\s+\d+\s*$/
              );
              if (m2) {
                dismissalType = 'bowled';
                bowledBy = m2[2];
              }
            }
          }
        }

        // --- free-hit rule (format-aware)
        const isLimitedOvers = !def.format.includes('Test') && !def.format.includes('first class');
        const freeHit = isLimitedOvers && prevWasNoBall;
        let freeHitRejected = false;
        if (freeHit && dismissed && dismissalType && dismissalType !== 'runout') {
          freeHitRejected = true;
          dismissed = false;
        }
        prevWasNoBall = extraType === 'noball';

        // --- apply the delivery to the state
        if (legal) striker.balls++;
        striker.runs += batRuns;
        if (batRuns === 4) striker.fours++;
        if (batRuns === 6) striker.sixes++;
        s.runs += runs;
        s.partnership.runs += runs;
        bowler.runs += (extraType === 'noball') ? batRuns : runs;

        // over / maiden tracking (legal balls only)
        const bs = bowlerState[ov.bowler] || (bowlerState[ov.bowler] = { legalBalls: 0, runsThisOver: 0, maidens: 0 });
        if (legal) {
          bs.legalBalls++;
          if (i === 5 && bs.legalBalls === 6 && bs.runsThisOver === 0) {
            bs.maidens++;
            bowler.maidens = (bowler.maidens || 0) + 1;
          }
        }
        bs.runsThisOver += (extraType === 'noball') ? batRuns : runs;
        if (i === 5) { bs.legalBalls = 0; bs.runsThisOver = 0; }
        if (i === 0) bowler.overs++;

        if (dismissed && !freeHitRejected) {
          s.wickets++;
          bowler.wickets++;
          wicketsInWindow++;
          const nextName = s.toCome.shift() || 'Not selected';
          s.batsmen[strikerIdx] = {
            name: nextName, short: nextName.split(' ').pop().toUpperCase(),
            runs: 0, balls: 0, fours: 0, sixes: 0, onStrike: true, form: 5, pressure: 8
          };
          s.partnership = { runs: 0, balls: 0 };
          s.batsmen.forEach((x, k) => x.onStrike = (k === strikerIdx));
        } else if (runs % 2 === 1) {
          s.batsmen.forEach(x => x.onStrike = !x.onStrike);
        }

        s.over = ov.over; s.ball = i + 1;
        if (i === 5) s.batsmen.forEach(x => x.onStrike = !x.onStrike);

        s.batsmen.forEach(x => {
          const sr = x.balls ? (x.runs / x.balls) * 100 : 0;
          x.form     = Math.max(1, Math.min(10, Math.round(sr / 9)));
          x.pressure = Math.max(1, Math.min(10, Math.round(10 - sr / 11)));
        });

        out.push({
          key: `${ov.over}.${i+1}`,
          over: ov.over, ballNo: i+1, upcoming: !!ov.upcoming,
          bowlerKey: ov.bowler, bowlerName: bowler ? bowler.name : null,
          strikerName: striker ? striker.name : null,
          runs, wicket: wicket || null, outName,
          extraType, legal, batRuns, extraRuns,
          dismissalType, caughtBy, runoutEnd, bowledBy,
          freeHit, freeHitRejected,
          speed, length, line, dir, text, shot,
          result: freeHitRejected ? 'FREEHIT_REJECTED'
               : dismissed ? 'WICKET'
               : runs === 0 ? 'DOT BALL'
               : runs === 4 ? 'FOUR'
               : runs === 6 ? 'SIX'
               : `${runs} RUN${runs>1?'S':''}`,
          chip: dismissed && !freeHitRejected ? 'W' : String(runs),
          fieldSet: wicketsInWindow > 0 ? 'attacking' : 'standard',
          overMomentum: i === 5 ? (ov.momentum || null) : null,
          state: JSON.parse(JSON.stringify(s))
        });
      } catch (err) {
        errors.push(`match ${def.id}, over ${ov.over} ball ${i+1}: ${err.message}`);
      }
    });
  });

  return { deliveries: out, errors, state: s };
}

/* ===================================================================
   Per-match validation
   =================================================================== */
function validateMatch(id) {
  const file = path.join('matches', `match-${id}.json`);
  if (!fs.existsSync(file)) {
    return { id, ok: false, errors: [`file not found: ${file}`] };
  }
  let def;
  try {
    def = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { id, ok: false, errors: [`JSON parse failed: ${err.message}`] };
  }

  // --- Pre-flight checks on the schema
  const pre = [];
  if (!def.id)              pre.push('missing def.id');
  if (!def.label)           pre.push('missing def.label');
  if (!def.start)           pre.push('missing def.start');
  if (!def.start.batsmen || !Array.isArray(def.start.batsmen)) pre.push('missing def.start.batsmen[]');
  if (!def.start.bowlers)   pre.push('missing def.start.bowlers');
  if (!def.start.toCome)    pre.push('missing def.start.toCome');
  if (!def.overs || !Array.isArray(def.overs)) pre.push('missing def.overs[]');

  // --- Run buildFeed
  const { deliveries, errors, state } = buildFeed(def);

  // --- Post-flight sanity checks
  const post = [...errors];
  if (deliveries.length === 0) post.push('buildFeed produced 0 deliveries');

  // Check that the final state is internally consistent
  if (state.runs < 0)     post.push(`state.runs is negative: ${state.runs}`);
  if (state.wickets < 0)  post.push(`state.wickets is negative: ${state.wickets}`);
  if (state.wickets > 10) post.push(`state.wickets > 10: ${state.wickets}`);

  // Check that no batsman has a negative balls count
  state.batsmen.forEach((b, i) => {
    if (b.balls < 0) post.push(`batsman[${i}].balls is negative: ${b.balls}`);
    if (b.runs  < 0) post.push(`batsman[${i}].runs is negative: ${b.runs}`);
  });

  // Check that the upcoming over is correctly identified
  const upcoming = deliveries.find(d => d.upcoming);
  const hasUpcoming = def.overs.some(o => o.upcoming);
  if (hasUpcoming && !upcoming) post.push('def has upcoming over but no delivery has upcoming:true');
  if (!hasUpcoming && upcoming) post.push('a delivery has upcoming:true but no def.over has upcoming:true');

  // Count wickets that should match def.start.wickets + deliveries where wicket was set
  const wicketDeliveries = deliveries.filter(d => d.wicket && !d.freeHitRejected).length;
  // Initial wickets + wicket deliveries should equal or be close to final wickets
  // (close because freeHitRejected reduces one)
  const finalWickets = state.wickets;
  const expectedWickets = def.start.wickets + wicketDeliveries;
  if (finalWickets !== expectedWickets) {
    post.push(`wickets mismatch: start(${def.start.wickets}) + wicket-deliveries(${wicketDeliveries}) = ${expectedWickets}, but state.wickets = ${finalWickets}`);
  }

  // 8-element tuple usage stats
  const extBalls = deliveries.filter(d => d.extraType !== null).length;
  const structuredWickets = deliveries.filter(d => typeof d.wicket === 'object' && d.wicket !== null).length;

  const allErrors = [...pre, ...post];
  return {
    id,
    label: def.label,
    ok: allErrors.length === 0,
    errors: allErrors,
    stats: {
      deliveries     : deliveries.length,
      overs          : def.overs.length,
      finalRuns      : state.runs,
      finalWickets   : state.wickets,
      finalBatsmen   : state.batsmen.map(b => `${b.name} ${b.runs}(${b.balls})`),
      extraTypeBalls : extBalls,
      structuredWickets,
      freeHits       : deliveries.filter(d => d.freeHit).length,
      freeHitRejects : deliveries.filter(d => d.freeHitRejected).length,
    }
  };
}

/* ===================================================================
   Run for all 5 matches
   =================================================================== */
const MATCHES = ['lords', 'galle', 'mcg', 'hambantota', 'premadasa'];

console.log('\n========================================');
console.log('  validateMatches.js — Phase 2 Regression');
console.log('========================================\n');

let totalErrors = 0;
const results = [];

for (const id of MATCHES) {
  const r = validateMatch(id);
  results.push(r);
  if (r.ok) {
    console.log(`  ✅  ${r.id.padEnd(12)}  (${r.label})`);
    console.log(`      deliveries: ${r.stats.deliveries}  |  overs: ${r.stats.overs}  |  extras: ${r.stats.extraTypeBalls}  |  structuredWickets: ${r.stats.structuredWickets}`);
    console.log(`      final: ${r.stats.finalRuns}/${r.stats.finalWickets}  |  freeHits: ${r.stats.freeHits}  |  freeHitRejects: ${r.stats.freeHitRejects}`);
    console.log(`      batsmen: ${r.stats.finalBatsmen.join('  •  ')}`);
    console.log();
  } else {
    totalErrors += r.errors.length;
    console.log(`  ❌  ${r.id.padEnd(12)}  (${r.label || 'NO LABEL'})`);
    r.errors.forEach(e => console.log(`      ↳ ${e}`));
    if (r.stats) {
      console.log(`      partial stats: ${r.stats.deliveries} deliveries, final ${r.stats.finalRuns}/${r.stats.finalWickets}`);
    }
    console.log();
  }
}

console.log('----------------------------------------');
console.log(`  Results: ${results.filter(r => r.ok).length}/${results.length} matches passed`);
if (totalErrors > 0) console.log(`  Total errors: ${totalErrors}`);
console.log('========================================\n');

if (totalErrors > 0) process.exit(1);
