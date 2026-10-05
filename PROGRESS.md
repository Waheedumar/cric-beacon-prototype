# PROGRESS.md — Step 1 Investigation Summary

## Findings — "Show Ball Trajectory" & Trajectory Code

1. **`index.html:3618–3622`** — The "Show Ball Trajectory" button calls `animateBall(cur(), true, false)`, which creates `trajA`/`trajB` trajectory Line objects (lines 2129–2144) and draws them progressively in the render loop (lines 2357–2377) via `trajA.userData.drawProgress`.

2. **`index.html:3245`** — Delivery chip clicks call `applyDelivery(i, true)` → `animateBall(d, true)`, which draws the full trajectory line progressively. Yes, the delivery handler draws the complete trajectory.

3. **`index.html:2096–2101` / `2555` / `2604`** — On match switch, `clearTrajectory()` removes `trajA`/`trajB` from `ballGroup`, disposes their geometries/materials, nulls the variables, and hides `bounceMark`/`ball`. Same cleanup in `loadRealMatchDoc()` rollback.

4. **`index.html:2133,2141`** — `trajA.frustumCulled = false` and `trajB.frustumCulled = false` are set during build. **No `.visible` assignments** exist anywhere for either trajectory line.

5. **`index.html:2134,2142`** — Trajectory lines are added to `ballGroup` via `ballGroup.add(trajA)` / `ballGroup.add(trajB)`, not `scene.add`/`scene.remove`. Removal uses `ballGroup.remove(t)` inside `clearTrajectory()`.

## Step 2 — Trajectory Reset & Draw Progress

1. **`index.html:3278–3280`** — `applyDelivery()` does NOT call `clearTrajectory()` before `animateBall(d, true)`; however `animateBall()` itself clears old trajectories at line 2121, so old `trajA`/`trajB` cannot persist from this path.

2. **`index.html:2121`** — Yes; `clearTrajectory()` runs before new Line objects are created (lines 2129–2144), removing old `trajA`/`trajB` from `ballGroup` and disposing their geometry/material.

3. **`index.html:2135, 2143, 2362`** — `drawProgress` is reset to `0` when each new line's `userData` is initialized (lines 2135/2143); the render loop then eases it upward at line 2362 toward `targetProgress`.

## Step 3 — Replay Animation Failure (2nd+ click)

1. **`index.html:2157`** — `animateBall()` sets `anim.on = animate` (3rd arg), `anim.phase = 0`, `anim.t = 0` — ball animation state fully reset.
2. **`index.html:2162–2164`** — `trajAnim.on = animate || true` (always true), `trajAnim.t = 0`, but `trajAnim.dur = flight` — single duration, no per-phase tracking despite `trajAnim.curves` holding 2 curves when a shot exists.
3. **`index.html:3620`** — "Show Ball Trajectory" button passes `animate=false`; this disables ball flight (`anim.on = false`) but trajectory drawing still runs (`trajAnim.on = true`).
4. **`index.html:2353–2355`** — Render loop increments `trajAnim.t += dt / trajAnim.dur` using the single `flight` duration; when `trajAnim.t >= 1` it sets `trajAnim.on = false` — stops trajectory drawing after delivery phase only.
5. **`index.html:2111–2112, 2155–2169`** — No animation variable is set only on the first run: `resetAnimState()` clears every `anim`/`trajAnim` field, then `animateBall()` reinitializes them on each call; however `trajAnim.dur` encodes only the first phase.

**Root cause (guess):** `trajAnim` has no per-phase timer: it can own two curves but always uses `dur = flight`, so it reaches `t >= 1` after the delivery phase and sets `on = false`, preventing the shot phase from drawing. The repeated click is reset correctly, so the 2nd-click “already finished” behavior is likely the visible symptom of this premature trajectory completion rather than stale animation state.

## Step 4 — Render Loop dt Investigation

Hypothesis: on the 2nd replay, the first frame gets a huge dt, so `trajAnim.t` jumps past 1 instantly (“vibrates once, stops”).

1. **`index.html:2312`** — dt is computed as `Math.min(clock.getDelta(), 0.05)`; `clock` is a `THREE.Clock` whose `getDelta()` returns seconds since the last call.
2. **`index.html:2312`** — Yes, dt is clamped to a max of 0.05 s (50 ms), so no single frame can inject a huge dt.
3. **`index.html:2306–2310`** — The loop does NOT pause/idle when nothing animates; it keeps calling `requestAnimationFrame(loop)` every frame (only the `paused` flag from tab visibility halts it).
4. **`index.html:2307`** — On tab visibility restore, `clock.getDelta()` is called once to reset the clock, but `animateBall()` itself does NOT touch the clock or any last-frame time; it only resets `anim`/`trajAnim` state.

