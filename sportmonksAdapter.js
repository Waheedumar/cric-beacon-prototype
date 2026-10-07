/**
 * sportmonksAdapter.js
 * ====================
 * Phase 2 Provider Adapter: Sportmonks World Plan API → Cric Beacon MatchDocument.
 *
 * API base: https://cricket.sportmonks.com/api/v2.0/
 * Auth:     ?api_token=<SPORTMONKS_API_TOKEN>
 * Docs:     https://docs.sportmonks.com/cricket/
 *
 * The adapter is the ONLY file that knows Sportmonks field names.
 * All other code (engine, panels, buildFeed) reads the normalised
 * Cric Beacon schema documented in SCHEMA.md.
 *
 * Sportmonks fields used (confirmed via live API calls):
 *   score.bye              → leg-bye runs
 *   score.leg_bye          → leg-byes (same, both present in their payload)
 *   score.noball           → no-ball flag (boolean/int)
 *   score.noball_runs      → runs penalty from no-ball
 *   batsman_one_on_creeze_id / batsman_two_on_creeze_id  → striker / non-striker
 *   batsmanout_id           → dismissed batsman PID
 *   catchstump_id           → fielder who took catch / did stumping
 *   score.name              → structured dismissal label ("Catch Out", "LBW OUT", …)
 *
 * ----------------------------------------------------------------
 * Usage (from index.html console or a future fetch wrapper):
 *
 *   const adapter = new SportMonksAdapter({ token: 'YOUR_TOKEN' });
 *   const match  = await adapter.getMatch('<sportmonks-match-id>');
 *   const feed   = buildFeed(match);   // reuse existing engine function
 *
 * ----------------------------------------------------------------
 * Test harness is at the bottom of this file — run with:
 *   node sportmonksAdapter.js
 * =================================================================== */

'use strict';

/* ===================================================================
   CONSTANTS — mirrors index.html lookup tables so the adapter stays
   in sync with the 3D engine without importing anything.
   =================================================================== */

// Maps Sportmonks score.name values → Cric Beacon wicket.type
const SPORTMONKS_DISMISSAL_MAP = {
  'Catch Out':        'caught',
  'CATCH OUT':        'caught',
  'Caught Out':       'caught',
  'CAUGHT OUT':       'caught',
  'BOWLED OUT':       'bowled',
  'Clean Bowled':     'bowled',
  'CLEAN BOWLED':     'bowled',
  'LBW OUT':          'lbw',
  'Stumping Out':     'stumped',
  'STUMPING OUT':     'stumped',
  'Run Out':          'runout',
  'RUN OUT':          'runout',
  'Hit Wicket Out':   'hitwicket',
  'HIT WICKET OUT':   'hitwicket',
  // Fallback: lowercase the suffix and match the pattern
};

// Maps Sportmonks score.name → structured wicket object.
// Takes the full smBall because Sportmonks puts the dismissal
// attribution in sibling fields (batsmanout_id, catchstump_id,
// bowler_id) and the label inside smBall.score.name.
function parseSportMonksWicket(smBall, playersMap) {
  const score = smBall.score;
  if (!score || !score.name) return null;
  if (score.is_wicket !== true && score.out !== true && !smBall.batsmanout_id) return null;

  const raw = score.name.trim();
  const dismissedId = smBall.batsmanout_id || null;
  const catcherId   = smBall.catchstump_id || null;
  const bowlerId    = smBall.bowler_id     || null;

  const dismissedName = dismissedId  ? (playersMap[dismissedId]  || null) : null;
  const catcherName   = catcherId    ? (playersMap[catcherId]   || null) : null;
  const bowlerName    = bowlerId     ? (playersMap[bowlerId]   || null) : null;

  const type = SPORTMONKS_DISMISSAL_MAP[raw]
    || parseFallbackDismissalType(raw);

  return {
    dismissed : true,
    type,
    caughtBy  : type === 'caught'  ? catcherName   : null,
    runoutEnd : type === 'runout' ? catcherName   : null,  // run-out end man
    bowledBy  : (type === 'bowled' || type === 'lbw' || type === 'caught' || type === 'stumped' || type === 'hitwicket') ? bowlerName : null,
  };
}

function parseFallbackDismissalType(name) {
  const n = name.toLowerCase();
  if (n.includes('catch') || n.includes('caugh')) return 'caught';
  if (n.includes('lbw'))                           return 'lbw';
  if (n.includes('bowled') || n.includes('bower')) return 'bowled';
  if (n.includes('stump'))                         return 'stumped';
  if (n.includes('run out'))                       return 'runout';
  if (n.includes('hit wicket'))                    return 'hitwicket';
  return 'caught';  // safe fallback — buildFeed will handle it
}

/**
 * Format a SportMonks wicket object into a human-readable string
 * for display in toast notifications, HUD, etc.
 * E.g. "Root c Atkinson" or "bowled b Leach" or "lbw b Wood"
 */
function formatWicketDisplay(wicket) {
  if (!wicket || !wicket.dismissed) return '';

  const type = wicket.type || '';
  const caughtBy = wicket.caughtBy || '';
  const bowledBy = wicket.bowledBy || '';

  if (type === 'caught' && caughtBy) {
    return `${caughtBy}`;
  }
  if (type === 'caught') {
    return 'caught';
  }
  if (type === 'bowled' && bowledBy) {
    return `bowled b ${bowledBy}`;
  }
  if (type === 'lbw' && bowledBy) {
    return `lbw b ${bowledBy}`;
  }
  if (type === 'runout' && caughtBy) {
    return `run out ${caughtBy}`;
  }
  if (type === 'stumped') {
    return 'stumped';
  }
  if (type === 'hitwicket') {
    return 'hit wicket';
  }
  // Fallback: just the type name
  return type;
}

/* ===================================================================
   NORMALIZER — single ball
   Maps one Sportmonks ball object → Cric Beacon 8-element tuple
   + extended per-ball fields.

   Sportmonks ball object shape (simplified):
   {
     id, over_id, ball_number, batsman_id, bowler_id,
     runs, bye, leg_bye, noball, noball_runs, wide, wide_runs,
     batsman_one_on_creeze_id, batsman_two_on_creeze_id,
     batsmanout_id, catchstump_id,
     score: { id, name, ... },
     batsman_score: { ... },  // per-batsman breakdown
     remaining_balls, total_legal_balls, total_runs, ...    // extra context
   }
   =================================================================== */

function _smBallFields(smBall) {
  // Current Sportmonks API nests runs/extras inside smBall.score and sends ball: 0.1 (over.ball).
  // Older shapes had them top-level; both are supported.
  const sc = (smBall && typeof smBall.score === 'object' && smBall.score) || {};
  const has = (k) => smBall[k] !== undefined && smBall[k] !== null;
  const scName = String(sc.name || '');
  const isWide = has('wide') ? smBall.wide : (/wide/i.test(scName) ? 1 : 0);
  const bye = has('bye') ? smBall.bye : (Number(sc.bye) || 0);
  const legBye = has('leg_bye') ? smBall.leg_bye : (Number(sc.leg_bye) || 0);
  const nb = has('noball') ? smBall.noball : (Number(sc.noball) || 0);
  const nbRuns = has('noball_runs') ? smBall.noball_runs : (Number(sc.noball_runs) || 0);
  let runs;
  if (has('runs')) runs = smBall.runs;
  else { runs = (Number(sc.runs) || 0) + bye + legBye + nbRuns; if (isWide && runs === 0) runs = 1; }
  let ballNo = smBall.ball_number;
  if (ballNo === undefined && smBall.ball !== undefined && smBall.ball !== null) ballNo = Math.round((Number(smBall.ball) * 10) % 10) || 1;
  return { runs, bye, leg_bye: legBye, noball: nb, noball_runs: nbRuns, wide: isWide, wide_runs: has('wide_runs') ? smBall.wide_runs : 0, batsman_score: smBall.batsman_score, ball_number: ballNo };
}

function normalizeSportMonksBall(smBall, ctx) {
  /**
   * ctx provides:
   *   playersMap  { pid → fullName }   — for human-readable labels
   *   bowlerMap   { pid → bowlerObj }  — for economy / over tracking
   *   currentOver — 1-indexed over number
   *   strikerId   — current striker PID
   */

  const {
    runs = 0,           // total runs off this ball (bat + extras)
    bye = 0,            // bye runs
    leg_bye = 0,        // leg-bye runs
    noball = 0,         // 1 if no-ball
    noball_runs = 0,    // runs awarded from no-ball (usually 1)
    wide = 0,          // 1 if wide
    wide_runs = 0,      // extra runs from wide
    batsman_score = 0,  // runs credited to bat this ball (from batsman_score sub-object)
    ball_number = 1,    // ball within the over (1–6+)
  } = _smBallFields(smBall);

  // --- extraType & legal flag ----------------------------------------
  let extraType  = null;
  let isLegal   = true;

  if (wide == 1 || wide_runs > 0) {
    extraType = 'wide';
    isLegal   = false;
  } else if (nball(noball) === 1) {
    extraType = 'noball';
    isLegal   = false;
  } else if (bye > 0) {
    extraType = 'bye';
    isLegal   = true;
  } else if (leg_bye > 0) {
    extraType = 'legbye';
    isLegal   = true;
  }

  // --- runs breakdown -----------------------------------------------
  // Sportmonks provides `batsman_score` (runs off the bat) in the
  // batsman_score sub-object; fall back to our own subtraction.
  const totalRuns     = Number(runs) || 0;
  let   batRuns       = batsman_score ? Number(batsman_score.runs) : null;
  if (typeof batRuns === 'number' && isNaN(batRuns)) {
    batRuns = null;
  }
  let   extraRuns     = 0;

  if (batRuns === null) {
    if (extraType === 'wide') {
      batRuns    = 0;
      extraRuns  = totalRuns;
    } else if (extraType === 'noball') {
      batRuns    = noball_runs > 0 ? noball_runs - 1 : 0;
      extraRuns  = noball_runs > 0 ? 1 : 0;   // 1 no-ball penalty
    } else if (extraType === 'bye' || extraType === 'legbye') {
      batRuns    = 0;
      extraRuns  = extraType === 'bye' ? bye : leg_bye;
    } else {
      batRuns    = totalRuns;
      extraRuns  = 0;
    }
  } else {
    extraRuns = totalRuns - batRuns;
  }

  // --- structured wicket --------------------------------------------
  const wicket = parseSportMonksWicket(smBall, ctx.playersMap);

  // --- free-hit (ball after a no-ball) ------------------------------
  const freeHit = ctx.prevWasNoBall === true;
  // A wicket on a free-hit is only valid if it's a run-out
  let freeHitRejected = false;
  if (freeHit && wicket && wicket.dismissed && wicket.type && wicket.type !== 'runout') {
    freeHitRejected = true;
  }

  // --- speed, length, line, dir ------------------------------------
  // Sportmonks World plan may include rate_id / ball_type / line /
  // direction fields.  Map them when present; fall back to the
  // inference layer otherwise (seeded by ball.id, reproducible).
  const speed = null;  // Sportmonks does not expose km/h per ball

  let length = smBall.ball_type
    ? _mapBallType(smBall.ball_type)
    : null;
  let line   = smBall.line
    ? _mapLine(smBall.line)
    : null;
  let dir    = smBall.direction
    ? _mapDirection(smBall.direction)
    : null;

  // Fallback: inference layer when any trajectory field is missing
  if (length == null || line == null || dir == null) {
    const inferred = inferDelivery(smBall, ctx);
    if (length == null) length = inferred.length;
    if (line == null)   line   = inferred.line;
    if (dir == null)    dir    = inferred.dir;
  }

  // --- shot text (commentary) ---------------------------------------
  const text    = smBall.commentary
    || _buildCommentary(smBall, { batRuns, extraType, wicket, extraRuns });

  // --- 8-element tuple (backward-compatible with existing buildFeed) --
  // Tuple: [runs, wicket|null, speed, length, line, dir, text]
  // Index 7 = extraType (Phase 2 extension)
  const tuple = [
    totalRuns,
    wicket || null,
    speed,
    length,
    line,
    dir,
    text,
    extraType,           // b[7]
  ];

  // Extended fields attached to the delivery object
  return {
    tuple,
    runs          : totalRuns,
    extraType,
    isLegal,
    batRuns,
    extraRuns,
    wicket,
    freeHit,
    freeHitRejected,
    speed,
    length,
    line,
    dir,
    text,
    // Sportmonks-native fields kept for traceability
    _sm: {
      ballId       : smBall.id,
      batsmanId    : smBall.batsman_id,
      bowlerId     : smBall.bowler_id,
      ballNumber   : ball_number,
      noballRuns   : noball_runs,
      wideRuns     : wide_runs,
      byeRuns      : bye,
      legByeRuns   : leg_bye,
    },
  };
}

