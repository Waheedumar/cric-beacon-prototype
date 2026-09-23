# Cric Beacon — AI Intelligence Architecture

> Item 5 of the client technical validation. Replaces and extends the single
> paragraph in `SCALABILITY.md §5`. Covers both halves of "Live AI Insights":
> the win-probability model that sits underneath every probability-bearing
> panel, and the LLM commentary layer that writes the insight card and the
> "why" modal in natural language.

---

## 0. Where the Prototype Stands Today

The prototype has two AI-shaped subsystems, both of which are **presentations of
a data contract, not real intelligence**. They are deliberately easy to swap.

| Today | Where it lives | What is real | What is stand-in |
|---|---|---|---|
| Win-probability curve per ball | `buildFeed()`'s `deltaFor` function (line ~1332) and `updateWinProbability()` (line ~2195) | Curve anchored to the authored `ai.current.away` endpoint, clamped to 4–96% | Per-ball deltas are hand-coded: `dot = +0.32`, `boundary = −0.62`, `wicket = +8.40`, plus a +1.60 nudge two overs before `ai.newBallOver`. No learned model, no features beyond runs/wicket/new-ball. |
| Insight card text | `updateAIInsight()` (line ~2208) | Reads from real `delivery` and `state` objects; uses correct team names, correct projected total, correct new-ball timing | Four `if/else if` branches pick a templated string. No reasoning, no per-bowler or per-venue nuance, no reading of shot direction or length. |
| "Why" modal | `openWhy()` (line ~2488) | Correct before/after numbers, correct driver list, correct SHAP framing in the footer | Driver descriptions are templated. "Wicket" and "last wicket" are the only differentiating branches. |

The data contract is already production-shaped. The intelligence sitting
behind that contract is the part that needs replacing. The rest of this
document specifies *what* replaces it, *where* the swap happens, and *how* the
new pieces are evaluated before they ship.

---

## 1. Architectural Overview

```
                       ┌──────────────────────────────┐
                       │  Live delivery feed (HTTP /  │
                       │  WebSocket)                  │
                       └───────────────┬──────────────┘
                                       │ normalised into the
                                       │ same match document
                                       │ the engine already uses
                                       ▼
                       ┌──────────────────────────────┐
                       │  buildFeed(def)              │
                       │  → deliveries[] (unchanged)  │
                       └───────────────┬──────────────┘
                                       │ per-ball snapshot
              ┌────────────────────────┼────────────────────────┐
              ▼                        ▼                        ▼
   ┌────────────────────┐  ┌────────────────────────┐  ┌────────────────────┐
   │  Probability       │  │  LLM commentary        │  │  Player            │
   │  service           │  │  service               │  │  intelligence      │
   │                    │  │                        │  │  service           │
   │  XGBoost / GBM     │  │  Claude (primary) or   │  │  XGBoost + LLM     │
   │  classifier,       │  │  smaller model as      │  │  explanations      │
   │  per-format        │  │  fallback              │  │  (out of scope     │
   │                    │  │                        │  │  for this doc)     │
   └─────────┬──────────┘  └──────────┬─────────────┘  └────────────────────┘
             │ per-ball P(away win)   │ insight text + why-modal text
             │ + SHAP contributions   │
             ▼                        ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  Engine consumers (unchanged):                               │
   │    probPak / probEng / barPak / barEng / probDelta           │
   │    aiInsight (typing text)                                   │
   │    aiWhy (bullet list)                                       │
   │    whyModal (driver cards)                                   │
   └──────────────────────────────────────────────────────────────┘
```

Two independent services. They share a **state bundle** built from the same
delivery object the engine already produces, but neither has to wait for the
other. Either can fail in isolation and the panels degrade gracefully.

---

## 2. The Probability Service

### 2.1 What It Replaces

`buildFeed()`'s `deltaFor` is an additive accumulator with a global offset
chosen to hit an authored endpoint. The production service replaces the entire
accumulator with a **per-ball classifier** that produces an absolute win
probability and an additive decomposition into feature contributions. Three
concrete failures of the current system the new model fixes:

