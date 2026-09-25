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
## Client feedback (Shiyan) - TO DO

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
