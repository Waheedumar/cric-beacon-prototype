# Cric Beacon — Match Data Schema
## Annotated Reference: AUS v NZ · MCG (Test Match)

This document annotates every field in the normalised match document that drives the
Cric Beacon 3D engine and all UI panels. The schema is the single contract between
the data layer and the rendering layer: swap this document for a live API response and
the engine continues to work without modification.

---

## Top-Level Match Identity

```js
{
  // Short machine-readable identifier. Must be unique across all matches.
  // Used as the key in MOCK_MATCHES / the API response object and as the
  // value of the match-select dropdown. No spaces or special characters.
  id: 'mcg',

  // Human-readable label shown in the dropdown and scoreboard header.
  label: 'AUS v NZ · MCG',

  // Match format — drives the scoreboard format badge.
  format: 'Test Match',

  // Contextual stage label shown in the day-tag strip.
  stage: 'Day 2 — Session 3',
```

---

## venue

Static match metadata rendered in the venue panel. Not used by the 3D engine —
that is driven by the `theme` block instead.

```js
  venue: {
    name: 'Melbourne Cricket Ground',        // Full venue name
    city: 'Melbourne, Australia',           // City / country for the panel
    pitch: 'Hard, true bounce',            // Pitch description — informational only
    weather: 'Clear, floodlit',             // Weather — feeds the AI insight "why" panel
    temp: '21°C',                          // Temperature string — informational
    wind: '18 km/h',                       // Wind speed — feeds AI insight
    boundary: '71 m × 78 m',              // Boundary dimensions — informational
    floodlights: true                      // Whether night mode is active (→ theme.night)
  },
```

---

## theme

Visual configuration for the entire 3D scene. Every colour is passed directly to
Three.js material `color.set()` calls — the engine never hard-codes a colour.

```js
  theme: {
    grassA: 0x2A6E45,    // Primary grass ring colour (alternate rings)
    grassB: 0x225D3B,    // Secondary grass ring colour
    outfield: 0x1F5636,  // Outfield colour beyond the boundary rope
    pitch: 0xBFA477,     // Pitch strip colour
    skyTop: 0x040911,    // Sky gradient top (zenith)
    skyBot: 0x0B1826,    // Sky gradient bottom (horizon)
    stand: 0x11171C,     // Stadium stand / upper-bowl colour
    seat: 0x1C262C,      // Seat / lower-bowl colour
    night: true          // Boolean: night-match mode (enables floodlight glow, darker sky)
  },
```

> **Why this exists:** The same engine renders Lord's (bright, cloudy), Galle (bright,
> tropical), and MCG night (floodlit, dark sky). `theme` is the single seam that makes
> this possible — no conditional logic in the 3D code.

---

## teams

Both teams are defined here with their visual identity (kit colours, flag, short name)
and a full players roster used by the player intelligence panel.

```js
  teams: {
    home: {                            // The team currently batting
      key: 'aus',
      name: 'AUSTRALIA',
      short: 'AUS',
      flag: '🇦🇺',
      kit: 0x0F5E3D,                 // Outfield player kit colour (Three.js hex)
      cap: 0xE0B93A,                 // Cap / helmet colour
      players: [
        {
          id: 'a1',                   // Unique within this team
          name: 'Usman Khawaja',
          role: 'Opener',             // Informational label for the panel
          // x: horizontal position on the field (metres; positive = leg side)
          // z: distance down the ground (positive = toward bowler's end)
          // These are used only by the Player Intelligence panel (figure annotation),
          // not by the 3D engine (which uses live batting positions from `start.batsmen`)
          pos: { x: 0.62, z: 10.61 },  // STUMP_Z (10.06) + 0.55 = striker's crease
          stats: {                     // Career / tournament stats for the panel
            runs: 42, balls: 88, fours: 5, sixes: 0, sr: 47.7
          }
        },
        // ... 4 more batters
      ]
    },
    away: {                            // The bowling team
      key: 'nz',
      name: 'NEW ZEALAND',
      short: 'NZ',
      flag: '🇳🇿',
      kit: 0x121820,
      cap: 0x2B3540,
      players: [
        // Batsmen replaced by bowlers once they come to the crease.
        // The `role` field distinguishes types for the panel.
        { id: 'n1', name: 'Matt Henry', role: 'Fast Bowler',
          pos: { x: 0.35, z: -12.26 },   // STUMP_Z − 2.2 = bowler's run-up mark
          stats: { overs: 29, maidens: 7, runs: 91, wickets: 3, econ: 3.14 }
        },
        // ... 2 more bowlers
      ]
    }
  },
```