- **It only knows the end.** The hand-coded deltas are anchored to a single
  authored value. If the live feed were to start in the middle of a session,
  there is no principled way to set the curve's starting point.
- **It only knows four features.** Runs scored, wicket yes/no, ball number,
  and the new-ball timer. Real win probability depends on batting depth, bowler
  workload, the specific batter/bowler matchup, the venue, the format, the
  required rate, the wickets-in-hand at the death, the pitch behaviour, the
  light, and a dozen other things.
- **Its drift is constant.** `+0.32` per dot is the same drift in over 5 as
  in over 45. Win-probability sensitivity to a dot ball at 5–0 is essentially
  zero; at 45–5 it is enormous.

### 2.2 Model Choice — Gradient-Boosted Trees, Not an LLM

The win-probability model is **not** an LLM. LLMs are slow, expensive, and
uncalibrated for this. A gradient-boosted tree classifier (XGBoost or
LightGBM) is the right tool:

- **Latency** — 2–6ms per inference on a single modern CPU core, even with
  full SHAP. Live commentary needs a result back before the ball animation
  finishes (~1.2s).
- **Calibration** — gradient-boosted trees calibrate cleanly with isotonic
  regression. The chart needs probabilities, not just ranks.
- **Decomposability** — SHAP values come for free with tree models, which
  feeds the "why" modal without a second inference.
- **Cost** — fractions of a cent per inference. A live match with 360 balls
  and per-ball probability updates costs essentially nothing.

The model is **per-format**: one for Tests, one for ODIs, one for T20s. They
share features but train on disjoint data — an ODI's middle-overs risk
profile is fundamentally different from a Test's.

### 2.3 Feature Set

Features are computed entirely from data the engine already has in
`state` / `delivery` / `MD`, plus a small derived block:

**Match-state features (per ball)**
- `runs`, `wickets`, `overs_completed` (fractional)
- `runs_required`, `balls_remaining`, `required_run_rate`, `current_run_rate`
- `rrr_vs_crr` (required minus current)
- `partnership_runs`, `partnership_balls`
- `striker_runs`, `striker_balls`, `striker_sr`
- `nonstriker_runs`, `nonstriker_balls`
- `batter_at_crease_count` (how many wickets remain in hand)
- `bowler_overs`, `bowler_maidens`, `bowler_runs`, `bowler_wickets`,
  `bowler_econ`

**Bowling / field features**
- `bowler_workload` (overs bowled in the last 10 / 20 overs — proxies fatigue)
- `new_ball_overs_to_availability`
- `length`, `line`, `speed` of the just-completed ball (categorical-encoded)
- `shot_direction` (one-hot from `SHOT_DIRS`)
- Field-set indicator (standard / attacking, derived from `fieldSet`)

**Venue and context**
- `venue_id` (categorical, target-encoded)
- `format` (one-hot: Test / ODI / T20)
- `innings_number`, `batting_team`, `bowling_team`
- `day_night_flag` (from `theme.night`)
- `floodlights` (boolean)

**Engineered**
- `dot_in_last_12_balls`, `boundary_in_last_12_balls`, `wicket_in_last_24_balls`
- `runs_in_last_3_overs`, `runs_in_last_10_overs`
- `pressure_index` (current prototype uses an authored 0–100; the production
  version derives it from a small sub-model)

Roughly 60–80 features. All computable at the moment a delivery completes.

### 2.4 Output

For every ball:
- `winProb.away` and `winProb.home` — floats, sum to 1, clamped to [0.01, 0.99]
- `winProbDelta` — the per-ball movement in percentage points
- `contributions` — array of `{feature, value, shap}` covering the top 5–8
  drivers for the "why" modal

The "curve is anchored to a fixed endpoint" behaviour disappears entirely.
The new model is anchored to **truth at the moment of training** — every ball
is a training row, the label is the eventual match outcome — and produces a
probable path through the innings without any authored endpoint.

### 2.5 Per-Ball Training Data