**Verdict: hypothesis NOT confirmed.** dt is clamped to 0.05 s and `trajAnim.t` is reset to 0 in `animateBall()` (line 2163), so no single frame can push it past 1 — the “vibrate once, stop” symptom is the existing per-phase timer bug (Step 3 root cause), not a dt spike.

## Next features

1. **Trajectory line color by outcome** — Color the trajectory line based on the delivery outcome: 1/2/3 runs = white `#FFFFFF`, 4 runs = blue `#2F80ED`, 6 runs = purple `#9B51E0`, wicket = red `#EB5757`. Dot balls and extras keep the current color. Both `trajA` and `trajB` use the outcome color.
## Bug — MATCH CONDITIONS HUD: finished real match without ball-by-ball data (investigated + fix applied)

**Scenario:** A FINISHED real match with no ball-by-ball data (single synthetic "FINAL" delivery, no overs[] array). Example HUD output before fix: "WP 70/1 · SA-E —"

**Root cause (two bugs):**
1. Batting team shows `s.runs/s.wickets` from the synthetic feed state (70/1) instead of the real final total + wickets
2. Opponent always shows '—' when `!hasSecondInnings`, because `firstInnings.team` only stores the first batting team — the second innings team never matches `ot.key` for single-innings matches

**Fix applied (index.html:3088-3091):**
When `!hasSecondInnings && isComplete()` → use `teamTotal(bt.key)`/`teamTotal(ot.key)` for runs and `firstInnHomeWk`/`firstInnAwayWk` for wickets (both already computed in `updateScore()`).

**Data sources confirmed:**
- `teamTotal()` (line 2610) correctly sums `firstInningsHome`/`firstInningsAway` + `secondInnings` — this is what main panel and AI Insight use
- `firstInnHomeWk`/`firstInnAwayWk` (lines 2948-2955) have the correct first-innings wickets per team
- sportmonksAdapter.js (lines 1097-1257) populates these from SportMonks completed innings

**After fix:** "WP 70/10 · SA-E 194/?" showing real final scores instead of "70/1" + "—"

**Next:** Verify with a real match load, also check that `_script1.js` (untracked clone) gets the same fix if it's used as a reference copy.

1. Progressive Replay (Step 9)
   - REPLAY = clearly visible slow-motion ball flight: release -> delivery -> bounce -> shot
   - Ball and trajectory line move together (0.7s per phase)
   - Normal playback and "Show Ball Trajectory" unchanged

2. Mobile visibility (Step 10)
   - Thicker trajectory line (WebGL ignores linewidth; use Line2 / tube)
   - Camera framing for portrait phone screens
   - Bigger ball on small screens
   - Panels must not cover the pitch on mobile
   - Check animation speed and scale on phone

## Status update
- DONE: slow-motion Replay, line grows behind ball
- DONE: mobile - thicker line, portrait camera, readout hidden, taller stage, bigger ball
- DONE: fours reach rope, sixes land beyond rope
- NEXT: Step 12 - real Sportmonks matches in 3D
- WAITING: Shiyan's answer on AI integration scope
- Section 7: test multi-innings scoring. All 5 mock matches are 1st innings only; check M2 test scripts, else add one finished Test mock with 2 innings per team (& layout)

## Bug 3 — Premadasa Match Batsman Name Mismatch (2026-10-04)

**Context:** The user reported that in the SL v WI Premadasa ball-by-ball timeline, the commentary AI Insight sometimes names a different batsman as dismissed than the actual striker per the simulation. Example: commentary says "Cole Johnson to Kusal Mendis — WICKET — Asalanka departs", AI Insight says "Kusal Mendis falls — Charith Asalanka c Pooran b Johnson 2".

**Investigation:**
- Located `MOCK_MATCHES.premadasa` data (lines 1285-1422) and traced strike rotation via `buildFeed()` logic (lines 1481-1673).
- Three wicket text mismatches identified:

  1. **Over 2 Ball 5:** outName="Pathum Nissanka", wicketText="Kusal Perera lbw b Hasaranga 6" — Nissanka was the actual striker; Perera isn't in the toCome list.
  
  2. **Over 3 Ball 5:** outName="Sadeera Samarawickrama", wicketText="Kusal Mendis b Shamar Joseph 5" — Samarawickrama was the actual striker; Mendis was retired out earlier (Over 3 Ball 5 wicket).

---

## Inference Layer — Sportmonks → Trajectory Data (2026-10-04)

**Task:** Investigate and propose heuristic for inferring length/line/dir when Sportmonks doesn't provide ball_type/line/direction fields.

### 1. Sportmonks Fields Available Per Ball

