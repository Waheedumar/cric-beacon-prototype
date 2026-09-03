# Cric Beacon — Architecture Overview

> Single-page, single-file cricket visualisation. Zero build step, zero backend,
> one `index.html`. Designed to be readable and modifiable by a non-developer
> stakeholder and to scale to live data without engine changes.

---

## 1. The 30,000-Foot View

Cric Beacon is one HTML file organised into three layers stacked on top of each other:

```
┌────────────────────────────────────────────────────────────────┐
│                       UI / PRESENTATION                         │
│   Scoreboard · Stats · AI Insight · Wagon Wheel · Fantasy Card  │
│   (all pure functions of the active delivery object)            │
└───────────────▲────────────────────────────────────────────────┘
                │ reads
                │
┌───────────────┴────────────────────────────────────────────────┐
│                      3D RENDERING ENGINE                         │
│   Three.js r160 (importmap, CDN) — one renderer, one scene       │
│   Driven entirely by the active delivery + state snapshot        │
│   No conditional logic on match identity — only on data          │
└───────────────▲────────────────────────────────────────────────┘
                │ reads
                │
┌───────────────┴────────────────────────────────────────────────┐
│                      DATA LAYER                                 │
│   MOCK_MATCHES (in-file) — one entry per match                   │
│   buildFeed(def) — walks the delivery feed and materialises      │
│   one state snapshot per ball, consumed by every panel above     │
└────────────────────────────────────────────────────────────────┘
```

The defining property: **the engine never knows which match is loaded**.
It receives a generic delivery object and renders whatever the data describes.
Swap the source file, swap the backend, swap the protocol — the renderer
does not change.

---

## 2. The Three Layers in Detail

### 2.1 Data Layer — `MOCK_MATCHES`

The data layer is an object map keyed by match id (`lords`, `galle`, `mcg`,
`hambantota`). Each value is the normalised match document described in
[Schemas](SCHEMA.md) — a structured blob covering venue, theme, both teams,
the ball-by-ball feed, and the AI anchor values.

Three shared constants sit just above `MOCK_MATCHES`:

- `STUMP_Z = 10.06` — the world-coordinate of the batting stumps.
- `FIELD_STANDARD` and `FIELD_ATTACKING` — the two fielder configurations
  the engine switches between based on whether a wicket has fallen.

A small set of lookup tables (`LENGTHS`, `LINES`, `SHOT_DIRS`) map the
string fields in each ball tuple to world coordinates.

### 2.2 Build Pipeline — `buildFeed(def)`

`buildFeed` is the only function in the file that touches raw match data.
It clones the `start` block as a working state, walks `overs[]` in order,
applies each ball tuple to that state (incrementing runs, wickets, balls,
strike, partnership), and pushes a complete per-ball snapshot into a
`deliveries[]` array.

The output of `buildFeed` is the single source of truth for every panel in
the prototype: the scoreboard, the 3D trajectory, the win-probability
chart, the wagon wheel, the AI insight card, and the fantasy points table
all read from the same array of delivery objects.

This function is the **data seam**. In production it stays unchanged —
the same function consumes the same delivery shape whether the data comes
from a static JSON file, a WebSocket feed, or a REST polling endpoint.

### 2.3 3D Engine + UI Layer

The Three.js renderer is initialised once with a fixed ground plane, a
stadium stand ring, and two small figures (striker + non-striker). On every
delivery change, the engine receives a delivery object, derives a ball
trajectory from the `length`, `line`, and `dir` fields, animates the ball,
and updates the score / commentary / panels in lockstep.

The UI panels (scoreboard, stats, AI, wagon wheel, fantasy) are all
positioned in fixed DOM slots in the page chrome. They are re-rendered
entirely on delivery change, which makes the data flow trivially
debuggable: open the browser console, log `deliveries[42]`, and you can
verify every panel is reading the value you expect.

---

## 3. The Match Selector — The Only Multi-Match Logic

The prototype supports four matches via a single HTML `<select>` element.
When the user picks a match, the code calls `loadMatch(key)`:

1. `buildFeed(MOCK_MATCHES[key])` rebuilds the deliveries array.
2. The state pointer resets to the upcoming over.
3. The 3D scene re-applies the new `theme` colours (sky, grass, pitch).
4. All panels re-render from the rebuilt feed.

This selector is the *only* place the file distinguishes one match from
another. There is no per-match code path. The four matches are visually
distinct (different colours, different ball-stories, different player
names) precisely because the data is distinct — exactly as it would be
for four matches arriving from a live data feed.

---

## 4. How a Live Feed Would Plug In

The current pipeline is:

```
MOCK_MATCHES  ──►  buildFeed(def)  ──►  deliveries[]  ──►  panels
```

A live-data integration would add a single layer in front of `buildFeed`:

```
Live data source  ──►  adapter  ──►  buildFeed(def)  ──►  deliveries[]  ──►  panels
                    (provider shape ─►
                     internal match doc)
```

- The adapter normalises whatever the provider sends into the same
  match-document shape the engine already understands.
- `buildFeed` and everything downstream is unchanged.
- New balls arriving in real time simply extend the `overs[]` array —
  `buildFeed` is called once on initial load, and subsequent balls can
  be appended to `deliveries[]` directly as they arrive.

This is the smallest possible change for the largest possible result.

---

## 5. Why Single-File Matters for the Prototype

The deliberate choice to ship one HTML file with no build step is not a
limitation — it is a feature for this stage of the project:

- The client can open the file locally, on a phone, in an email, or
  deploy it to any static host with zero configuration.
- Any developer (or non-developer) can read the entire prototype end to
  end in one sitting, with no module system, no bundler, no `node_modules`.
- The 3D engine, the UI, and the data layer are all right there on the
  same page — no context switching between files.
- A production build, when the time comes, can be a clean reorganisation
  of the same code into modules. The structure of the data is what
  matters, and that is already production-shaped.

---

## 6. Files in This Repository

| File | Purpose |
|---|---|
| `index.html` | The entire prototype — 3D engine, UI, data layer |
| `matches/match-lords.json` | Standalone export of the Lord's match dataset |
| `matches/match-galle.json` | Standalone export of the Galle match dataset |
| `matches/match-mcg.json` | Standalone export of the MCG match dataset |
| `matches/match-hambantota.json` | Standalone export of the Hambantota match dataset |
| `SCHEMA.md` | Annotated reference of every field in the match document |
| `SCALABILITY.md` | Production-scale architectural assessment for the client |
| `ARCHITECTURE.md` | This document — how the prototype is structured |
| `.gitignore` | Excludes duplicate engine files and local helper scripts |

The four JSON files in `matches/` are intentionally portable. They can be
served from any static file host, fetched by a mobile app, or piped into
a different visualisation engine without modification — they are pure data,
not code.
