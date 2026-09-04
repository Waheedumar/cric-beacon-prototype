# Cric Beacon — Client Technical Validation

> Prepared for client presentation. One document that answers every question a technical
> stakeholder would ask before committing to build. Each section links to the full
> specification; this document is the index and the executive summary.

---

## Summary

Cric Beacon is a single-file cricket visualisation that renders a live match — 3D ball
flight, scorecard, win probability, AI insight, wagon wheel, and fantasy table — from a
normalised match data document. The prototype is production-shaped in its data contracts
and rendering architecture. The gap to a shipping product is a data feed integration, an
AI stack, and a mobile management layer. None of those gaps require changing how the
engine works.

---

## 1. Data Schema — What Every Field Means

### What was asked

What does each field in the match document do, and why is it shaped that way?

### Answer

Every field is documented in **[SCHEMA.md](SCHEMA.md)** — an annotated reference covering:

| Section | What it covers |
|---|---|
| Top-level identity | `id`, `label`, `format`, `stage` |
| `venue` | Static metadata for the venue panel (not used by the 3D engine) |
| `theme` | Visual config: grass colours, sky gradient, floodlight mode — the single seam that makes one engine render Lord's, Galle, MCG night, and Hambantota without any conditional logic |
| `teams` | Both squads, kit colours, cap colours, player stats |
| `battingTeam` | `'home'` or `'away'` — derives the bowling team as the inverse |
| `innings` | Current innings label, opponent total |
| `field` | Two fielder configurations (`standard` / `attacking`) in world coordinates |
| `perOverRuns` | Historical rollup for the stats panel bar chart |
| `ai` | Authored anchor values for probability, projected total, new-ball timing |
| `momentumHistory` | Six seeded snapshots for the momentum chart |
| `start` | The authored "now" state — score, wicket count, batsman/bowler positions at snapshot time |
| `overs` | The ball-by-ball feed — one `balls[]` array per over, each ball a 7-element tuple: `[runs, wicket, speed, length, line, dir, text]` |
| Lookup tables | `LENGTHS`, `LINES`, `SHOT_DIRS` — string fields mapped to world coordinates |
| Output contract | The delivery object produced by `buildFeed()`, consumed by every panel |

### Key insight

The `theme` block is the whole visual variation story. Swap it and the same engine
renders a different venue, different lighting, different team colours, without touching
any Three.js code. Hambantota (new match) proved this: one new match object, zero code
changes.

---

## 2. Architecture — How the Pieces Fit Together

### What was asked

Walk me through the architecture. Where does the data come from, how does it flow to
the panels, and where is the seam to a live data source?

### Answer

Full description in **[ARCHITECTURE.md](ARCHITECTURE.md)**.

The application is one `index.html` with three layers:

```
Data Layer          →  buildFeed(def)       →  3D Engine + UI
MOCK_MATCHES        →  deliveries[]         →  Three.js panels
(in-file JSON)                                scoreboard, stats,
                                              AI, wagon wheel,
                                              fantasy
```

**The defining property:** the engine never knows which match is loaded. It receives a
generic delivery object and renders whatever the data describes. Swap the source file,
swap the backend, swap the protocol — the renderer does not change.

The match selector (`loadMatch(key)`) is the *only* place the file distinguishes one
match from another. It rebuilds `deliveries[]`, resets the state pointer, re-applies
`theme` colours, and re-renders all panels — all with the same code path.

### Live data integration

```
Live data source  →  adapter  →  buildFeed(def)  →  deliveries[]  →  panels
                (normalises   (unchanged)        (unchanged)
                 provider shape
                 → internal doc)
```

The adapter is the only new piece. `buildFeed` and everything downstream are unchanged.
New balls extend the `overs[]` array; `buildFeed` is called once on load, and subsequent
balls append directly to `deliveries[]` as they arrive.

---

## 3. Multi-Match Support — Can It Handle More Than One Match at Once?