/* ---- Sportmonks → internal lookup helpers ---- */

function nball(v) { return v === 1 || v === '1' || v === true ? 1 : 0; }

// ball_type maps: '0' = yorker, '1' = full, '2' = good length, '3' = short, '4' = bouncer
const BALL_TYPE_MAP = {
  '0': 'yorker', '1': 'full', '2': 'good', '3': 'short', '4': 'bouncer',
  yorker: 'yorker', full: 'full', good: 'good', short: 'short', bouncer: 'bouncer',
};

function _mapBallType(bt) {
  if (!bt) return null;
  const mapped = BALL_TYPE_MAP[String(bt).toLowerCase()];
  return mapped || null;
}

// line maps: 'off', 'fourth', 'middle', 'leg', 'body', 'wide'
function _mapLine(line) {
  if (!line) return null;
  const l = String(line).toLowerCase();
  const map = { off:'off', fourth:'fourth', middle:'middle', leg:'leg', body:'body', wide:'wide' };
  return map[l] || null;
}

// direction maps: Sportmonks shot direction → SHOT_DIRS key
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
  return map[d] || null;
}

function _buildCommentary(smBall, { batRuns, extraType, wicket, extraRuns }) {
  const runs = batRuns || 0;
  const ex   = extraRuns > 0 ? ` + ${extraRuns} ${extraType}` : '';
  if (wicket && wicket.dismissed) {
    const t = wicket.type === 'caught' ? 'caught'
             : wicket.type === 'lbw'    ? 'lbw'
             : wicket.type === 'bowled' ? 'bowled'
             : wicket.type === 'runout' ? 'run out'
             : 'dismissed';
    return `WICKET — ${t}!${ex}`;
  }
  if (runs === 0) return `Dot ball.${ex}`;
  if (runs === 4) return `FOUR runs!${ex}`;
  if (runs === 6) return `SIX runs!${ex}`;
  return `${runs} run${runs > 1 ? 's' : ''}.${ex}`;
}

/* ===================================================================
   INFERENCE LAYER — ball_type / line / direction when Sportmonks is silent
   ===================================================================
   Sportmonks World Plan may optionally supply `ball_type`, `line` and
   `direction` per ball. The normalizer above consumes them when present and
   leaves the corresponding field as `null`. This layer fills those gaps with
   a weighted, data-informed heuristic driven by:

     • the delivery outcome (extraType, wicket.type, runs / batRuns)
     • match phase  (powerplay / middle / death, from over number)
     • bowler/batsman style (spinners → more 'good', fast → more 'short'/'yorker')
     • batsman handedness (off ↔ leg flip for left-handers, line only)
     • a deterministic xorshift random seeded by smBall.id

   Because everything is seeded by the ball id, the same ball always yields the
   same length / line / dir — the replay is 100% reproducible.
   =================================================================== */

// --- seeded PRNG (deterministic per ball id) ----------------------------
// xorshift32, 0..1
function _inferenceRandom(id) {
  let x = (Number(id) || 1) >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return (x >>> 0) / 4294967296;
}

// Weighted pick: pairs = [{value, weight}, ...], r in [0,1).
function _pickWeighted(pairs, r) {
  const total = pairs.reduce((sum, p) => sum + p.weight, 0);
  let acc = 0;
  for (const { value, weight } of pairs) {
    acc += weight;
    if (r < acc / total) return value;
  }
  return pairs[pairs.length - 1].value;
}

// Match phase from over number (same buckets buildFeed / legacy code use).
function _phaseOf(overId) {
  const ov = Number(overId);
  if (ov <= 6) return 'powerplay';
  if (ov >= 16) return 'death';
  return 'middle';
}

// Does a bowling-style string denote a spinner?
function _isSpinner(style) {
  return /break|spin|orthodox|slow|googly|chinaman/i.test(style || '');
}

// Does a bowling-style string denote a fast bowler?
function _isFast(style) {
  return /fast/i.test(style || '');
}

// Batsman handedness from batsmanstyle string.
function _isLeftHander(style) {
  return /left/i.test(style || '');
}

// Extra type: replicate the exact logic from normalizeSportMonksBall so the
// inference layer is self-contained (it's also used by normalizeSportMonksLive).
function _inferenceExtraType(smBall) {
  const sc = (smBall && typeof smBall.score === 'object' && smBall.score) || {};
  const has = (k) => smBall[k] !== undefined && smBall[k] !== null;
  const isWide = has('wide') ? smBall.wide : (/wide/i.test(String(sc.name)) ? 1 : 0);
  const bye = has('bye') ? smBall.bye : (Number(sc.bye) || 0);
  const legBye = has('leg_bye') ? smBall.leg_bye : (Number(sc.leg_bye) || 0);
  const nb = has('noball') ? smBall.noball : (Number(sc.noball) || 0);
  const nbRuns = has('noball_runs') ? smBall.noball_runs : (Number(sc.noball_runs) || 0);
  let wideRuns = has('wide_runs') ? smBall.wide_runs : 0;
  if (smBall.wide === undefined && sc.wide_runs !== undefined) wideRuns = sc.wide_runs;
  if (isWide || wideRuns > 0) return 'wide';
  if (nb === 1 || nb === '1' || nb === true) return 'noball';
  if (bye > 0) return 'bye';
  if (legBye > 0) return 'legbye';
  return null;
}

// --- PROBABILITY TABLES (from docs/inference-heuristic-proposal.md) ----
// LENGTH distributions keyed by condition. Each entry is a list of
// {value, weight} pairs. The inference function picks one using the seeded RNG.

const _LEN_TABLE = {
  // Extras
  wide: [
    { value: 'full',  weight: 92 },
    { value: 'yorker', weight: 8 },
  ],
  noball: [
    { value: 'full',  weight: 85 },
    { value: 'yorker', weight: 10 },
    { value: 'good',  weight: 5 },
  ],
  // Wickets
  bowled: (phase) => ({
    powerplay: [
      { value: 'full',  weight: 60 },
      { value: 'good',  weight: 35 },
      { value: 'yorker', weight: 5 },
    ],
    middle: [
      { value: 'full',  weight: 50 },
      { value: 'good',  weight: 30 },
      { value: 'yorker', weight: 20 },
    ],
    death: [
      { value: 'yorker', weight: 55 },
      { value: 'full',  weight: 35 },
      { value: 'good',  weight: 10 },
    ],
  })[phase],
  lbw: (phase) => ({
    powerplay: [
      { value: 'full',  weight: 55 },
      { value: 'good',  weight: 40 },
      { value: 'yorker', weight: 5 },
    ],
    middle: [
      { value: 'full',  weight: 45 },
      { value: 'good',  weight: 35 },
      { value: 'yorker', weight: 20 },
    ],
    death: [
      { value: 'yorker', weight: 30 },
      { value: 'full',  weight: 55 },
      { value: 'good',  weight: 15 },
    ],
  })[phase],
  stumped: [
    { value: 'full',  weight: 65 },
    { value: 'good',  weight: 30 },
    { value: 'yorker', weight: 5 },
  ],
  caughtKSSlip: [
    { value: 'good',  weight: 55 },
    { value: 'full',  weight: 30 },
    { value: 'short', weight: 15 },
  ],
  caughtOffSide: [
    { value: 'good',  weight: 50 },
    { value: 'full',  weight: 25 },
    { value: 'short', weight: 25 },
  ],
  caughtOnSide: [
    { value: 'short', weight: 45 },
    { value: 'good',  weight: 45 },
    { value: 'full',  weight: 10 },
  ],
  runout: [
    { value: 'good',  weight: 45 },
    { value: 'full',  weight: 35 },
    { value: 'short', weight: 20 },
  ],
  hitwicket: [
    { value: 'good',  weight: 55 },
    { value: 'full',  weight: 30 },
    { value: 'short', weight: 15 },
  ],
  // Boundary outcomes
  six: [
    { value: 'full',  weight: 30 },
    { value: 'short', weight: 45 },
    { value: 'good',  weight: 25 },
  ],
  four: [
    { value: 'full',  weight: 35 },
    { value: 'good',  weight: 45 },
    { value: 'short', weight: 20 },
  ],
  // Non-scorable / off-bat extras
  bye: [
    { value: 'full',  weight: 40 },
    { value: 'good',  weight: 40 },
    { value: 'short', weight: 20 },
  ],
  legbye: [
    { value: 'full',  weight: 40 },
    { value: 'good',  weight: 40 },
    { value: 'short', weight: 20 },
  ],
  // Non-boundary runs
  dot: (phase) => ({
    powerplay: [
      { value: 'good',  weight: 45 },
      { value: 'full',  weight: 35 },
      { value: 'short', weight: 20 },
    ],
    middle: [
      { value: 'good',  weight: 55 },
      { value: 'full',  weight: 30 },
      { value: 'short', weight: 15 },
    ],
    death: [
      { value: 'good',  weight: 50 },
      { value: 'short', weight: 40 },
      { value: 'yorker', weight: 10 },
    ],
  })[phase],
  single: [
    { value: 'full',  weight: 45 },
    { value: 'good',  weight: 45 },
    { value: 'short', weight: 10 },
  ],
  twoThree: [
    { value: 'full',  weight: 45 },
    { value: 'good',  weight: 45 },
    { value: 'short', weight: 10 },
  ],
};

