/**
 * sportmonksAdapter.js
 * ====================
 * Phase 2 Provider Adapter: Sportmonks World Plan API → Cric Beacon MatchDocument.
 *
 * API base: https://cricapi.com/api/v1/
 * Auth:     ?token=<VITE_SPORTMONKS_API_TOKEN>
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
  } = smBall;

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
  let   batRuns       = Number(batsman_score) || null;
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
  // Sportmonks World plan may include rate_id / ball_type fields.
  // Map them to our LENGTHS / LINES if present; otherwise null.
  const speed   = smBall.rate_id  ? null : null;  // placeholder — Sportmonks
                                                   // does not expose km/h per ball
                                                   // in the public endpoint; set
                                                   // null and buildFeed will use
                                                   // a default range for display.
  const length  = smBall.ball_type
    ? _mapBallType(smBall.ball_type)
    : null;
  const line    = smBall.line
    ? _mapLine(smBall.line)
    : null;
  const dir     = smBall.direction
    ? _mapDirection(smBall.direction)
    : null;

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

function normalizeSportMonksMatch(smResponse) {
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

  // Build player lookup: PID → full name
  const playersMap = {};
  (smResponse.players || []).forEach(p => {
    playersMap[p.id] = p.fullname || p.name || `PID_${p.id}`;
  });

  // ---- Teams --------------------------------------------------------
  const home = localteam;
  const away = visitorteam;

  const teams = {
    home: {
      key   : String(home.id),
      name  : home.name.toUpperCase(),
      short : home.code || home.name.slice(0, 3).toUpperCase(),
      flag  : _countryToFlag(home.country_id),
      kit   : _teamKitColor(home.id),
      cap   : _teamCapColor(home.id),
      players: _normalizePlayers(home.players || [], playersMap),
    },
    away: {
      key   : String(away.id),
      name  : away.name.toUpperCase(),
      short : away.code || away.name.slice(0, 3).toUpperCase(),
      flag  : _countryToFlag(away.country_id),
      kit   : _teamKitColor(away.id),
      cap   : _teamCapColor(away.id),
      players: _normalizePlayers(away.players || [], playersMap),
    },
  };

  // ---- Live scoreboard → overs --------------------------------------
  // Sportmonks `live_scoreboard` contains the in-progress innings.
  // Ball-by-ball lives in `livescore_data` or `balls[]` depending on endpoint.
  // Normalise whichever shape Sportmonks returns.
  const rawBalls = smResponse.livescore_data
    || smResponse.live_scoreboard?.balls
    || smResponse.balls
    || [];

  const ctx = {
    playersMap,
    strikerId   : smResponse.batsman_one_on_creeze_id || null,
    nonStrikerId: smResponse.batsman_two_on_creeze_id || null,
    prevWasNoBall: false,
    currentOver : smResponse.over || 1,
    bowlerId    : smResponse.bowler_id || null,
  };

  const overs = _groupBallsIntoOvers(rawBalls, ctx);

  // ---- Determine batting team ---------------------------------------
  // Sportmonks tells us which team is batting via `team_batting` or we infer
  // from which team the current striker belongs to.
  const battingTeamId = smResponse.team_batting || _inferBattingTeam(smResponse, teams);
  const battingTeam   = battingTeamId == away.id ? 'away' : 'home';

  // ---- Scoreboard summary (seed state for buildFeed) ---------------
  const scoreboard = smResponse.live_scoreboard || smResponse.score || {};
  const start = _buildStartState(scoreboard, smResponse, battingTeam, teams);

  // ---- Build match document ----------------------------------------
  const matchDoc = {
    id    : `sm_${id}`,
    label : matchName || `${away.name} v ${home.name}`,
    format: _mapFormat(stage, league),
    stage : _buildStageLabel(smResponse),
    venue : {
      name   : smResponse.venue?.name || 'Unknown Venue',
      city   : smResponse.venue?.city || '',
      pitch  : scoreboard.pitch_type || 'Unknown',
      weather: scoreboard.weather || '',
      temp   : scoreboard.temperature || '',
      wind   : '',
      boundary: '',
      floodlights: scoreboard.floodlights || false,
    },
    theme : _buildTheme(smResponse),
    teams,
    battingTeam,
    innings: {
      current : _buildInningsLabel(scoreboard, battingTeam, teams),
      firstInnings: _buildFirstInnings(scoreboard, battingTeam, teams),
    },
    field         : _standardField(),
    perOverRuns   : { home: [], away: [] },
    ai            : _buildAiDefaults(),
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
   * @param {string} [config.base]  - Base URL (default: https://cricapi.com/api/v1)
   */
  constructor({ token, base = 'https://cricapi.com/api/v1' } = {}) {
    if (!token) throw new Error('SportMonksAdapter: token is required');
    this._token = token;
    this._base  = base;
  }

  /* ---- Live match list ---- */
  async listLiveMatches() {
    const url = `${this._base}/livescores?token=${this._token}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`SportMonksAdapter: ${res.status} ${res.statusText}`);
    const json = await res.json();
    return json.data || json;
  }

  /* ---- Single match (ball-by-ball) ---- */
  async getMatch(sportmonksMatchId) {
    const url = `${this._base}/livescores/${sportmonksMatchId}?token=${this._token}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`SportMonksAdapter: ${res.status} ${res.statusText}`);
    const json = await res.json();
    const raw  = json.data || json;
    return normalizeSportMonksMatch(raw);
  }

  /* ---- Low-level fetch (for polling) ---- */
  async fetch(path) {
    const url = `${this._base}${path}?token=${this._token}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`SportMonksAdapter: ${res.status} ${res.statusText}`);
    return res.json();
  }
}

/* ===================================================================
   HELPERS — match-level construction
   =================================================================== */

function _groupBallsIntoOvers(smBalls, ctx) {
  // Group Sportmonks balls by over_id, then emit one Cric Beacon over object.
  const byOver = {};
  smBalls.forEach(ball => {
    const ovNum = ball.over_id || ball.over || ctx.currentOver;
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

function _buildStartState(scoreboard, smResponse, battingTeam, teams) {
  const btKey   = battingTeam === 'home' ? 'home' : 'away';
  const bt      = teams[btKey];
  const otKey   = battingTeam === 'home' ? 'away' : 'home';
  const ot      = teams[otKey];

  const strikerId     = smResponse.batsman_one_on_creeze_id;
  const nonStrikerId  = smResponse.batsman_two_on_creeze_id;
  const strikerName   = strikerId    ? bt.players.find(p => p.id === String(strikerId))?.name    || `PID_${strikerId}`    : 'Unknown';
  const nonStrikerName= nonStrikerId ? bt.players.find(p => p.id === String(nonStrikerId))?.name || `PID_${nonStrikerId}` : 'Unknown';
  const strikerRuns   = smResponse.batsman_score || 0;
  const strikerBalls  = smResponse.batsman_balls || 0;

  const bowlerId  = smResponse.bowler_id;
  const bowlerName= bowlerId ? ot.players.find(p => p.id === String(bowlerId))?.name || `PID_${bowlerId}` : 'Unknown';

  return {
    runs     : scoreboard.runs || 0,
    wickets  : scoreboard.wickets || 0,
    over     : smResponse.over || 1,
    ball     : smResponse.ball || 1,
    batsmen  : [
      { name: strikerName,     short: strikerName.split(' ').pop().toUpperCase(),
        runs: strikerRuns, balls: strikerBalls, fours: 0, sixes: 0, onStrike: true,  form: 5, pressure: 5 },
      { name: nonStrikerName,  short: nonStrikerName.split(' ').pop().toUpperCase(),
        runs: 0, balls: 0, fours: 0, sixes: 0, onStrike: false, form: 5, pressure: 5 },
    ],
    partnership: { runs: 0, balls: 0 },
    bowlers: {
      [`sm_bowler_${bowlerId}`]: {
        name: bowlerName, style: 'Unknown', overs: 0, maidens: 0, runs: 0, wickets: 0,
      },
    },
    toCome: bt.players
      .slice(2)   // first two are at the crease
      .map(p => p.name),
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

function _buildAiDefaults() {
  return {
    current     : { away: 50 },
    baseline    : { away: 50, over: 1 },
    projected   : { from: 250, to: 300 },
    newBallOver : 80,
    lastWicket  : { text: '', over: '0.0' },
    rr10        : 0,
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
  if (s.includes('t20'))      return 'T20';
  if (s.includes('odi') || s.includes('one day')) return 'ODI';
  if (s.includes('test') || s.includes('first class')) return 'Test Match';
  return 'Match';
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

// Export for browser / module use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SportMonksAdapter, normalizeSportMonksBall, normalizeSportMonksMatch, runTests };
}