Each ball is one row. The label is `1` if the batting team **at that ball**
ended up winning, `0` otherwise. For a Test this means thousands of completed
innings — for T20s it means tens of thousands of completed matches. Ball-by-ball
cricket data is the easy part: providers like Cricsheet, Stats Perform, and
Sportradar all carry it at the granularity the model needs. The labelling
key is to fix the label **at the time of the ball**, not retroactively — the
model learns what the situation looked like *from inside that moment*, not
the eventual outcome coloured by hindsight.

### 2.6 Evaluation

A held-out test set of completed matches, with metrics chosen to match the
use of the probability:

- **Brier score** — overall calibration, the headline metric. Target
  ≤ 0.18 for Tests, ≤ 0.21 for T20s (T20 is intrinsically harder).
- **Log loss** — confidence-weighted calibration, second-line metric.
- **AUC** — must be ≥ 0.78. Below this the chart is not meaningfully
  informative; above 0.85 the model is at the limit of what's recoverable
  from public data.
- **Calibration plot** — binned predicted vs. actual win rate, 20 bins,
  diagonal-fitted. The chart will be shown to users; it must not lie.
- **Per-format error breakdown** — a model that is great at Tests and bad
  at T20s is shipped as Tests-only. We do not ship a worse model to cover
  more formats.

A **shadow mode** runs the model alongside the live system for 2–4 weeks
of real matches. The shadow's predictions are logged and scored but not
shown. We ship the swap only when shadow-mode Brier matches the
held-out test-set Brier within 0.01.

---

## 3. The LLM Commentary Service

### 3.1 What It Replaces

`updateAIInsight()` and `openWhy()` are two separate template-string
generators. They become a **single LLM call** per insight surface, called
when the panel is rendered, with a strict JSON input contract and a strict
JSON output schema.

Two insight surfaces, two call shapes:

- **Insight card** (4–7 sentences) — what just happened and why it matters.
  Drives the typewriter-typed line.
- **Why modal** (1 lede sentence + 3–5 driver cards) — the structured
  explanation of the probability move. Driven by SHAP values from the
  probability service; the LLM only writes the prose around them.

The LLM does **not** invent numbers. All numbers in the output (probabilities,
projected totals, run rates) are computed elsewhere and passed in as inputs.

### 3.2 Model Choice — Claude Sonnet (Primary) with a Smaller Fallback

**Primary:** Anthropic Claude Sonnet, latest. Reasons:
- Strong instruction-following on structured-JSON output.
- Cost-effective at the throughput we need (one insight every ball, ~360
  calls per innings, plus background "why" precomputes).
- Tool-use for the why-modal where we want guaranteed driver-card structure.

**Fallback:** a small open-weights model (e.g. Llama-3.1-8B-Instruct) on our
own infra, gated behind a degraded-mode banner. The fallback runs in two
circumstances: (1) the primary is unavailable for >2 seconds, (2) we are
showing the insight in a low-cost market or a free tier where the per-ball
LLM cost is not yet justified. The fallback uses the same prompt and
schema; outputs are visibly simpler but never wrong.

### 3.3 Input Contract

The LLM call receives a JSON object with everything needed to write both
surfaces in one round trip:

```json
{
  "match": {
    "id": "mcg",
    "format": "Test",
    "venue": "Melbourne Cricket Ground",
    "innings_label": "Australia 1st innings",
    "batting_team": "Australia",
    "bowling_team": "New Zealand"
  },
  "current": {
    "score": "399/7",
    "over": 119,
    "ball": 4,
    "rr": 3.35,
    "rrr": null,
    "partnership": "58 (79)",
    "striker": "Steve Smith 113* (198)",
    "non_striker": "Alex Carey 32 (44)",
    "bowler": "Matt Henry 3/91 (29)"
  },
  "just_happened": {
    "runs": 1,
    "wicket": null,
    "length": "good",
    "line": "off",
    "speed_kph": 138,
    "shot_direction": "cover",
    "commentary": "Steered to cover for a single under lights."
  },
  "probability": {
    "home": 0.78,
    "away": 0.22,
    "delta_pp": -0.4,
    "shap_top5": [
      { "feature": "partnership_stability", "value": 0.62, "contribution_pp": -1.8 },
      { "feature": "batter_in_form",        "value": 0.74, "contribution_pp": -0.6 },
      { "feature": "bowler_econ_above_avg",  "value": 1,   "contribution_pp": +0.3 }
    ],
    "projected_first_innings": { "from": 455, "to": 471 }
  },
  "context": {
    "weather": "Clear, floodlit",
    "wind": "18 km/h",
    "new_ball_in_overs": 1,
    "last_wicket": { "text": "Travis Head c Blundell b Henry 61", "over": "104.5" },
    "pressure_index": 26,
    "rolling_10_over_rr": 3.85
  }
}
```