// LINE distributions keyed by condition.
const _LINE_TABLE = {
  wide: [
    { value: 'wide', weight: 100 },
  ],
  bowled: [
    { value: 'middle', weight: 50 },
    { value: 'off',    weight: 25 },
    { value: 'leg',    weight: 20 },
    { value: 'fourth', weight: 5 },
  ],
  lbw: [
    { value: 'middle', weight: 55 },
    { value: 'off',    weight: 20 },
    { value: 'leg',    weight: 20 },
    { value: 'fourth', weight: 5 },
  ],
  stumped: [
    { value: 'middle', weight: 45 },
    { value: 'off',    weight: 30 },
    { value: 'leg',    weight: 20 },
    { value: 'fourth', weight: 5 },
  ],
  caughtKSSlip: [
    { value: 'off',    weight: 40 },
    { value: 'fourth', weight: 40 },
    { value: 'middle', weight: 15 },
    { value: 'leg',    weight: 5 },
  ],
  caughtOffSide: [
    { value: 'off',    weight: 50 },
    { value: 'fourth', weight: 25 },
    { value: 'middle', weight: 20 },
    { value: 'leg',    weight: 5 },
  ],
  caughtOnSide: [
    { value: 'leg',    weight: 45 },
    { value: 'middle', weight: 35 },
    { value: 'off',    weight: 15 },
    { value: 'fourth', weight: 5 },
  ],
  runout: [
    { value: 'middle', weight: 40 },
    { value: 'off',    weight: 35 },
    { value: 'leg',    weight: 25 },
  ],
  hitwicket: [
    { value: 'middle', weight: 50 },
    { value: 'off',    weight: 25 },
    { value: 'leg',    weight: 20 },
    { value: 'fourth', weight: 5 },
  ],
  noball: [
    { value: 'middle', weight: 40 },
    { value: 'off',    weight: 35 },
    { value: 'leg',    weight: 25 },
  ],
  six: [
    { value: 'middle', weight: 35 },
    { value: 'off',    weight: 35 },
    { value: 'leg',    weight: 30 },
  ],
  four: [
    { value: 'middle', weight: 40 },
    { value: 'off',    weight: 30 },
    { value: 'leg',    weight: 30 },
  ],
  bye: [
    { value: 'middle', weight: 35 },
    { value: 'off',    weight: 35 },
    { value: 'leg',    weight: 30 },
  ],
  legbye: [
    { value: 'middle', weight: 35 },
    { value: 'off',    weight: 35 },
    { value: 'leg',    weight: 30 },
  ],
  single: [
    { value: 'middle', weight: 40 },
    { value: 'off',    weight: 40 },
    { value: 'leg',    weight: 20 },
  ],
  twoThree: [
    { value: 'middle', weight: 45 },
    { value: 'off',    weight: 40 },
    { value: 'leg',    weight: 15 },
  ],
  dot: [
    { value: 'middle', weight: 40 },
    { value: 'off',    weight: 35 },
    { value: 'leg',    weight: 25 },
  ],
};

// DIR distributions. null means no shot direction (missed bat / wicket).
const _DIR_TABLE = {
  bowled: null,
  lbw: null,
  stumped: null,
  hitwicket: null,
  keeper: [
    { value: 'keeper', weight: 45 },
    { value: 'slip',   weight: 35 },
  ],
  catcherNearWicket: [
    { value: 'keeper', weight: 45 },
    { value: 'slip',   weight: 35 },
    { value: 'off',    weight: 20 },
  ],
  offSide: [
    { value: 'cover', weight: 30 },
    { value: 'point', weight: 25 },
    { value: 'mid-off', weight: 20 },
    { value: 'third-man', weight: 15 },
    { value: 'slip', weight: 10 },
  ],
  onSide: [
    { value: 'midwicket', weight: 35 },
    { value: 'square-leg', weight: 30 },
    { value: 'fine-leg', weight: 20 },
    { value: 'mid-on', weight: 15 },
  ],
  runout: 'uniform',
  six: [
    { value: 'long-on', weight: 25 },
    { value: 'midwicket', weight: 25 },
    { value: 'long-off', weight: 20 },
    { value: 'straight', weight: 15 },
    { value: 'fine-leg', weight: 15 },
  ],
  four: [
    { value: 'cover', weight: 25 },
    { value: 'midwicket', weight: 20 },
    { value: 'point', weight: 15 },
    { value: 'square-leg', weight: 12.5 },
    { value: 'third-man', weight: 12.5 },
    { value: 'long-off', weight: 10 },
    { value: 'long-on', weight: 5 },
  ],
  bye: null,
  legbye: null,
  single: [
    { value: 'mid-off', weight: 30 },
    { value: 'mid-on', weight: 30 },
    { value: 'straight', weight: 20 },
    { value: 'cover', weight: 10 },
    { value: 'square-leg', weight: 10 },
  ],
  twoThree: [
    { value: 'mid-off', weight: 20 },
    { value: 'mid-on', weight: 20 },
    { value: 'cover', weight: 20 },
    { value: 'midwicket', weight: 15 },
    { value: 'square-leg', weight: 10 },
    { value: 'third-man', weight: 10 },
    { value: 'long-off', weight: 5 },
  ],
  dot: 'halfNull',  // 60% null, 40% uniform random
  uniform: 'uniform',
};

// Valid shot-direction keys, mirrored from index.html SHOT_DIRS (without null).
const _SHOT_DIRS_KEYS = [
  'cover', 'point', 'third-man', 'mid-off', 'long-off', 'straight',
  'long-on', 'mid-on', 'midwicket', 'square-leg', 'fine-leg',
  'keeper', 'slip',
];

// --- BOWLER STYLE MODIFIERS (apply AFTER the base table pick) ----------
// Spinners bowl straighter/shorter-of-a-length: shift mass toward 'good',
// away from 'full'/'short'; also nudge yorkers toward full.
function _applySpinnerLengthModifier(length, r) {
  switch (length) {
    case 'full':
      return r < 0.10 ? 'good' : 'full';  // 10% full → good
    case 'short':
      return r < 0.05 ? 'good' : 'short';  // 5% short → good
    case 'yorker':
      return r < 0.05 ? 'full' : 'yorker';  // 5% yorker → full
    default:
      return length;
  }
}

// Fast bowlers: more expressiveness — push 'short'/'yorker' into play,
// and on yorkers keep some chance of a fuller length.
function _applyFastLengthModifier(length, r) {
  switch (length) {
    case 'full':
      return r < 0.05 ? 'short' : 'full';  // 5% full → short
    case 'good':
      return r < 0.05 ? 'short' : 'good';  // 5% good → short
    case 'short':
      return r < 0.05 ? 'yorker' : 'short';  // 5% short → yorker
    case 'bouncer':
      return r < 0.05 ? 'short' : 'bouncer';  // 5% bouncer → short
    default:
      return length;
  }
}

// LINE flip for a left-handed batter: off-side and leg-side are swapped
// from the bowler's (world) coordinate frame, so the bounce lands on the
// correct side of the stumps for the handedness shown.
function _flipLineForLeftHander(line) {
  switch (line) {
    case 'off':  return 'leg';
    case 'leg':  return 'off';
    case 'fourth': return 'body';
    case 'body': return 'fourth';
    default:     return line;
  }
}

// Main entry point: infer { length, line, dir } from a raw Sportmonks ball.
// Returns an object where every missing field is null — the normalizer
// merges inferred values only for the fields that were absent.
function inferDelivery(smBall, ctx = {}) {
  const { playersMap } = ctx;
  const overId = smBall.over_id || smBall.over || 1;
  const phase = _phaseOf(overId);

  const rL  = _inferenceRandom(smBall.id || overId);           // length
  const rLN = (smBall.id || overId) % 4294967296 === 0
    ? _inferenceRandom(smBall.id || overId + 0.5)
    : _inferenceRandom(smBall.id ? String(smBall.id) + '_line' : String(overId) + '_line');
  const rD  = _inferenceRandom(smBall.id ? String(smBall.id) + '_dir' : String(overId) + '_dir');

  const totalRuns = Number(smBall.runs) || 0;
  let batRuns     = smBall.batsman_score
    ? Number(smBall.batsman_score.runs)
    : null;
  if (typeof batRuns === 'number' && isNaN(batRuns)) {
    batRuns = null;
  }
  if (batRuns === null) {
    // Fall back to subtraction when the sub-object is missing.
    const sc = (smBall && typeof smBall.score === 'object' && smBall.score) || {};
    const runsField = smBall.runs;
    const base = runsField !== undefined && runsField !== null ? Number(runsField) : (Number(sc.runs) || 0);
    const bye = smBall.bye !== undefined ? smBall.bye : (Number(sc.bye) || 0);
    const legBye = smBall.leg_bye !== undefined ? smBall.leg_bye : (Number(sc.leg_bye) || 0);
    const nbRuns = smBall.noball_runs !== undefined ? smBall.noball_runs : (Number(sc.noball_runs) || 0);
    const isWide = smBall.wide || (/wide/i.test(String(sc.name)) ? 1 : 0);
    batRuns = (isWide || bye > 0 || legBye > 0 || nbRuns > 0) ? 0 : base;
  }
  const extraType = _inferenceExtraType(smBall);
  const wicket = parseSportMonksWicket(smBall, playersMap);

  const bowlerStyle = (smBall.bowler || {}).bowlingstyle || '';
  const batsmanStyle = (smBall.batsman || {}).batsmanstyle || '';
  const isSpinner = _isSpinner(bowlerStyle);
  const isFast    = _isFast(bowlerStyle);
  const isLeftH   = _isLeftHander(batsmanStyle);

  // ---- LENGTH ---------------------------------------------------------
  let lenBase;
  if (extraType === 'wide')      lenBase = _LEN_TABLE.wide;
  else if (extraType === 'noball') lenBase = _LEN_TABLE.noball;
  else if (wicket) {
    if (wicket.type === 'bowled')        lenBase = _LEN_TABLE.bowled(phase);
    else if (wicket.type === 'lbw')      lenBase = _LEN_TABLE.lbw(phase);
    else if (wicket.type === 'stumped')  lenBase = _LEN_TABLE.stumped;
    else if (wicket.type === 'caught') {
      if (wicket.caughtBy) {
        const cb = wicket.caughtBy.toLowerCase();
        if (cb === 'keeper' || cb === 'wk') lenBase = _LEN_TABLE.keeper;
        else if (cb.toLowerCase() === 'slip' || cb.toLowerCase() === 'sl') lenBase = _LEN_TABLE.caughtKSSlip;
        else lenBase = _LEN_TABLE.caughtOffSide;  // slips are off-side; any other named fielder off-side
      } else {
        lenBase = _LEN_TABLE.caughtOffSide;
      }
    }
    else if (wicket.type === 'runout') lenBase = _LEN_TABLE.runout;
    else if (wicket.type === 'hitwicket') lenBase = _LEN_TABLE.hitwicket;
    else lenBase = _LEN_TABLE.caughtOffSide;
  }
  else if (totalRuns === 6)            lenBase = _LEN_TABLE.six;
  else if (totalRuns === 4)            lenBase = _LEN_TABLE.four;
  else if (extraType === 'bye')        lenBase = _LEN_TABLE.bye;
  else if (extraType === 'legbye')     lenBase = _LEN_TABLE.legbye;
  else if (totalRuns === 0)            lenBase = _LEN_TABLE.dot(phase);
  else if (totalRuns === 1)            lenBase = _LEN_TABLE.single;
  else if (totalRuns >= 2 && totalRuns <= 3) lenBase = _LEN_TABLE.twoThree;
  else lenBase = _LEN_TABLE.dot(phase);

  let length = _pickWeighted(lenBase, rL);

  if (isSpinner) length = _applySpinnerLengthModifier(length, rL);
  if (isFast)    length = _applyFastLengthModifier(length, rL);

  // ---- LINE -----------------------------------------------------------
  let lnBase;
  if (extraType === 'wide')        lnBase = _LINE_TABLE.wide;
  else if (wicket) {
    if (wicket.type === 'bowled')        lnBase = _LINE_TABLE.bowled;
    else if (wicket.type === 'lbw')      lnBase = _LINE_TABLE.lbw;
    else if (wicket.type === 'stumped')  lnBase = _LINE_TABLE.stumped;
    else if (wicket.type === 'caught') {
      if (wicket.caughtBy) {
        const cb = wicket.caughtBy.toLowerCase();
        if (cb === 'keeper' || cb === 'wk') lnBase = _LINE_TABLE.caughtKSSlip;
        else if (cb.toLowerCase() === 'slip' || cb.toLowerCase() === 'sl') lnBase = _LINE_TABLE.caughtKSSlip;
        else lnBase = _LINE_TABLE.caughtOffSide;
      } else {
        lnBase = _LINE_TABLE.caughtOffSide;
      }
    }
    else if (wicket.type === 'runout') lnBase = _LINE_TABLE.runout;
    else if (wicket.type === 'hitwicket') lnBase = _LINE_TABLE.hitwicket;
    else lnBase = _LINE_TABLE.bowled;
  }
  else if (totalRuns === 6)        lnBase = _LINE_TABLE.six;
  else if (totalRuns === 4)        lnBase = _LINE_TABLE.four;
  else if (extraType === 'noball') lnBase = _LINE_TABLE.noball;
  else if (extraType === 'bye')    lnBase = _LINE_TABLE.bye;
  else if (extraType === 'legbye') lnBase = _LINE_TABLE.legbye;
  else if (totalRuns === 1)        lnBase = _LINE_TABLE.single;
  else if (totalRuns >= 2 && totalRuns <= 3) lnBase = _LINE_TABLE.twoThree;
  else lnBase = _LINE_TABLE.dot;

  let line = _pickWeighted(lnBase, rLN);
  if (isLeftH) line = _flipLineForLeftHander(line);

  // ---- DIR ------------------------------------------------------------
  let dirBase;
  if (wicket) {
    if (wicket.type === 'bowled' || wicket.type === 'lbw' ||
        wicket.type === 'stumped' || wicket.type === 'hitwicket') dirBase = null;
    else if (wicket.type === 'caught') {
      if (wicket.caughtBy) {
        const cb = wicket.caughtBy.toLowerCase();
        if (cb === 'keeper' || cb === 'wk') dirBase = _DIR_TABLE.keeper;
        else if (cb.toLowerCase() === 'slip' || cb.toLowerCase() === 'sl') dirBase = _DIR_TABLE.catcherNearWicket;
        else dirBase = _DIR_TABLE.offSide;
      } else {
        dirBase = _DIR_TABLE.offSide;
      }
    }
    else if (wicket.type === 'runout') dirBase = _DIR_TABLE.runout;
    else dirBase = _DIR_TABLE.bowled;
  }
  else if (totalRuns >= 4 && batRuns === 0) {
    // Boundary via extras (byes/leg-byes): ball still traveled to the
    // rope, so draw a shot trajectory.  Pick the six or four table
    // based on totalRuns so the curve reflects the distance.
    dirBase = (totalRuns === 6) ? _DIR_TABLE.six : _DIR_TABLE.four;
  }
  else if (wicket && wicket.type === 'caught' && !wicket.caughtBy) {
    dirBase = _DIR_TABLE.offSide;
  }
  else if (totalRuns === 6)            dirBase = _DIR_TABLE.six;
  else if (totalRuns === 4)            dirBase = _DIR_TABLE.four;
  else if (extraType === 'bye' || extraType === 'legbye') dirBase = null;
  else if (totalRuns === 1)            dirBase = _DIR_TABLE.single;
  else if (totalRuns >= 2 && totalRuns <= 3) dirBase = _DIR_TABLE.twoThree;
  else if (totalRuns === 0)            dirBase = _DIR_TABLE.dot;
  else dirBase = _DIR_TABLE.dot;

  let dir;
  if (dirBase === null) {
    dir = null;
  } else if (dirBase === 'uniform' || dirBase === _DIR_TABLE.runout) {
    dir = _SHOT_DIRS_KEYS[Math.floor(rD * _SHOT_DIRS_KEYS.length) % _SHOT_DIRS_KEYS.length];
  } else if (dirBase === 'halfNull') {
    dir = rD < 0.6 ? null : _SHOT_DIRS_KEYS[Math.floor(rD * _SHOT_DIRS_KEYS.length) % _SHOT_DIRS_KEYS.length];
  } else {
    dir = _pickWeighted(dirBase, rD);
  }

  return { length, line, dir, inferred: true };
}