### What was asked

Does the engine support multiple simultaneous matches? Can I run four at once?

### Answer

The engine is naturally isolated: one match feeds one view. There is no global state
shared between matches. The engine code does not need to change — a management layer
would need to be built to:

- Instantiate multiple renderer contexts (one per active match view)
- Assign each a portion of the browser's rendering budget
- Handle cleanup when a user closes a match view
- Cap simultaneous views on mobile (recommended: 3–4)

Full details: [SCALABILITY.md §1](SCALABILITY.md#1-multiple-simultaneous-matches).

---

## 4. Live Ball-by-Ball Updates — How Does Real-Time Data Flow?

### What was asked

How does new delivery data arrive and get rendered? Walk me through the pipeline.

### Answer

The prototype loads a pre-authored feed. Moving to live means connecting a WebSocket or
polling endpoint from a cricket data provider to an adapter layer that converts each
incoming delivery into the exact shape `buildFeed` expects. The rendering side — 3D ball
flight, scorecard, win probability chart, wagon wheel — needs no changes, because those
panels are already pure functions of the current delivery object.

The work is entirely in the data plumbing. Full details: [SCALABILITY.md §2](SCALABILITY.md#2-ball-by-ball-live-updates).

---

## 5. AI Intelligence — Win Probability and Natural-Language Insights

### What was asked

The insight panel shows text. Is that real AI? What does the probability model actually
do? Where is the intelligence, and how would you replace the templates with something
genuine?

### Answer

Two independent services replace the current template layer:

**Probability service** (XGBoost / gradient-boosted trees, not an LLM):
- Per-ball classifier, one per format (Test / ODI / T20)
- ~60–80 features: runs, wickets, required rate, batting depth, bowler workload,
  field set, venue, etc.
- SHAP values give the "why" modal drivers for free
- Latency: 2–6 ms per inference
- Evaluation: Brier score ≤ 0.18 (Tests), ≤ 0.21 (T20); AUC ≥ 0.78

**LLM commentary service** (Claude Sonnet, open-weights fallback):
- Writes the insight card and why-modal lede in natural language
- Strict JSON input contract (~1.5 KB per call)
- Strict JSON output schema — no invented numbers, no invented names
- Cost: <$0.10 per innings at current Sonnet pricing
- Latency budget: P50 600 ms, P95 1.4 s, hard cap 2.5 s

Both services share the same state bundle built from the delivery object. Either can
fail in isolation and panels degrade gracefully. The engine never blocks on AI.

Full specification: [AI_INTELLIGENCE.md](AI_INTELLIGENCE.md). See also:
[SCALABILITY.md §5](SCALABILITY.md#5-live-ai-insights).

---

## 6. Fantasy Intelligence and Push Alerts

### What was asked

Can this power a fantasy scoring engine and push alerts to WhatsApp or Telegram?

### Answer

Yes. Fantasy scoring and push alerts sit downstream of the same match data the engine
already processes. A new data subscriber listens to the same delivery feed the panels
listen to, evaluates the relevant rules or calls the LLM, and routes output to the
appropriate channel. The data model does not change; only the consumers do.

This is the key architectural benefit of building around a clean data seam: new features
layer on without touching the core engine. Full details: [SCALABILITY.md §6](SCALABILITY.md#6-fantasy-intelligence-and-alert-systems-whatsapp--telegram).

---

## 7. Multi-Match and Mobile Scalability

### What was asked

What is the memory footprint? How does it behave on a budget Android phone? What breaks
at scale and what doesn't?

### Answer

**What the prototype already does for mobile:**

| Feature | Detail |
|---|---|
| DPR cap | `Math.min(devicePixelRatio, IS_SMALL ? 1.5 : 2)` |
| Antialias | Disabled below 900 px |
| Crowd instances | 900 (desktop) / 420 (mobile) — single `InstancedMesh` draw call |
| Tab-visibility pause | Loop exits early when tab is hidden |
| GPU preference | `powerPreference:'high-performance'` |

**Draw-call budget: ~26 total** (well within mobile GPU budget)

**Memory per instance: ~25–35 MB** (scene geometry, WebGL context, renderer JS heap)

**Quality tier ladder (production, not yet implemented):**

| Tier | Target | DPR | Crowd | Antialias |
|---|---|---|---|---|
| 1 | Flagship desktop/tablet | 2 | 900 | Yes |
| 2 | Mid-range phone (Snapdragon 7-series, A15+) | 1.5 | 420 | No |
| 3 | Budget Android (gaming score < 500) | 1.0 | 200 | No |
| 4 | Extreme constraint (old WebView, 1 GB RAM) | 1.0 | 0 | No |

**Simultaneous match views:** Chrome desktop allows ~16 WebGL contexts total. In practice,
a split-screen dashboard of 4 matches is the realistic ceiling. Thumbnail views use
1/4 resolution at 1 fps until tapped.

Full details: [SCALABILITY.md §7](SCALABILITY.md#7-multi-match-and-mobile-scalability).

---

## 8. Document Index

| Document | What it is | Audience |
|---|---|---|
| `TECHNICAL_VALIDATION.md` | This document — executive summary of all 7 questions | Client, product manager |
| `SCHEMA.md` | Annotated reference of every field in the match document | Engineers, data team |
| `ARCHITECTURE.md` | How the three layers fit together, the data seam, the live-feed integration plan | Engineers, technical lead |
| `AI_INTELLIGENCE.md` | Full specification for the probability model and LLM commentary service | Engineers, data scientists, product |
| `SCALABILITY.md` | Production scalability assessment — all 7 questions, with links to AI_INTELLIGENCE.md where relevant | Client, technical stakeholders |

---

## 9. What Is Proven vs. What Needs Building

| | Proven today | Needs building |
|---|---|---|
| Data schema | Full normalised match document with 4 different venues rendered correctly | Live feed adapter |
| 3D rendering | Runs on mobile Chrome and desktop, DPR cap and antialias toggle implemented | Quality-tier detection and auto-switching |
| Tab visibility | Loop pauses cleanly when tab is hidden | Per-instance management layer |
| Match selector | `loadMatch()` rebuilds scene from new data without page reload | Engine instance management for multiple simultaneous views |
| Ball trajectory | `CatmullRomCurve3` spline, ~26 draw calls, no shadow maps | WebGL context limit handling in multi-match dashboard |
| AI insight panel | Template-based commentary from real `delivery` and `state` objects | Probability model (XGBoost), LLM commentary service |
| Fantasy panel | Points table from real delivery data | Fantasy rule engine, push alert routing |
| Multi-user | Each browser session is fully independent | Server-side data fan-out |
| Mobile memory | ~25–35 MB per instance, 4–6 instances on 512 MB device | Memory pressure listener, tier downgrade on low RAM |

The rendering architecture and data contracts are production-ready. The remaining gap is
the infrastructure that sits around the engine: data ingestion, AI inference, device
capability detection, and instance management.

---

## 10. Next Steps

1. **Select a data provider** — Cricsheet (free, ball-by-ball), Stats Perform, or
   Sportradar. This determines the adapter shape.
2. **Agree on AI tone** — "knowledgeable fan on a phone" vs. broadcast-style voice.
   One prompt change; no engineering required.
3. **Mobile quality ladder** — implement the four-tier system from SCALABILITY.md §7.3.
   Estimated 1–2 weeks for a single engineer.
4. **Multi-instance management** — build the engine registry that tracks active
   renderers, throttles background tabs, and enforces the per-tab cap.
5. **Shadow-mode probability model** — deploy the XGBoost model alongside the templated
   deltas, log predictions for 2–4 weeks, then swap when shadow Brier matches held-out
   Brier within 0.01.