Total payload: ~1.5 KB. Easily fits in a single prompt.

### 3.4 Output Schema

Strict JSON, parsed and validated before render. If validation fails we
fall back to a templated version of the same data — never a free-form string.

**Insight card response:**
```json
{
  "insight": "Smith works a single to cover to keep strike. The Smith-Carey partnership is now 58 and has quietly taken the sting out of the new-ball spell; the projected first-innings platform moves back toward 455. New Zealand's only realistic path back into this session is the second new ball, which is one over away."
}
```

**Why-modal response:**
```json
{
  "lede": "Smith works a single to cover — a low-leverage ball that nonetheless nudges the model slightly back toward Australia because the partnership continues to absorb new-ball pressure.",
  "drivers": [
    { "icon": "🤝", "title": "Partnership stability", "body": "58 off 79 balls — the Smith-Carey pair is now in the top decile of Test partnerships at this matchup stage.", "weight": "−1.8pp" },
    { "icon": "🏏", "title": "Striker in form",         "body": "Smith's scoring rate against right-arm pace this innings is 58, well above his career 44.", "weight": "−0.6pp" },
    { "icon": "🔴", "title": "Second new ball imminent", "body": "Available next over. Historically the highest-wicket phase of a Test innings.", "weight": "rising" }
  ]
}
```

The model is **forbidden** from inventing icons beyond a small allowlist
(`🎯 🤝 🏏 ⏱️ 🔴 📉 🛡️ 🧊 🔥 ⚡`), forbidden from inventing numbers not
in the input, and forbidden from referencing players or bowlers not named
in the input.

### 3.5 Prompt Structure

A small system prompt sets the persona, the constraints, and the JSON
schema. The bulk of the call is the JSON input above plus a brief
task instruction:

> "You are Cric Beacon's AI cricket analyst. Write for a knowledgeable fan
> watching the match on a mobile screen. Two short paragraphs max. The
> numbers in the input are authoritative — never invent, round, or modify
> them. Respond with the JSON schema below. If the situation is genuinely
> uninteresting, write that explicitly; do not pad."

The schema, allowlist, and instructions are versioned alongside the model
call. A change to the schema bumps a `prompt_version` field in the
request, so we can A/B prompt variants against each other on the same
live match.

### 3.6 Latency Budget

Live cricket needs insights to land before the next ball — there is
typically ~45 seconds of dead time between deliveries. The latency budget:

- **P50:** 600ms (insight card), 800ms (why-modal)
- **P95:** 1.4s (insight card), 1.8s (why-modal)
- **Hard cap:** 2.5s — beyond this, render the templated fallback and
  show a tiny "AI" badge in muted grey rather than the usual colour.

The why-modal is a click-driven surface, so its latency is less
time-critical; it is precomputed on every delivery and cached locally
in the panel state, replaced lazily if a fresh call lands before the
user opens the modal.

### 3.7 Caching and Pre-Generation

The insight card is rendered on every ball change — once per delivery,
~360 times per innings. Most balls are routine. Two caching layers:

1. **Per-state hash cache** — the input JSON is hashed; identical
   situations (same score, same partnership, same ball outcome) hit a
   30-second cache. Same ball, same insight, no duplicate LLM call.
2. **Background pre-generation** — the next 3–5 insights are precomputed
   as the user reaches the last over, sitting in a queue ready to render
   on the next ball change. The user never waits on the model.

The why-modal is generated speculatively on every wicket and on every
probability move of >2pp. It is not generated on routine balls.