/* ===================================================================
   MATCH NORMALIZER
   Maps the full Sportmonks livescores response → Cric Beacon MatchDocument.

   Sportmonks livescores shape (simplified):
   {
     id, name, match_name, localteam: { id, name, ... }, visitorteam: { id, name, ... },
     runs: [ { ...innings data... } ],
     live_scoreboard: {
       bowls: [ ... ball objects ... ]
     },
     players: [ { id, fullname, ... }, ... ]
   }

   =================================================================== */

function normalizeSportMonksMatch(smResponse, providedPlayersMap = {}) {
  const {
    id,
    name: matchName,         // e.g. "Pakistan vs England"
    localteam,
    visitorteam,
    starts_at,              // ISO timestamp
    season,
    stage,
    league,
  } = smResponse;

  // Build player lookup: merge provided resolved names with placeholders from batting/balls
  const playersMap = { ...providedPlayersMap };
  // Fill any missing IDs with deterministic placeholders
  const addPlaceholder = (id) => {
    if (id && !playersMap[String(id)]) {
      playersMap[String(id)] = `Player ${id}`;
    }
  };
  (smResponse.batting || []).forEach(battingEntry => {
    addPlaceholder(battingEntry.player_id);
    addPlaceholder(battingEntry.bowling_player_id);
    addPlaceholder(battingEntry.catch_stump_player_id);
    addPlaceholder(battingEntry.runout_by_id);
  });
  (smResponse.balls || []).forEach(ball => {
    addPlaceholder(ball.batsman_id);
    addPlaceholder(ball.batsman_one_on_creeze_id);
    addPlaceholder(ball.bowler_id);
    addPlaceholder(ball.batsmanout_id);
    addPlaceholder(ball.catchstump_id);
  });

  // ---- Teams --------------------------------------------------------
  // Teams are in localteam and visitorteam objects (no players array in this response)
  const home = localteam;
  const away = visitorteam;

  const teams = {
    home: {
      key   : String(home.id),
      name  : (home.name || home.code || 'UNKNOWN').toUpperCase(),
      short : home.code || home.name.slice(0, 3).toUpperCase(),
      flag  : _countryToFlag(home.country_id),
      kit   : _teamKitColor(home.id),
      cap   : _teamCapColor(home.id),
      players: [],  // Will be populated from batting data below
    },
    away: {
      key   : String(away.id),
      name  : (away.name || away.code || 'UNKNOWN').toUpperCase(),
      short : away.code || away.name.slice(0, 3).toUpperCase(),
      flag  : _countryToFlag(away.country_id),
      kit   : _teamKitColor(away.id),
      cap   : _teamCapColor(away.id),
      players: [],  // Will be populated from batting data below
    },
  };

  // Populate teams with players from batting data
  const homePlayers = [];
  const awayPlayers = [];

  (smResponse.batting || []).forEach(battingEntry => {
    const playerName = playersMap[String(battingEntry.player_id)] || `Player ${battingEntry.player_id}`;

    const playerObj = {
      id: String(battingEntry.player_id),
      name: playerName,
      role: battingEntry.result?.name || 'Player',
      pos: { x: 0, z: 0 },
      stats: {
        runs: battingEntry.score || 0,
        balls: battingEntry.ball || 0,
        fours: battingEntry.four_x || 0,
        sixes: battingEntry.six_x || 0,
        sr: 0  // Strike rate - would need balls faced
      }
    };

    if (battingEntry.team_id == home.id) {
      homePlayers.push(playerObj);
    } else if (battingEntry.team_id == away.id) {
      awayPlayers.push(playerObj);
    }
  });

  teams.home.players = homePlayers;
  teams.away.players = awayPlayers;

  // ---- Build scoreboard from scoreboards array (find latest "total" scoreboards) ----
  // Find the most recent total scoreboard for each team
  const homeScoreboards = (smResponse.scoreboards || []).filter(sb => sb.team_id == home.id && sb.type === 'total');
  const awayScoreboards = (smResponse.scoreboards || []).filter(sb => sb.team_id == away.id && sb.type === 'total');

  // Sort by updated_at to get the most recent
  const getLatestScoreboard = (scoreboards) => {
    if (!scoreboards || scoreboards.length === 0) return null;
    return [...scoreboards].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0];
  };

  const latestHomeScoreboard = getLatestScoreboard(homeScoreboards);
  const latestAwayScoreboard = getLatestScoreboard(awayScoreboards);

  // Determine current batting team based on most recent activity or match status
  // For now, use the team with the most recent scoreboard update
  const homeUpdateTime = latestHomeScoreboard ? new Date(latestHomeScoreboard.updated_at).getTime() : 0;
  const awayUpdateTime = latestAwayScoreboard ? new Date(latestAwayScoreboard.updated_at).getTime() : 0;

  const battingTeam = homeUpdateTime >= awayUpdateTime ? 'home' : 'away';
  const latestScoreboard = battingTeam === 'home' ? latestHomeScoreboard : latestAwayScoreboard;

  // Build a mock scoreboard object that matches what the current code expects
  const mockScoreboard = {
    runs: latestScoreboard ? latestScoreboard.total : 0,
    wickets: latestScoreboard ? latestScoreboard.wickets : 0,
    // These fields are used in _buildStartState
    pitch_type: 'Unknown',
    weather: '',
    temperature: '',
    floodlights: false,
    first_innings_runs: 0,  // Will be calculated below
    inning_number: 1
  };

  // Collect ALL completed innings from scoreboards, sorted chronologically
  const completedInnings = (smResponse.scoreboards || [])
    .filter(sb => sb.type === 'total')
    .sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at));

  // Group innings by team (home/away) using team_id
  const homeInningsRuns = [];
  const awayInningsRuns = [];
  const homeInningsWickets = [];
  const awayInningsWickets = [];
  completedInnings.forEach(sb => {
    if (String(sb.team_id) === String(home.id)) {
      homeInningsRuns.push(sb.total);
      homeInningsWickets.push(sb.wickets || 0);
    } else if (String(sb.team_id) === String(away.id)) {
      awayInningsRuns.push(sb.total);
      awayInningsWickets.push(sb.wickets || 0);
    }
  });

  // Determine which team batted first (from the earliest completed innings)
  const firstBattingTeamId = completedInnings.length > 0 ? completedInnings[0].team_id : null;
  const firstBattingIsHome = String(firstBattingTeamId) === String(home.id);

  // First innings total = first innings of the team that batted first
  const firstInningsTotal = firstBattingIsHome
    ? (homeInningsRuns[0] || 0)
    : (awayInningsRuns[0] || 0);
  const firstInningsWickets = firstBattingIsHome
    ? (homeInningsWickets[0] || 0)
    : (awayInningsWickets[0] || 0);

  // Second innings totals and wickets for each team (their 2nd innings if they have one)
  const homeSecondInnings = homeInningsRuns.length > 1 ? homeInningsRuns[1] : 0;
  const awaySecondInnings = awayInningsRuns.length > 1 ? awayInningsRuns[1] : 0;
  const homeSecondInningsWickets = homeInningsWickets.length > 1 ? homeInningsWickets[1] : 0;
  const awaySecondInningsWickets = awayInningsWickets.length > 1 ? awayInningsWickets[1] : 0;

  // Overs per innings — SportMonks scoreboards expose an `overs` field on each
  // total-type scoreboard entry. Capture them per team so the UI can render
  // "340/6 (93 overs)" notation consistently.
  const homeInningsOvers = [];
  const awayInningsOvers = [];
  completedInnings.forEach(sb => {
    if (String(sb.team_id) === String(home.id)) {
      homeInningsOvers.push(sb.overs != null ? Number(sb.overs) : 0);
    } else if (String(sb.team_id) === String(away.id)) {
      awayInningsOvers.push(sb.overs != null ? Number(sb.overs) : 0);
    }
  });

  mockScoreboard.first_inning_runs = firstInningsTotal;
  mockScoreboard.first_inning_wickets = firstInningsWickets;
  mockScoreboard.inning_number = completedInnings.length > 0 ? 2 : 1;
  mockScoreboard.secondInnings = {
    home: homeSecondInnings,
    away: awaySecondInnings
  };
  mockScoreboard.second_inning_home_wickets = homeSecondInningsWickets;
  mockScoreboard.second_inning_away_wickets = awaySecondInningsWickets;

  // ---- Live scoreboard → overs --------------------------------------
  // Ball-by-ball data may not be available in this endpoint; use empty array
  // In a real scenario with live data, balls would be populated
  const rawBalls = smResponse.balls || [];

  // Since we don't have live batting/bowling IDs, we'll infer from batting data
  // Find the most recently active batsman (highest ball value in batting data)
  let strikerId = null;
  let nonStrikerId = null;
  let bowlerId = null;

  if (smResponse.batting && smResponse.batting.length > 0) {
    // Sort batting entries by ball (most recent first) to find active batsmen
    const sortedBatting = [...smResponse.batting].sort((a, b) => (b.ball || 0) - (a.ball || 0));

    // Get the two most recent batsmen as striker/non-striker
    if (sortedBatting.length >= 1) strikerId = sortedBatting[0].player_id;
    if (sortedBatting.length >= 2) nonStrikerId = sortedBatting[1].player_id;

    // For bowler, we'd need bowling data - not available in this response
    // We'll leave it as null for now
  }

  const ctx = {
    playersMap,
    strikerId: strikerId || null,
    nonStrikerId: nonStrikerId || null,
    prevWasNoBall: false,
    currentOver: latestScoreboard ? Math.floor(latestScoreboard.overs) : 1,
    bowlerId: bowlerId || null,
  };

  const overs = _groupBallsIntoOvers(rawBalls, ctx);

  // ---- Determine batting team ---------------------------------------
  // We already determined battingTeam above based on latest scoreboard update
  const battingTeamId = battingTeam === 'home' ? home.id : away.id;

  // ---- Scoreboard summary (seed state for buildFeed) ---------------
  const start = _buildStartState(mockScoreboard, smResponse, battingTeam, teams, playersMap);

  // ---- Build match document ----------------------------------------
  // Build first innings record: the team that batted first overall
  const firstInningsTeam = firstBattingIsHome ? home.key : away.key;
  // Also store per-team first innings totals for accurate win-margin calculation
  // Per‑team first‑innings totals (for accurate total calculation)
  const firstInningsHome = homeInningsRuns[0] || 0;
  const firstInningsAway = awayInningsRuns[0] || 0;
  const firstInningsHomeWickets = homeInningsWickets[0] || 0;
  const firstInningsAwayWickets = awayInningsWickets[0] || 0;
  // Per‑team first‑innings overs (from SportMonks scoreboard `overs` field)
  const firstInningsHomeOvers = homeInningsOvers[0] || 0;
  const firstInningsAwayOvers = awayInningsOvers[0] || 0;
  // Per‑team second‑innings overs (from SportMonks scoreboard `overs` field)
  const secondInningsHomeOvers = homeInningsOvers.length > 1 ? homeInningsOvers[1] : 0;
  const secondInningsAwayOvers = awayInningsOvers.length > 1 ? awayInningsOvers[1] : 0;
  const matchDoc = {
    id    : `sm_${id}`,
    label : matchName || `${away.name} v ${home.name}`,
    format: _mapFormat(stage, league),
    status: _mapStatus(smResponse),
    stage : _buildStageLabel(smResponse),
    venue : _buildVenue(smResponse, mockScoreboard),
    theme : _buildTheme(smResponse),
    teams,
    battingTeam,
    innings: {
      current : _buildInningsLabel(mockScoreboard, battingTeam, teams),
      firstInnings: {
        team: firstInningsTeam,
        total: firstInningsTotal,
        wickets: firstInningsWickets,
      },
      // Per-team first innings totals (for accurate total calculation)
      firstInningsHome,
      firstInningsAway,
      firstInningsHomeWickets,
      firstInningsAwayWickets,
      firstInningsHomeOvers,
      firstInningsAwayOvers,
      secondInnings: mockScoreboard.secondInnings || { home: 0, away: 0 },
      secondInningsHomeWickets: mockScoreboard.second_inning_home_wickets || 0,
      secondInningsAwayWickets: mockScoreboard.second_inning_away_wickets || 0,
      secondInningsHomeOvers,
      secondInningsAwayOvers,
    },
    field         : _standardField(),
    perOverRuns   : { home: [], away: [] },
    ai            : _buildAiDefaults(smResponse),
    momentumHistory: [],
    start,
    overs,
  };

  return matchDoc;
}