**Confirmed (always present):**
- `id`, `over_id`, `ball_number`, `batsman_id`, `bowler_id`
- `batsman_one_on_creeze_id`, `batsman_two_on_creeze_id`
- `batsmanout_id`, `catchstump_id`
- `runs`, `bye`, `leg_bye`, `noball`, `noball_runs`, `wide`, `wide_runs`
- `batsman_score` (per-batsman breakdown)
- `score.name` ("FOUR", "SIX", "Catch Out", "LBW OUT", "Clean Bowled", etc.)

**World Plan Optional (may be present):**
- `ball_type` → maps to length ('0'=yorker, '1'=full, '2'=good, '3'=short, '4'=bouncer)
- `line` → maps to line ('off','fourth','middle','leg','body','wide')
- `direction` → maps to SHOT_DIRS
- `rate_id` → NOT exposed (speed always null)

**Player Sub-Objects (when included in API call):**
- `smBall.bowler.bowlingstyle` — e.g. "Right-arm fast", "Left-arm orthodox"
- `smBall.batsman.batsmanstyle` — e.g. "Right-hand bat", "Left-hand bat"

### 2. MOCK Data Possible Values

**LENGTHS:** 'yorker', 'full', 'good', 'short', 'bouncer' (index.html:907-913)
**LINES:** 'off', 'fourth', 'middle', 'leg', 'body', 'wide' (index.html:914)
**SHOT_DIRS:** 'cover','point','third-man','mid-off','long-off','straight','long-on','mid-on','midwicket','square-leg','fine-leg','keeper','slip' + null

### 3. Proposed Heuristic — Summary

Uses available signals: `runs`, `batRuns`, `extraType`, `wicket.type`, `phase`, `bowlerStyle`, `batsmanStyle`, seeded random from `ball.id`.

**Key improvements over existing `inferDelivery` (test-real-match.js):**
- Uses `bowlerStyle` for length weighting (spinners → more 'good', fast → more 'short'/'yorker')
- Uses `batsmanStyle` for handedness flip on line (off ↔ leg for left-handers)
- Uses `batRuns` to distinguish 4/6 off bat vs extra-boundaries
- More nuanced distributions for dir (1 run → mid-on/mid-off/straight; 2/3 runs → gaps)

**Full proposal saved to:** `docs/inference-heuristic-proposal.md`

### 4. Design Decisions for Your Review

1. **Use bowler style for length/line weighting?**
2. **Dir perspective: bowler's view (current) or batsman's view?** (affects left-hander flip)
3. **Extra-boundaries (batRuns=0, runs≥4): dir = null or random?**

**Next step:** Awaiting your approval on the proposed mapping before implementation.
  
  3. **Over 5 Ball 6:** outName="Kusal Mendis", wicketText="Charith Asalanka c Pooran b Johnson 2" → commentary "Asalanka departs for 2" — Simulation confirms: Mendis was the striker on Over 5 Ball 6 with 6 runs total after the over. The authored text incorrectly names Asalanka.

- **Simulation trace (definitive):**
  - After Over 4: Mendis 4/8, Asalanka 0/2* (on strike)
  - Over 5 Ball 1: DOT (Asalanka on strike)
  - Over 5 Ball 2: 1 run → strike rotates to Mendis
  - Over 5 Ball 3: DOT (Mendis on strike)
  - Over 5 Ball 4: 2 runs (Mendis scores) → total 6 runs
  - Over 5 Ball 6: Mendis out c Pooran b Johnson 6

- **Fix applied (Over 5 Ball 6):**
  - Line 1342: `lastWicket.text` → `'Kusal Mendis c Pooran b Johnson 6'`
  - Line 1409: Wicket field → `'Kusal Mendis c Pooran b Johnson 6'`
  - Line 1409: Commentary → `'Mendis departs for 6.'`
- **Fix applied (Over 2 Ball 5):**
  - Line 1381: Wicket field → `'Pathum Nissanka lbw b Hasaranga 18'`
  - Line 1381: Commentary → `'Nissanka departs for 18.'`
- **Fix applied (Over 3 Ball 5):**
  - Line 1391: Wicket field → `'Sadeera Samarawickrama b Shamar Joseph 7'`
  - Line 1391: Commentary → `'Samarawickrama cleaned up for 7.'`

All three Premadasa wicket-text mismatches fixed and verified against buildFeed simulation.

## Next features

1. **Trajectory line color by outcome** — Color the trajectory line based on the delivery outcome: 1/2/3 runs = white `#FFFFFF`, 4 runs = blue `#2F80ED`, 6 runs = purple `#9B51E0`, wicket = red `#EB5757`. Dot balls and extras keep the current color. Both `trajA` and `trajB` use the outcome color.