### 3.8 Cost

Sonnet-class pricing, with the per-ball insight plus a small fraction
of why-modals:

- ~360 insight calls per innings × 1.5 KB in / 250 B out ≈ ~0.6 M tokens
  in, ~0.09 M tokens out per innings
- ~25 why-modal calls per innings (wickets + large moves) × ~3 KB in / 1 KB
  out ≈ ~0.08 M tokens in, ~0.025 M tokens out per innings

Total: well under $0.10 per innings at current Sonnet pricing. A full Test
day with 90 overs of input, 90 minutes of live = a few cents. A live T20
match from start to finish ≈ a few cents. Operating cost is not a
constraint.

### 3.9 Quality / Safety Rails

Five concrete rules that the LLM prompt and the response validator both
enforce:

1. **No fabricated numbers.** Every number in the output must appear
   verbatim in the input. The validator strips and re-checks numerics.
2. **No fabricated names.** Player and bowler names in the output must
   appear in the input's `current` or `just_happened` blocks.
3. **No facts beyond input.** No claims about pitch behaviour, crowd,
   weather history, or past matches unless supplied in the input's
   `context` block.
4. **No betting / gambling language.** Phrases like "back the favourite",
   "good bet", "value at" are auto-rejected and re-generated.
5. **No injury or speculation.** The LLM does not invent or speculate on
   player fitness, selection, or off-field matters. The input does not
   carry that data, and the system prompt forbids generating it.

A response that fails any of these is regenerated once. If it still
fails, the templated fallback renders. The user never sees a hallucinated
statistic, even at the cost of a slightly blander insight.

### 3.10 Evaluation

The LLM layer is evaluated on a held-out set of real match situations
where the ground-truth "what should the insight say" is human-written by
a cricket writer on staff:

- **Factual accuracy** — every number in the output traces to an input
  number. Target: 100%. Anything below 99% is a prompt regression.
- **Name accuracy** — every name in the output is in the input. Target:
  100%.
- **Tone appropriateness** — rated 1–5 by a small panel of cricket fans.
  Target: ≥4.0 mean. The prompt is iterated against this.
- **Insightfulness** — rated 1–5 by the same panel. "Did this tell you
  something you didn't already see in the scorecard?" Target: ≥3.5
  mean. Below 3.5 means the model is being too generic and the prompt
  needs to lean harder on the SHAP top-5.
- **Latency** — P95 numbers above are tracked weekly.

A regression on any metric above a defined threshold blocks the prompt
change from shipping. A/B tests run over multi-week windows against live
matches to control for cricket-context noise (e.g. a flat track day
versus a green seamer).

---

## 4. The Data Contract That Both Services Share

Both services read from the same **state bundle**, derived from the
`delivery` object the engine already produces. The bundle is built
synchronously on every `applyDelivery` call, alongside the existing
`winProb` / `state` / `text` derivation, and is the only new thing in
the engine:

```js
// New: a single helper, ~30 lines, called from applyDelivery after state is updated.
function buildAIBundle(d, s) {
  return {
    match:       { id: MD.id, format: MD.format, venue: MD.venue.name,
                   innings_label: MD.innings.current,
                   batting_team: batTeam().name, bowling_team: bowlTeam().name },
    current:     { /* from d, s, MD.teams — runs, wkts, overs, batter/bowler lines */ },
    just_happened: { /* from d and LENGTHS / LINES / SHOT_DIRS lookups */ },
    probability: { home: d.winProb.home, away: d.winProb.away, delta_pp: …,
                   shap_top5: d.shapTop5, projected_first_innings: MD.ai.projected },
    context:     { /* from MD.venue, MD.ai, momentum series */ }
  };
}
```

The two services consume it via a single `POST /v1/insight` endpoint
that takes the bundle and returns both the insight text and the
why-modal text. Internally the endpoint runs them as one or two parallel
calls depending on whether the probability delta warrants a why-modal
update.

The probability service **does not** call the LLM. They are independent
in code. Either can fail, be rate-limited, or be down for maintenance
without the other.

---

## 5. Failure Modes and Degradation