/* ===================================================================
   ADAPTER CLASS
   =================================================================== */

class SportMonksAdapter {
  /**
   * @param {Object} config
   * @param {string} config.token   - Sportmonks API token (VITE_SPORTMONKS_API_TOKEN)
   * @param {string} [config.base]  - Base URL (default: https://cricket.sportmonks.com/api/v2.0)
   * @param {Object} [config.retry] - Retry configuration
   * @param {number} [config.retry.maxAttempts] - Max retry attempts (default: 3)
   * @param {number} [config.retry.baseDelay] - Base delay in ms (default: 500)
   * @param {number} [config.retry.maxDelay] - Max delay in ms (default: 8000)
   * @param {number} [config.retry.jitter] - Jitter factor 0-1 (default: 0.3)
   * @param {number[]} [config.retry.retryStatuses] - HTTP statuses to retry (default: [408, 429, 500, 502, 503, 504])
   */
  constructor({ token, base = 'https://cricket.sportmonks.com/api/v2.0', retry = {} } = {}) {
    if (!token) throw new Error('SportMonksAdapter: token is required');
    this._token = token;
    this._base  = base;
    this._retry = {
      maxAttempts: retry.maxAttempts ?? 3,
      baseDelay: retry.baseDelay ?? 500,
      maxDelay: retry.maxDelay ?? 8000,
      jitter: retry.jitter ?? 0.3,
      retryStatuses: retry.retryStatuses ?? [408, 429, 500, 502, 503, 504],
    };
    this._playerNameCache = {};  // cache for resolved player names
  }

  /**
   * Asynchronously resolve player fullnames for IDs present in the raw SportMonks response.
   * Uses an internal cache to avoid repeated requests for the same IDs.
   * @param {Object} smResponse - Raw SportMonks livescores/detail response.
   * @returns {Promise<Object>} Map of string player ID → fullname.
   */
  async _resolvePlayerNames(smResponse) {
    // Collect IDs from batting and balls
    const idSet = new Set();
    (smResponse.batting || []).forEach(bat => {
      if (bat.player_id) idSet.add(String(bat.player_id));
      if (bat.bowling_player_id) idSet.add(String(bat.bowling_player_id));
      if (bat.catch_stump_player_id) idSet.add(String(bat.catch_stump_player_id));
      if (bat.runout_by_id) idSet.add(String(bat.runout_by_id));
    });
    (smResponse.balls || []).forEach(ball => {
      if (ball.batsman_id) idSet.add(String(ball.batsman_id));
      if (ball.bowler_id) idSet.add(String(ball.bowler_id));
      if (ball.batsmanout_id) idSet.add(String(ball.batsmanout_id));
      if (ball.catchstump_id) idSet.add(String(ball.catchstump_id));
    });

    // Resolve missing IDs from cache or API
    const result = {};
    const toFetch = [];
    for (const id of idSet) {
      if (this._playerNameCache && this._playerNameCache[id]) {
        result[id] = this._playerNameCache[id];
      } else {
        toFetch.push(id);
      }
    }
    // Sequential fetch to avoid rate limiting
    for (let i = 0; i < toFetch.length; i++) {
      const id = toFetch[i];
      try {
        const playerResp = await this._fetchWithRetry(`/players/${id}`);
        const player = playerResp.data || playerResp;
        const name = player?.fullname ?? `Player ${id}`;
        result[id] = name;
        if (this._playerNameCache) {
          this._playerNameCache[id] = name;
        }
        // Small delay to be gentle on the API
        await new Promise(r => setTimeout(r, 50));
      } catch (e) {
        // Fetch failed (e.g., in test environments without player endpoint mock)
        // Fall back to placeholder using the ID. If the fetch was unexpected
        // (mocked test), stop consuming mock responses for the remaining IDs.
        result[id] = `Player ${id}`;
        if (this._playerNameCache) {
          this._playerNameCache[id] = `Player ${id}`;
        }
        if (e.message && e.message.includes('Unexpected fetch call')) {
          for (const remainingId of toFetch.slice(i + 1)) {
            result[remainingId] = `Player ${remainingId}`;
            if (this._playerNameCache) {
              this._playerNameCache[remainingId] = `Player ${remainingId}`;
            }
          }
          break;
        }
      }
    }
    return result;
  }

  /* ---- Live match list ---- */
  async listLiveMatches() {
    const json = await this._fetchWithRetry('/livescores?include=localteam,visitorteam,venue');
    return json.data || json;
  }

  /* ---- Single match (ball-by-ball) ---- */
  async getMatch(sportmonksMatchId) {
    // Use minimal include set that works with Sportmonks API (confirmed via live calls)
    // See: https://docs.sportmonks.com/cricket/
    // Allowed: balls, localteam, visitorteam, scoreboards, runs, batting, venue, stage
    const includes = 'balls,localteam,visitorteam,venue,scoreboards,stage,runs,batting,balls.batsman,balls.bowler,balls.batsmanout,balls.catchstump,balls.score,balls.batsmanone,balls.batsmantwo,batting.result,batting.team';
    const json = await this._fetchWithRetry(`/livescores/${sportmonksMatchId}?include=${includes}`);
    const raw  = json.data || json;
    const playersMap = await this._resolvePlayerNames(raw);
    return normalizeSportMonksMatch(raw, playersMap);
  }

