# M3 Section 3 - Trajectory Replay Acceptance Check

Date: 2026-09-27
Commit: 635360b
Environment: https://cric-beacon.vercel.app (Chrome, incognito)

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Works correctly on the first click | PASS |
| 2 | Restarts correctly and completely on repeated Replay clicks | PASS |
| 3 | Does not duplicate or accumulate trajectory lines | PASS |
| 4 | Does not introduce new 3D rendering errors (console clean) | PASS |
| 5 | Does not affect match switching or other 3D components | PASS |

Notes: Replay plays in slow motion (REPLAY_SLOWMO = 2.0); the trajectory line is drawn behind the ball.