The engine must keep working when the AI services are unhealthy. The
graceful-degradation ladder, in order:

| Failure | Engine behaviour |
|---|---|
| Probability service down | Revert to the per-ball template delta model with a fixed anchor. The probability chart continues to update. A small "model: simplified" tag appears. |
| Probability service slow (>2s) | Render the previous ball's probability and the last-known delta. Refresh on next delivery. |
| LLM service down | Render the existing template insight from `updateAIInsight()`. The "AI" tag greys out. |
| LLM service slow (>2.5s) | Render the template insight with a "thinking…" indicator for up to 5s, then commit the template. |
| Both services down | App is fully functional; the only visible regression is the insight text reverts to the four-branch template. The probability chart is internally templated. The 3D engine, scoreboard, wagon wheel, fantasy card, and player intelligence are unaffected. |

This is the critical design property: **the engine never blocks on AI**.
Every AI call has a templated, deterministic fallback that produces a
valid (if less interesting) result. The user always sees a working
scoreboard and a working probability chart.

---

## 6. Swap-In Plan from Today's Prototype

Six concrete steps, in order, each shippable independently:

1. **Add the state-bundle builder.** One new function in `index.html`,
   called from `applyDelivery`, that produces the JSON object in §4.
   No AI involved yet. The function is the new seam; everything that
   follows is behind it.
2. **Replace `deltaFor` with a stub probability model.** A trivial model
   (linear in 4 features, fitted offline) that the engine can call to
   produce `d.winProb`. The chart continues to look right; the
   explainability note in the why-modal footer goes away.
3. **Wire the production probability model.** XGBoost service, called
   per delivery with the state bundle. The chart and `probDelta` move
   from template to real. Probability service is now the source of
   truth.
4. **Wire SHAP into the why-modal driver cards.** The modal's three to
   five drivers stop being templated and start being the top-5 SHAP
   values from the probability service. The structure of the modal is
   unchanged; only the body of each card changes.
5. **Add the LLM commentary service behind the insight card.** Calls
   the model on every delivery. The four template branches in
   `updateAIInsight` become a single render path. The typewriter
   animation continues to work.
6. **Add the LLM commentary service behind the why-modal lede.** The
   templated lede sentences in `openWhy` become LLM-written. The driver
   cards stay SHAP-driven.

Each step is independently deployable and independently revertable. A
regression in step 5 or 6 reverts to step 4 with a one-line change.

---

## 7. What This Document Does Not Cover

- **Player intelligence** — the `renderPlayers` panel and its form /
  pressure meters. That is a separate service, fed by the same state
  bundle, with its own model. It is a future document.
- **Fantasy intelligence and alerts** — covered in `SCALABILITY.md §6`
  and remains a downstream consumer of the same data feed, not a
  consumer of the AI services in this doc.
- **Commentary moderation, regional language variants, or
  accessibility simplifications** — quality-of-service work that lives
  in the LLM service prompt and a separate post-processor. Out of scope
  for the architecture.
- **Cost at scale across many simultaneous matches** — covered at a
  per-match level here. The per-match cost multiplied across the
  per-session concurrency cap from `SCALABILITY.md §1` is the
  operations plan, not the architecture.

---

## 8. Open Questions for the Client

Three decisions that shape the implementation but are product calls,
not engineering ones:

1. **Refresh cadence on the probability chart.** Per-ball is the
   right default, but T20 broadcasts sometimes want a per-over refresh
   for visual cleanliness. Recommend per-ball; defer to client.
2. **Tone of the insight card.** The default is "knowledgeable fan on
   a phone" — analytical, terse, second-person only when natural. A
   broadcast-style commentary voice is a prompt-only change but
   changes the personality of the product.
3. **Fallback policy on cost-conscious markets.** The open-weights
   fallback in §3.1 is one option. The other is to skip the LLM
   entirely in those markets and render only the templated insight
   card, with a clear "insight: lite" label. Recommend fallback model
   over skipping; the model cost is negligible at scale, the UX hit
   from skipping is real.

All three are answerable in a one-hour conversation. The architecture
is robust to any of the three choices.
