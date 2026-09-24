# PROGRESS.md — Step 1 Investigation Summary

## Findings — "Show Ball Trajectory" & Trajectory Code

1. **`index.html:3618–3622`** — The "Show Ball Trajectory" button calls `animateBall(cur(), true, false)`, which creates `trajA`/`trajB` trajectory Line objects (lines 2129–2144) and draws them progressively in the render loop (lines 2357–2377) via `trajA.userData.drawProgress`.

2. **`index.html:3245`** — Delivery chip clicks call `applyDelivery(i, true)` → `animateBall(d, true)`, which draws the full trajectory line progressively. Yes, the delivery handler draws the complete trajectory.

3. **`index.html:2096–2101` / `2555` / `2604`** — On match switch, `clearTrajectory()` removes `trajA`/`trajB` from `ballGroup`, disposes their geometries/materials, nulls the variables, and hides `bounceMark`/`ball`. Same cleanup in `loadRealMatchDoc()` rollback.

4. **`index.html:2133,2141`** — `trajA.frustumCulled = false` and `trajB.frustumCulled = false` are set during build. **No `.visible` assignments** exist anywhere for either trajectory line.

5. **`index.html:2134,2142`** — Trajectory lines are added to `ballGroup` via `ballGroup.add(trajA)` / `ballGroup.add(trajB)`, not `scene.add`/`scene.remove`. Removal uses `ballGroup.remove(t)` inside `clearTrajectory()`.