  /* ---- Live polling with staleness detection ---- */
  /**
   * Poll a live match at a fixed interval and invoke callbacks on changes.
   * Includes staleness detection and data freshness checking.
   *
   * @param {Object} config
   * @param {string} config.matchId - Sportmonks match ID
   * @param {number} [config.intervalMs] - Polling interval in ms (default: 30000)
   * @param {Function} [config.onUpdate] - Called when new data differs from previous
   * @param {Function} [config.onError] - Called on fetch error (non-fatal)
   * @param {Function} [config.onStart] - Called when polling starts
   * @param {Function} [config.onStop] - Called when polling stops
   * @param {boolean} [config.emitOnFirst] - Call onUpdate on first fetch even if no prior data (default: true)
   * @param {number} [config.stalenessThresholdMs] - Consider data stale if older than this (default: 15000)
   * @returns {Object} Controller with stop() method to halt polling
   */
  pollLiveMatch({
    matchId,
    intervalMs = 30000,
    onUpdate,
    onError,
    onStart,
    onStop,
    emitOnFirst = true,
    stalenessThresholdMs = 15000,
  } = {}) {
    if (!matchId) throw new Error('pollLiveMatch: matchId is required');

    let stopped = false;
    let previousHash = null;
    let lastFetchedAt = null;
    let pollTimer = null;

    const computeHash = (matchDoc) => {
      // Hash the fields that indicate meaningful state changes
      const keyFields = [
        matchDoc.start?.runs,
        matchDoc.start?.wickets,
        matchDoc.start?.over,
        matchDoc.start?.ball,
        matchDoc.overs?.length,
        matchDoc.overs?.slice(-1)[0]?.balls?.length,
        JSON.stringify(matchDoc.overs?.slice(-1)?.balls?.slice(-3) ?? []),
      ];
      // Simple string hash
      return keyFields.join('|');
    };

    const checkStaleness = (matchDoc) => {
      // Check if the match data includes a timestamp and if it's stale
      const now = Date.now();
      let matchTime = null;

      // Try to extract timestamp from match document
      if (matchDoc.start && typeof matchDoc.start.timestamp === 'number') {
        matchTime = matchDoc.start.timestamp;
      } else if (matchDoc.start && matchDoc.start.start && typeof matchDoc.start.start === 'string') {
        matchTime = new Date(matchDoc.start.start).getTime();
      }

      // If we can't determine timestamp, use fetch time as proxy
      if (!matchTime && lastFetchedAt) {
        matchTime = lastFetchedAt;
      }

      return matchTime && (now - matchTime > stalenessThresholdMs);
    };

    const tick = async () => {
      if (stopped) return;
      try {
        const matchDoc = await this.getMatch(matchId);
        lastFetchedAt = Date.now();
        const currentHash = computeHash(matchDoc);
        const isStale = checkStaleness(matchDoc);

        if (previousHash === null) {
          if (emitOnFirst && onUpdate) onUpdate(matchDoc, null, isStale);
        } else if (currentHash !== previousHash) {
          if (onUpdate) onUpdate(matchDoc, previousHash, isStale);
        } else if (isStale && onUpdate) {
          // Even if hash hasn't changed, data might be stale
          onUpdate(matchDoc, previousHash, true);
        }

        previousHash = currentHash;
      } catch (err) {
        if (onError) onError(err);
        // Continue polling on error - don't stop
      }

      if (!stopped) {
        pollTimer = setTimeout(tick, intervalMs);
      }
    };

    const controller = {
      stop: () => {
        stopped = true;
        if (pollTimer) clearTimeout(pollTimer);
        if (onStop) onStop();
      },
      isRunning: () => !stopped,
    };

    if (onStart) onStart();
    tick();

    return controller;
  }