---

## battingTeam

```js
  // Must be 'home' or 'away'. The engine derives the bowling team as the inverse.
  // Controls which `teams.home` / `teams.away` block is used for kit colours
  // in the 3D scene and which team name appears in the batting position.
  battingTeam: 'home',
```

---

## innings

```js
  innings: {
    // Human-readable label for the scoreboard header
    current: 'Australia 1st innings',

    // The opponent's completed total, shown in the vs-rule scoreboard row.
    // This is the score the batting team is trying to match / beat.
    firstInnings: {
      team: 'nz',                      // The `key` of the bowling team from `teams`
      total: 289                       // Their runs — informational in Test, critical in T20/ODI
    }
  },
```

---

## field

Defines two fielder configurations. The engine selects `field.standard` when no wickets
have fallen in the delivery window, and switches to `field.attacking` when a wicket
has been taken (signalling the bowling team is in a catching mindset).

Both arrays use world coordinates in metres relative to the centre of the pitch:
`x` = horizontal (positive = leg side), `z` = down the ground (positive = toward
the batter's end). `STUMP_Z = 10.06` is the world-coordinate of the batting stumps.

```js
  field: {
    // Default defensive catching positions — standard Test cricket field
    standard: [
      { id: 'wk',  name: 'Keeper',     x:  0.0,  z: 14.6 },
      { id: 'sl1', name: 'Slip',      x: -2.3,  z: 14.0 },
      { id: 'gly', name: 'Gully',      x: -5.6,  z: 12.6 },
      { id: 'pnt', name: 'Point',     x:-24.0,  z:  7.0 },
      { id: 'cov', name: 'Cover',     x:-27.0,  z: -6.0 },
      { id: 'mdo', name: 'Mid-off',   x:-13.0,  z:-22.0 },
      { id: 'mdn', name: 'Mid-on',    x: 11.5,  z:-23.0 },
      { id: 'mwk', name: 'Midwicket', x: 26.0,  z: -5.0 },
      { id: 'sql', name: 'Square leg',x: 24.0,  z: 10.0 },
      { id: 'fnl', name: 'Fine leg',  x: 26.0,  z: 54.0 },
      { id: 'thm', name: 'Third man', x:-28.0,  z: 52.0 }
    ],

    // Catching ring brought in — used after a wicket in the window
    attacking: [
      { id: 'sl1', name: 'Slip',      x: -2.1,  z: 12.9 },
      { id: 'gly', name: '2nd Slip',  x: -3.9,  z: 12.7 },
      // ... catchers pushed closer, boundary riders removed
    ]
  },
```

---

## perOverRuns

Array of runs scored per over for each team — one entry per over bowled. Used by the
over-by-over bar chart in the Match Stats panel to show the scoring tempo across the
innings at a glance.

```js
  perOverRuns: {
    // Each array has one integer entry per over. Index 0 = over 1.
    // Values are cumulative across the array — a new match would have
    // a fresh array growing ball by ball from a live feed.
    home: [3, 2, 4, 1, 3, 5, 2, ...],   // Batting team's runs per over
    away: [1, 2, 3, 4, 1, 2, 3, ...]    // Bowling team's runs per over (for comparison)
  },
```

> **Why this exists separately from `start` / `overs`:** `perOverRuns` is a historical
> rollup for the stats panel — it covers the entire innings. `start` and `overs` are
> the current-session state + delivery feed. They serve different panels and different
> temporal windows.

---

## ai

Configuration and authored anchor values for all AI / analytical panels:
win probability, projected total, run-rate context, and the "Why did the probability
change?" explanation modal.

```js
  ai: {
    // The win-probability curve is anchored so the LAST PLAYED delivery in the
    // delivery feed equals this value. The curve is generated by accumulating
    // per-ball deltas (dot = +0.32, boundary = −0.62, wicket = +8.40, etc.),
    // then offset so the final point lands here.
    current: { away: 20 },          // "Now" probability for the bowling team (%)

    // Value ~10 overs ago — used by the explanation modal to show the delta
    // between "before" and "after" in the driver breakdown.
    baseline: { away: 26, over: 113 },

    // The AI insight panel shows a projected total range.
    // In the prototype these are authored; in production they come from
    // a model that extrapolates the scoring rate to 50 or 90 overs.
    projected: { from: 455, to: 471 },

    // Over number at which the second new ball becomes available.
    // The probability model adds a spike 2 overs before this point,
    // as the historical data shows wickets spike when the new ball is taken.
    newBallOver: 120,

    // Rolling 10-over run rate — used in the AI insight text generation.
    rr10: 3.85,

    // The last dismissal — feeds the explanation modal's "last wicket" driver.
    lastWicket: {
      text: 'Travis Head c Blundell b Henry 61',   // Full dismissal text
      over: '104.5'                                 // Dismissal over.ball
    }
  },
```

---

## momentumHistory

Six snapshot entries (one per over) used to seed the momentum chart before the
active over window begins. Additional entries are appended at runtime from the
`overMomentum` field in each completed over.

```js
  momentumHistory: [
    { over: 113, away: 26, rr: 3.6, w: 0, p: 38 },
    // over  : the over number this snapshot represents
    // away  : bowling team's win probability at end of this over (%)
    // rr    : run rate across this over (runs per over)
    // w     : wickets taken in this over
    // p     : pressure index 0–100 (subjective; drives the pressure label in stats)
    { over: 114, away: 25, rr: 3.7, w: 0, p: 36 },
    // ...
  ],
```

---

## start

The authored "now" state — the score, wicket count, and batsman/bowler positions at
the moment the match snapshot was captured. This is the seed state that `buildFeed()`
clones and then applies each delivery to, producing a full per-ball state snapshot.

```js
  start: {
    runs: 399,            // Total runs scored by the batting team so far
    wickets: 7,            // Wickets fallen
    over: 118,             // Current over number
    ball: 6,              // Current ball within the over (1–6)

    batsmen: [
      {
        name: 'Steve Smith', short: 'SMITH',
        runs: 113, balls: 198, fours: 12, sixes: 0,
        onStrike: true,    // True for the batter facing this ball
        form: 9,           // 1–10 scale, derived from strike rate (sr/9)
        pressure: 4        // 1–10 scale, inverted strike rate (10 − sr/11)
      },
      { name: 'Alex Carey', short: 'CAREY', runs: 32, balls: 44, ...,
        onStrike: false }
    ],

    partnership: { runs: 58, balls: 79 },

    bowlers: {
      // Keys here (e.g. 'henry') MUST match the `bowler:` field in `overs[]`
      henry: {
        name: 'Matt Henry',
        style: 'Right-arm fast-medium',
        overs: 29, maidens: 7, runs: 91, wickets: 3
      },
      santner: { name: 'Mitchell Santner', style: 'Left-arm orthodox',
        overs: 33, maidens: 9, runs: 96, wickets: 2 }
    },

    // Batters not yet at the crease — consumed one at a time as wickets fall.
    // buildFeed() shifts() from this array on each wicket.
    toCome: ['Pat Cummins', 'Mitchell Starc', 'Nathan Lyon']
  },
```

---

## overs (Delivery Feed)

The heart of the data layer — the authoritative ball-by-ball record. Each entry
represents one over; `balls[]` is the ordered array of individual deliveries.

```js
  overs: [
    { over: 119, bowler: 'henry', upcoming: false, balls: [
      // Each ball is a 7-element tuple:
      // [0] runs       — runs scored off this ball (0–6)
      // [1] wicket    — null, or the dismissal text string (e.g. 'c Latham b Santner 33')
      // [2] speed      — delivery speed in km/h (int)
      // [3] length     — 'yorker' | 'full' | 'good' | 'short' | 'bouncer'
      //                  (maps to world Z coordinate + height via LENGTHS table)
      // [4] line       — 'off' | 'fourth' | 'middle' | 'leg' | 'body' | 'wide'
      //                  (maps to world X coordinate via LINES table)
      // [5] dir        — null, or shot direction key from SHOT_DIRS
      //                  ('cover', 'midwicket', 'slip', etc.)
      //                  Controls: wagon wheel arc, shot trajectory, fielder positioning
      // [6] text       — Natural-language commentary sentence for the panel
      [1, null, 138, 'good', 'off', 'cover',
       'Steered to cover for a single under lights.'],
      [0, null, 141, 'good', 'fourth', null,
       'Left alone, shaping away.'],
      [4, null, 136, 'full', 'middle', 'straight',
       'FOUR — driven straight back past the bowler.'],
      [0, null, 143, 'short', 'body', null,
       'Short and quick, evaded at the last moment.'],
      [2, null, 139, 'good', 'leg', 'midwicket',
       'Clipped off the toes for two.'],
      [1, null, 140, 'good', 'middle', 'mid-on',
       'Pushed to mid-on to retain strike.']
    ], momentum: { away: 19, rr: 4.2, w: 0, p: 26 } },

    // The over marked `upcoming: true` is the next over to be bowled.
    // The timeline auto-stops here during playback and this is the ball
    // the ball-trajectory animation renders first on load.
    { over: 120, bowler: 'santner', upcoming: true, balls: [
      [0, null,  89, 'good', 'off', null,
       'Defended off the back foot.'],
      [1, null,  87, 'full', 'middle', 'long-on',
       'Driven to long-on for one.'],
      [0, 'Alex Carey c Latham b Santner 33', 85, 'good', 'off', 'slip',
       'WICKET — drawn forward, edged to slip. Santner strikes with the old ball.'],
      [0, null,  88, 'good', 'middle', null,
       'The new man defends the hat-trick ball.'],
      [1, null,  90, 'good', 'leg', 'square-leg',
       'Worked away for one.'],
      [4, null,  86, 'short', 'leg', 'square-leg',
       'FOUR — rocked back and swept powerfully.']
    ], momentum: { away: 33, rr: 4.1, w: 1, p: 48 } }
  ]
}
```

---

## Shared Lookup Tables

These constants are defined at the top of the data layer (before `MOCK_MATCHES`)
and are used by `buildFeed()` and the 3D trajectory engine — they are not
part of the per-match document but are referenced by it.

### LENGTHS

Maps the string `length` value from each ball tuple to a world-coordinate
bounce position (`z`) and a rise height (`rise`) used to draw the delivery arc.

```js
const LENGTHS = {
  yorker : { z: 9.30, rise: 0.30, label: 'Yorker' },
  full   : { z: 7.30, rise: 0.52, label: 'Full' },
  good   : { z: 5.00, rise: 0.80, label: 'Good Length' },
  short  : { z: 2.30, rise: 1.28, label: 'Short of a Length' },
  bouncer: { z: 0.60, rise: 1.80, label: 'Bouncer' }
};
// STUMP_Z = 10.06;  bowler release z ≈ −9.4
```

### LINES

Maps the string `line` value from each ball tuple to a world x-coordinate.

```js
const LINES = {
  off:    -0.42,   // Off side, good length
  fourth: -0.72,   // Fourth stump / just outside off
  middle:  0.00,   // Middle stump
  leg:     0.40,   // Leg side
  body:    0.12,   // Bouncer directed at the body
  wide:   -1.05    // Wide of the crease
};
```

### SHOT_DIRS

Maps shot direction keys (from ball tuple index 5) to world x/z coordinates.
Used by the wagon wheel panel and the post-delivery shot arc in the 3D scene.

```js
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
```

---

## Output: Delivery Object (produced by buildFeed)

`buildFeed()` transforms the authored `overs[]` into a `deliveries[]` array.
Every UI panel reads from these delivery objects, never directly from the raw
match document.

| Field | Source | Used By |
|---|---|---|
| `over`, `ballNo` | `ov.over`, tuple index | Score strip, HUD |
| `speed`, `length`, `line`, `dir` | Tuple indices 2–5 | 3D trajectory, delivery card |
| `runs`, `wicket`, `result`, `chip` | Tuple index 0, 1 | Score, momentum, chip strip |
| `text` | Tuple index 6 | Commentary panel |
| `strikerName`, `bowlerName` | Derived from `state.batsmen`, `state.bowlers` | Labels, AI insight |
| `state` | Seeded from `start`, mutated per delivery | All panels — the single source of truth |
| `fieldSet` | `'standard'` or `'attacking'` (wicket count > 0) | Fielder repositioning |
| `winProb`, `winProbPrev` | Computed from delta accumulation | Win probability panel |
| `overMomentum` | Copied from `ov.momentum` on ball 6 | Momentum chart |