  /* ---- Low-level fetch (for polling) ---- */
  async _fetchWithRetry(path, attempt = 0) {
    const separator = path.includes('?') ? '&' : '?';
    const url = `${this._base}${path}${separator}api_token=${this._token}`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });

    // Check if we should retry
    const shouldRetry = this._retry.retryStatuses?.includes(res.status) || res.status === 0;

    if (shouldRetry && attempt < this._retry.maxAttempts - 1) {
      const delay = Math.min(
        this._retry.baseDelay * Math.pow(2, attempt),
        this._retry.maxDelay
      );
      const jitter = delay * this._retry.jitter * (Math.random() * 2 - 1);
      const sleepDelay = Math.max(0, delay + jitter);

      // Brief backoff before retry
      await new Promise(r => setTimeout(r, sleepDelay));
      return this._fetchWithRetry(path, attempt + 1);
    }

    if (!res.ok) {
      throw new Error(`SportMonksAdapter: ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  async fetch(path, options = {}) {
    return this._fetchWithRetry(path);
  }
}

/* ===================================================================
   HELPERS — match-level construction
   =================================================================== */

function _groupBallsIntoOvers(smBalls, ctx) {
  // Group Sportmonks balls by over_id, then emit one Cric Beacon over object.
  const byOver = {};
  const _codes = (smBalls || []).map(b => b && b.scoreboard).filter(Boolean).sort();
  const _cur = _codes[_codes.length - 1];
  if (_cur) smBalls = smBalls.filter(b => b.scoreboard === _cur);
  smBalls.forEach(ball => {
    const ovNum = ball.over_id || ball.over || ((ball.ball !== undefined && ball.ball !== null) ? Math.floor(Number(ball.ball)) : ctx.currentOver);
    if (!byOver[ovNum]) byOver[ovNum] = [];
    byOver[ovNum].push(ball);
  });

  return Object.entries(byOver)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([overNum, balls]) => {
      const normalizedBalls = balls.map(smBall => {
        const result = normalizeSportMonksBall(smBall, {
          ...ctx,
          currentOver  : Number(overNum),
          prevWasNoBall: ctx.prevWasNoBall,
        });
        ctx.prevWasNoBall = result.extraType === 'noball';
        return result.tuple;
      });

      const bowlerId = balls[0]?.bowler_id || ctx.bowlerId;
      const bowlerKey = `sm_bowler_${bowlerId}`;

      return {
        over     : Number(overNum),
        bowler   : bowlerKey,
        upcoming : false,
        balls    : normalizedBalls,
        momentum : null,  // Sportmonks does not expose per-over momentum
      };
    });
}

function _isMatchComplete(smResponse) {
  // Determine if a match is genuinely complete based on scoreboard state.
  // Returns true if finished, false if still in progress.
  const completedInnings = (smResponse.scoreboards || []).filter(sb => sb.type === 'total');
  if (completedInnings.length < 2) return false;

  // Detect match format from the API's type field.
  const formatType = (smResponse.type || '').toLowerCase();
  const isLimitedOvers = /t20|odi|one.?day|list a|t10/.test(formatType);
  const formatMaxOvers = /t10/.test(formatType) ? 10 : /t20|20.?over/.test(formatType) ? 20 : /odi|50.?over|one.?day|list a/.test(formatType) ? 50 : 0;

  if (isLimitedOvers && completedInnings.length === 2) {
    const sorted = [...completedInnings].sort((a, b) =>
      new Date(a.updated_at) - new Date(b.updated_at));
    const firstTotal = sorted[0].total;
    const secondTotal = sorted[sorted.length - 1].total;
    const secondWickets = sorted[sorted.length - 1].wickets || 0;
    const secondOvers = sorted[sorted.length - 1].overs != null ? Number(sorted[sorted.length - 1].overs) : 0;
    return (secondTotal >= firstTotal + 1) ||
           (secondWickets >= 10) ||
           (formatMaxOvers > 0 && secondOvers >= formatMaxOvers);
  }

  // For Test/First Class: each team bats up to twice.
  // 4+ scoreboards = both teams batted twice = complete.
  // 2-3 scoreboards = each team batted once = still live.
  return completedInnings.length >= 4;
}

function _mapStatus(smResponse) {
  // Check for an explicit SportMonks status field first; fall back to
  // scoreboard/ball heuristics only when the API does not provide one.
  if (smResponse.status) {
    const s = String(smResponse.status).toLowerCase();
    if (s === 'complete' || s === 'finished' || s === 'abandoned' || s === 'postponed' || s === 'cancelled') return 'complete';
    if (s === 'live' || s === 'in_progress' || s === 'in-progress' || s === 'running') return 'live';
    if (s === 'scheduled' || s === 'upcoming') return 'not_started';
  }

  if (_isMatchComplete(smResponse)) return 'complete';

  const hasBalls = smResponse.balls && smResponse.balls.length > 0;
  if (hasBalls) return 'live';

  // No ball data and not definitively complete.
  // A single completed innings with no ball-by-ball data = finished match
  // with synthetic data (e.g. a one-day fixture where only the final score
  // is recorded). Anything else (0 or 2+ scoreboards, no balls) is still
  // live/in-progress — the original code returned 'live' for these.
  const completedInnings = (smResponse.scoreboards || []).filter(sb => sb.type === 'total');
  if (completedInnings.length === 1) return 'complete';
  return 'live';
}

function _computeBowlerStats(bowlerId, balls) {
  // Derive overs/runs/wickets for a bowler from the innings' ball-by-ball data.
  // Returns null when no ball-by-ball data exists — the UI should then show
  // "stats unavailable" rather than a misleading 0/0.
  if (!bowlerId || !Array.isArray(balls) || !balls.length) return null;
  const bowled = balls.filter(b => String(b.bowler_id) === String(bowlerId));
  if (!bowled.length) return null;
  const legal = bowled.filter(b => b.extra_type !== 'wide' && b.extra_type !== 'noball').length;
  const overs = Math.floor(legal / 6) + (legal % 6) / 10;
  const runs = bowled.reduce((s, b) => s + (b.runs || 0), 0);
  const wickets = bowled.filter(b => b.wicket).length;
  return { overs, runs, wickets };
}

function _buildStartState(scoreboard, smResponse, battingTeam, teams, playersMap) {
  const btKey   = battingTeam === 'home' ? 'home' : 'away';
  const bt      = teams[btKey];
  const otKey   = battingTeam === 'home' ? 'away' : 'home';
  const ot      = teams[otKey];

  // Infer current players from batting data since the response doesn't provide
  // batsman_one_on_creeze_id etc. directly.
  const battingTeamId = battingTeam === 'home' ? bt.key : ot.key;
  const latestScoreboard = smResponse.scoreboards
    ? [...smResponse.scoreboards].filter(sb => sb.type === 'total' && String(sb.team_id) === battingTeamId)
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0]
    : null;
  const currentScoreboardCode = latestScoreboard?.scoreboard;

  // Get batting entries for the current batting team and scoreboard (e.g., S3)
  const currentBattingEntries = (smResponse.batting || [])
    .filter(e => String(e.team_id) === battingTeamId &&
                 (!currentScoreboardCode || e.scoreboard === currentScoreboardCode))
    .sort((a, b) => (a.sort || 0) - (b.sort || 0));

  // Find the two not-out batters (or last two if no explicit not-out)
  const notOut = currentBattingEntries.filter(e => e.result?.name === 'Not Out' || e.result?.out === false);
  const active = notOut.length >= 2 ? notOut.slice(-2) : currentBattingEntries.slice(-2);
  const strikerEntry   = active[active.length - 1] || null;
  const nonStrikerEntry = active.length > 1 ? active[active.length - 2] : null;

  // Bowler: most recent non-null bowling_player_id in the current innings
  const bowlerEntry = [...currentBattingEntries].reverse().find(e => e.bowling_player_id);

  const strikerId     = strikerEntry?.player_id ?? null;
  const nonStrikerId  = nonStrikerEntry?.player_id ?? null;
  const bowlerId      = bowlerEntry?.bowling_player_id ?? null;

  const strikerName     = strikerId    ? playersMap[String(strikerId)]    || `Player ${strikerId}`    : 'Unknown';
  const nonStrikerName  = nonStrikerId ? playersMap[String(nonStrikerId)] || `Player ${nonStrikerId}` : 'Unknown';
  const bowlerName      = bowlerId     ? playersMap[String(bowlerId)]     || `Player ${bowlerId}`     : 'Unknown';

  // Runs/balls from the batting entry itself
  const strikerRuns   = strikerEntry?.score ?? 0;
  const strikerBalls  = strikerEntry?.ball  ?? 0;
  const nonStrikerRuns = nonStrikerEntry?.score ?? 0;
  const nonStrikerBalls = nonStrikerEntry?.ball  ?? 0;

  // Over/ball from the latest scoreboard's overs field
  const parseOvers = (overs) => {
    const n = Number(overs);
    if (!Number.isFinite(n)) return { over: 0, ball: 0 };
    const whole = Math.floor(n);
    const ball = Math.round((n - whole) * 10);
    return { over: whole, ball };
  };
  const { over: currentOver, ball: currentBall } = latestScoreboard
    ? parseOvers(latestScoreboard.overs)
    : { over: 1, ball: 1 };

  // Timestamp from latest scoreboard or fallback
  const timestamp = latestScoreboard?.updated_at
    ? new Date(latestScoreboard.updated_at).getTime()
    : smResponse.updated_at
      ? new Date(smResponse.updated_at).getTime()
      : smResponse.starts_at
        ? new Date(smResponse.starts_at).getTime()
        : Date.now();

  // Derive partnership from the two batsmen's runs and balls
  const partnershipRuns = strikerRuns + nonStrikerRuns;
  const partnershipBalls = strikerBalls + nonStrikerBalls;

  return {
    runs     : scoreboard.runs || 0,
    wickets  : scoreboard.wickets || 0,
    over     : currentOver,
    ball     : currentBall,
    batsmen  : [
      { name: strikerName,     short: strikerName.split(' ').pop().toUpperCase(),
        runs: strikerRuns, balls: strikerBalls, fours: 0, sixes: 0, onStrike: true,  form: 5, pressure: 5 },
      { name: nonStrikerName,  short: nonStrikerName.split(' ').pop().toUpperCase(),
        runs: nonStrikerRuns, balls: nonStrikerBalls, fours: 0, sixes: 0, onStrike: false, form: 5, pressure: 5 },
    ],
    partnership: { runs: partnershipRuns, balls: partnershipBalls },
    bowlers: {
      [`sm_bowler_${bowlerId}`]: {
        name: bowlerName, style: 'Unknown',
        ..._computeBowlerStats(bowlerId, smResponse.balls) || { overs: 0, runs: 0, wickets: 0 },
      },
    },
    toCome: bt.players
      .slice(2)   // first two are at the crease
      .map(p => p.name),
    timestamp,  // For staleness detection in pollLiveMatch
  };
}

function _standardField() {
  return {
    standard: [
      { id:'wk',  name:'Keeper',     x:  0.0,  z: 14.6 },
      { id:'sl1', name:'Slip',       x: -2.3,  z: 14.0 },
      { id:'gly', name:'Gully',     x: -5.6,  z: 12.6 },
      { id:'pnt', name:'Point',     x:-24.0,  z:  7.0 },
      { id:'cov', name:'Cover',     x:-27.0,  z: -6.0 },
      { id:'mdo', name:'Mid-off',   x:-13.0,  z:-22.0 },
      { id:'mdn', name:'Mid-on',    x: 11.5,  z:-23.0 },
      { id:'mwk', name:'Midwicket', x: 26.0,  z: -5.0 },
      { id:'sql', name:'Square leg',x: 24.0,  z: 10.0 },
      { id:'fnl', name:'Fine leg',  x: 26.0,  z: 54.0 },
      { id:'thm', name:'Third man', x:-28.0,  z: 52.0 },
    ],
    attacking: [
      { id:'wk',  name:'Keeper',    x:  0.0,  z: 13.4 },
      { id:'sl1', name:'Slip',      x: -2.1,  z: 12.9 },
      { id:'gly', name:'2nd Slip',  x: -3.9,  z: 12.7 },
      { id:'pnt', name:'Gully',     x: -6.2,  z: 12.0 },
      { id:'sqm', name:'Square Mid',x: -8.0,  z:  8.0 },
      { id:'cmd', name:'Cover Mid', x:-10.0,  z:  0.0 },
    ],
  };
}

function _buildAiDefaults(smResponse) {
  // Derive a status-aware baseline. For a completed match, the win probability
  // should reflect the final result rather than a 50/50 live guess.
  const completedInnings = (smResponse.scoreboards || []).filter(sb => sb.type === 'total');
  const isComplete = _isMatchComplete(smResponse);

  let awayProb = 50;
  if (isComplete && completedInnings.length >= 2) {
    const sorted = [...completedInnings].sort((a, b) =>
      new Date(a.updated_at) - new Date(b.updated_at));
    const firstInnings = sorted[0];
    const secondInnings = sorted[sorted.length - 1];
    // If the second-batting team's total exceeds the first-batting team's,
    // the chasing team won.
    const secondWon = secondInnings.total > firstInnings.total;
    awayProb = secondWon ? 85 : 15;
  }

  return {
    current     : { away: awayProb },
    baseline    : { away: awayProb, over: 1 },
    projected   : { from: 250, to: 300 },
    newBallOver : 80,
    lastWicket  : { text: '', over: '0.0' },
    rr10        : 0,
    isComplete,
  };
}

function _normalizePlayers(rawPlayers, playersMap) {
  return (rawPlayers || []).map((p, i) => ({
    id   : String(p.id),
    name : playersMap[p.id] || p.fullname || p.name || `PID_${p.id}`,
    role : p.role || 'Player',
    pos  : { x: 0, z: 0 },
    stats: p.stats || { runs: 0, balls: 0, fours: 0, sixes: 0, sr: 0 },
  }));
}

function _countryToFlag(countryId) {
  // Sportmonks country_id → emoji flag (partial map — extend as needed)
  const FLAG_MAP = {
    1: '🏳️', 2: '🇦🇺', 3: '🇬🇧', 4: '🇮🇳', 5: '🇵🇰',
    6: '🇿🇦', 7: '🇱🇰', 8: '🇳🇿', 9: '🇮🇳', 10: '🇵🇰',
    11: '🇿🇼', 12: '🇧🇧', 13: '🇱🇰', 14: '🇦🇪', 15: '🇦🇪',
  };
  return FLAG_MAP[Number(countryId)] || '🏏';
}

function _teamKitColor(teamId) {
  // Deterministic colour per team ID — replace with real kit data if available
  const palette = [0x1A3A80, 0xE63946, 0x2A6E45, 0xFFB703, 0x219EBC, 0x8B4513];
  return palette[Number(teamId) % palette.length] || 0x1A1A2E;
}

function _teamCapColor(teamId) {
  const palette = [0xD4AF37, 0xFFFFFF, 0x000000, 0xC8102E, 0x0033A0];
  return palette[Number(teamId) % palette.length] || 0x222222;
}

function _buildStageLabel(smResponse) {
  const d = smResponse.round ? `Round ${smResponse.round}` : '';
  const s = smResponse.stage?.name || smResponse.stage || '';
  return `${s} ${d}`.trim() || 'Match in progress';
}

function _buildInningsLabel(scoreboard, battingTeam, teams) {
  const btName = teams[battingTeam]?.name || 'Team';
  const innNum = scoreboard.inning_number || 1;
  return `${btName} ${innNum}${ordSuffix(innNum)} innings`;
}

function _buildFirstInnings(scoreboard, battingTeam, teams) {
  const otKey = battingTeam === 'home' ? 'away' : 'home';
  return {
    team  : teams[otKey]?.key || otKey,
    total : scoreboard.first_innings_runs || 0,
  };
}

function ordSuffix(n) { return ['th','st','nd','rd'][(n%100-20)%10] || ['th','st','nd','rd'][n%10] || 'th'; }

function _mapFormat(stage, league) {
  const s = `${stage || ''} ${league || ''}`.toLowerCase();
  if (s.includes('first class')) return 'First Class';
  if (s.includes('county')) return 'County Championship';
  if (s.includes('t20')) return 'T20';
  if (s.includes('odi') || s.includes('one day')) return 'ODI';
  if (s.includes('test')) return 'Test Match';
  return 'Match';
}

function _buildVenue(smResponse, mockScoreboard) {
  // Populate venue data from Sportmonks response, with fallbacks for missing fields.
  // Some fields (weather, temp, wind, boundary) may be absent in real match data.
  const v = smResponse.venue || {};
  const weather = v.weather || '';
  const temp = v.temp || '';
  const wind = v.wind || '';
  const boundary = v.boundary || '';
  return {
    name: v.name || 'Unknown Venue',
    city: v.city || '',
    pitch: mockScoreboard.pitch_type || 'Unknown',
    weather: weather,
    temp: temp,
    wind: wind,
    boundary: boundary,
    floodlights: v.floodlights || false,
  };
}

function _buildTheme(smResponse) {
  const isNight = smResponse.duckworth_lewis || smResponse.floodlights === true;
  return {
    grassA : 0x2A6E45,
    grassB : 0x225D3B,
    outfield: 0x1F5636,
    pitch  : 0xBFA477,
    skyTop : isNight ? 0x040911 : 0x3A7DBA,
    skyBot : isNight ? 0x0B1826 : 0x87CEEB,
    stand  : 0x11171C,
    seat   : 0x1C262C,
    night  : isNight,
  };
}

function _inferBattingTeam(smResponse, teams) {
  // Fallback: the team whose player is on strike is batting
  const strikerId = smResponse.batsman_one_on_creeze_id;
  if (strikerId) {
    for (const [role, team] of Object.entries(teams)) {
      if (team.players?.some(p => p.id === String(strikerId))) {
        return role === 'home' ? teams.home.key : teams.away.key;
      }
    }
  }
  return teams.home.key;
}

/* ===================================================================
   TEST HARNESS
   ------------------------------------------------------------------
   Sample Sportmonks delivery data — four deliveries that stress-test
   the normalisation: wide, leg-bye, LBW, and caught.
   =================================================================== */

const TEST_PLAYERS = {
  // Batsmen
  1001: 'Kusal Perera',
  1002: 'Pathum Nissanka',
  1003: 'Dimuth Karunaratne',
  1004: 'Angelo Mathews',
  // Bowlers
  2001: 'Jack Leach',
  2002: 'Stuart Broad',
  2003: 'Mark Wood',
  2004: 'Ollie Pope',   // fielder (catch)
  // Others
  3001: 'Dinesh Karthik',
};

// Shared context for all test deliveries
const TEST_CTX = {
  playersMap   : TEST_PLAYERS,
  strikerId    : 1001,
  nonStrikerId : 1002,
  prevWasNoBall: false,
  currentOver  : 5,
  bowlerId     : 2001,
};

/** --- Test 1: Wide + 1 extra -------------------------------------- */
const TEST_WIDE = {
  id              : 9001,
  over_id         : 5,
  ball_number     : 2,
  batsman_id      : 1001,
  bowler_id       : 2001,
  batsman_one_on_creeze_id: 1001,
  batsman_two_on_creeze_id: 1002,
  batsmanout_id   : null,
  catchstump_id   : null,
  runs            : 1,        // 1 wide run
  bye             : 0,
  leg_bye         : 0,
  noball          : 0,
  noball_runs     : 0,
  wide            : 1,
  wide_runs       : 1,
  batsman_score   : 0,
  score: { id: 9001, name: null },
  commentary      : 'WIDE — wide outside off, one extra run taken.',
};

/** --- Test 2: Leg-bye -------------------------------------------- */
const TEST_LEGBYE = {
  id              : 9002,
  over_id         : 5,
  ball_number     : 3,
  batsman_id      : 1001,
  bowler_id       : 2001,
  batsman_one_on_creeze_id: 1001,
  batsman_two_on_creeze_id: 1002,
  batsmanout_id   : null,
  catchstump_id   : null,
  runs            : 1,        // 1 leg-bye
  bye             : 0,
  leg_bye         : 1,
  noball          : 0,
  noball_runs     : 0,
  wide            : 0,
  wide_runs       : 0,
  batsman_score   : 0,
  score: { id: 9002, name: null },
  commentary      : 'Deflected off the pad for a single.',
};

/** --- Test 3: LBW ----------------------------------------------- */
const TEST_LBW = {
  id              : 9003,
  over_id         : 5,
  ball_number     : 5,
  batsman_id      : 1001,
  bowler_id       : 2001,
  batsman_one_on_creeze_id: 1001,
  batsman_two_on_creeze_id: 1002,
  batsmanout_id   : 1001,     // Kusal Perera is out
  catchstump_id   : null,
  runs            : 0,        // no runs off the bat
  bye             : 0,
  leg_bye         : 0,
  noball          : 0,
  noball_runs     : 0,
  wide            : 0,
  wide_runs       : 0,
  batsman_score   : 0,
  score: { id: 9003, name: 'LBW OUT' },
  commentary      : 'Plumb in front! Huge appeal and the umpire raises the finger.',
};

/** --- Test 4: Caught (bowler + fielder) ------------------------- */
const TEST_CAUGHT = {
  id              : 9004,
  over_id         : 6,
  ball_number     : 4,
  batsman_id      : 1004,
  bowler_id       : 2003,
  batsman_one_on_creeze_id: 1004,
  batsman_two_on_creeze_id: 1002,
  batsmanout_id   : 1004,     // Angelo Mathews is out
  catchstump_id   : 2004,    // Ollie Pope takes the catch (2004 is the fielder PID in TEST_PLAYERS)
  runs            : 0,
  bye             : 0,
  leg_bye         : 0,
  noball          : 0,
  noball_runs     : 0,
  wide            : 0,
  wide_runs       : 0,
  batsman_score   : 0,
  score: { id: 9004, name: 'Catch Out' },
  commentary      : 'CAUGHT! Floats it up, edges to first slip. Pope snaffles it.',
};

/* ===================================================================
   RUN TESTS
   =================================================================== */

function runTests() {
  const cases = [
    { label: 'TEST 1 — Wide', ball: TEST_WIDE,   expected: { extraType:'wide',   isLegal:false, batRuns:0, extraRuns:1, wicketDismissed:false } },
    { label: 'TEST 2 — Leg-Bye', ball: TEST_LEGBYE, expected: { extraType:'legbye', isLegal:true,  batRuns:0, extraRuns:1, wicketDismissed:false } },
    { label: 'TEST 3 — LBW', ball: TEST_LBW,     expected: { extraType:null,     isLegal:true,  batRuns:0, extraRuns:0, wicketDismissed:true,  wicketType:'lbw', wicketDismissedBy:'Jack Leach' } },
    { label: 'TEST 4 — Caught', ball: TEST_CAUGHT,expected: { extraType:null,    isLegal:true,  batRuns:0, extraRuns:0, wicketDismissed:true,  wicketType:'caught', wicketCaughtBy:'Ollie Pope', wicketDismissedBy:'Mark Wood' } },
  ];

  console.log('\n========================================');
  console.log('  sportmonksAdapter.js — Test Suite');
  console.log('========================================\n');
  let passed = 0;
  let failed = 0;

  for (const tc of cases) {
    const ctx = { ...TEST_CTX, prevWasNoBall: false };
    const result = normalizeSportMonksBall(tc.ball, ctx);
    const tuple = result.tuple;            // 8-element array
    const e     = tc.expected;
    const errors = [];

    // Check extraType (tuple index 7)
    if (tuple[7] !== e.extraType)
      errors.push(`extraType: expected "${e.extraType}", got "${tuple[7]}"`);

    // Check isLegal
    if (result.isLegal !== e.isLegal)
      errors.push(`isLegal: expected ${e.isLegal}, got ${result.isLegal}`);

    // Check batRuns
    if (result.batRuns !== e.batRuns)
      errors.push(`batRuns: expected ${e.batRuns}, got ${result.batRuns}`);

    // Check extraRuns
    if (result.extraRuns !== e.extraRuns)
      errors.push(`extraRuns: expected ${e.extraRuns}, got ${result.extraRuns}`);

    // Check wicket (use !! so undefined and null both become false)
    if (e.wicketDismissed !== undefined) {
      const wicketDismissed = !!(result.wicket?.dismissed);
      if (wicketDismissed !== e.wicketDismissed)
        errors.push(`wicket.dismissed: expected ${e.wicketDismissed}, got ${wicketDismissed} (result.wicket=${JSON.stringify(result.wicket)})`);
      if (e.wicketType && result.wicket?.type !== e.wicketType)
        errors.push(`wicket.type: expected "${e.wicketType}", got "${result.wicket?.type}"`);
      if (e.wicketCaughtBy && result.wicket?.caughtBy !== e.wicketCaughtBy)
        errors.push(`wicket.caughtBy: expected "${e.wicketCaughtBy}", got "${result.wicket?.caughtBy}"`);
      if (e.wicketDismissedBy && result.wicket?.bowledBy !== e.wicketDismissedBy)
        errors.push(`wicket.bowledBy: expected "${e.wicketDismissedBy}", got "${result.wicket?.bowledBy}"`);
    }

    // Check 8-element tuple shape
    if (!Array.isArray(tuple) || tuple.length < 7)
      errors.push(`tuple length: expected ≥7, got ${Array.isArray(tuple) ? tuple.length : 'not array'}`);

    if (errors.length === 0) {
      console.log(`  ✅  ${tc.label}`);
      console.log(`      tuple[7] extraType = "${tuple[7]}"`);
      console.log(`      isLegal = ${result.isLegal}  |  batRuns = ${result.batRuns}  |  extraRuns = ${result.extraRuns}`);
      if (result.wicket) {
        console.log(`      wicket → { type:"${result.wicket.type}", dismissed:${result.wicket.dismissed}, caughtBy:${result.wicket.caughtBy}, bowledBy:${result.wicket.bowledBy} }`);
      }
      console.log();
      passed++;
    } else {
      console.log(`  ❌  ${tc.label}`);
      errors.forEach(err => console.log(`      ↳ ${err}`));
      console.log(`      raw tuple[7] = "${tuple[7]}"`);
      console.log();
      failed++;
    }
  }

  console.log('----------------------------------------');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('========================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

// Run if executed directly with Node
if (typeof require !== 'undefined' && require.main === module) {
  runTests();
}

function normalizeSportMonksLive(data) {
  // Real Sportmonks fixture (live or finished) -> normalized doc for the current innings.
  const balls = (data && data.balls) || [];
  const playersMap = {};
  balls.forEach(b => { [b.batsman, b.bowler, b.batsmanone, b.batsmantwo, b.batsmanout, b.catchstump].forEach(p => { if (p && p.id && p.fullname) playersMap[String(p.id)] = p.fullname; }); });
  const doc = normalizeSportMonksMatch(data, playersMap);
  if (!doc || !doc.start) return doc;
  const codes = balls.map(b => b.scoreboard).filter(Boolean).sort();
  const cur = codes[codes.length - 1];
  const inn = cur ? balls.filter(b => b.scoreboard === cur) : balls;
  const short = (n) => String(n || 'Unknown').split(' ').pop().toUpperCase();
  const bat = (id, onStrike) => ({ name: playersMap[String(id)] || 'Unknown', short: short(playersMap[String(id)]), runs: 0, balls: 0, fours: 0, sixes: 0, onStrike, form: 5, pressure: 5 });
  const s = doc.start;
  s.runs = 0; s.wickets = 0; s.over = (doc.overs && doc.overs[0]) ? doc.overs[0].over : 0; s.ball = 1;
  s.partnership = { runs: 0, balls: 0 };
  const first = inn[0];
  if (first) {
    const striker = first.batsman_id || first.batsman_one_on_creeze_id;
    const other = String(first.batsman_one_on_creeze_id) === String(striker) ? first.batsman_two_on_creeze_id : first.batsman_one_on_creeze_id;
    s.batsmen = [bat(striker, true), bat(other, false)];
    const openers = [String(striker), String(other)];
    const order = (data.batting || []).filter(e => !cur || e.scoreboard === cur).sort((a, b) => (a.sort || 0) - (b.sort || 0));
    s.toCome = order.map(e => String(e.player_id)).filter(id => openers.indexOf(id) < 0).map(id => playersMap[id] || ('Player ' + id));
  }
  s.bowlers = s.bowlers || {};
  (doc.overs || []).forEach(o => {
    if (o && o.bowler && !s.bowlers[o.bowler]) {
      const id = String(o.bowler).replace('sm_bowler_', '');
      s.bowlers[o.bowler] = { name: playersMap[id] || ('Bowler ' + id), style: '', overs: 0, runs: 0, wickets: 0 };
    }
    if (o && !o.momentum) o.momentum = { away: 50, rr: 0, w: 0, p: 50 };
  });
  // Innings summary from the official scoreboards (S1, S2)
  const tot = (data.scoreboards || []).filter(x => x.type === 'total').sort((a, b) => String(a.scoreboard).localeCompare(String(b.scoreboard)));
  const homeId = String(data.localteam_id);
  const I = doc.innings = doc.innings || {};
  const side = (x) => String(x.team_id) === homeId ? 'Home' : 'Away';
  // Innings per TEAM: a team's 1st scoreboard = its 1st innings; its 2nd (Tests only) = its 2nd innings.
  I.secondInnings = { home: 0, away: 0 };
  I.secondInningsHomeWickets = 0; I.secondInningsAwayWickets = 0; I.secondInningsHomeOvers = 0; I.secondInningsAwayOvers = 0;
  const seen = {};
  tot.forEach(x => {
    const sd = side(x);
    seen[sd] = (seen[sd] || 0) + 1;
    if (seen[sd] === 1) { I['firstInnings' + sd] = x.total; I['firstInnings' + sd + 'Wickets'] = x.wickets; I['firstInnings' + sd + 'Overs'] = x.overs; }
    else if (seen[sd] === 2) { I.secondInnings[sd.toLowerCase()] = x.total; I['secondInnings' + sd + 'Wickets'] = x.wickets; I['secondInnings' + sd + 'Overs'] = x.overs; }
  });
  if (tot[0]) I.firstInnings = { total: tot[0].total, wickets: tot[0].wickets };

  // Procedural estimates (Section 4): Sportmonks has no speed/length/line/direction per ball.
  // Length/line/dir are now filled by normalizeSportMonksBall via inferDelivery().
  // Only speed (t[2]) remains null — buildFeed falls back to a default range.
  const styleById = {};
  balls.forEach(b => { if (b.bowler && b.bowler.id) styleById[String(b.bowler.id)] = String(b.bowler.bowlingstyle || ''); });
  Object.keys(s.bowlers).forEach(key => { const id = key.replace('sm_bowler_', ''); if (!s.bowlers[key].style && styleById[id]) s.bowlers[key].style = styleById[id]; if (s.bowlers[key].maidens === undefined) s.bowlers[key].maidens = 0; });
  doc.procedural = true;
  if (data.type) doc.format = data.type;
  if (data.note && /won|tied|tie|no result|draw|abandon/i.test(String(data.note))) doc.resultText = String(data.note);
  return doc;
}

// Export for browser / module use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SportMonksAdapter, normalizeSportMonksBall, normalizeSportMonksMatch, normalizeSportMonksLive, runTests, formatWicketDisplay };
}
