# Test Match E — Schema Gaps Log

> **Purpose:** Honest record of schema limitations encountered while authoring
> Test Match E (SL v WI, R. Premadasa, Colombo — T20 International).
> Each gap was identified during ball-by-ball authoring and is reported as-is.
> No workarounds were implemented; no new fields were added to the schema.
> These gaps are reported to the client for consideration in the production
> schema design.

---

## Client instruction

> "If any limitation in the current schema prevents a particular event
> from being represented correctly, please leave the limitation unchanged
> and point it out to us rather than creating a match-specific workaround."

---

## Schema gaps confirmed at index.html:872

The ball tuple is defined as:

```
[runs, wicket|null, speed, length, line, dir|null, text]
```

This contract cannot represent the following without extension.

### G1 — Extras: wides, no-balls, byes, leg-byes

**Gap:** The ball tuple has no `extraType` field, no `legal` flag, and no
separate `batRuns` field.

**What this means in practice:**

| Event | Cannot represent as | Forced to encode as |
|---|---|---|
| Wide (0 legal balls faced) | `[extra:'wide', legal:false, runs:1]` | `[1, null, ...]` — indistinguishable from a single off the bat |
| Wide with 4 runs | `[extra:'wide', legal:false, runs:4]` | `[4, null, ...]` — looks like a boundary four |
| No-ball (1 run, +1 to bowler) | `[extra:'noball', legal:false, runs:1, batRuns:1]` | `[1, null, ...]` — counted as bat runs, bowler stats unchanged |
| No-ball + boundary 4 | `[extra:'noball', legal:false, runs:5, batRuns:4]` | `[4, null, ...]` — misleads strike rate and partnership math |
| Bye | `[extra:'bye', legal:true, runs:1, batRuns:0]` | `[1, null, ...]` — credited to batsman's tally |
| Leg-bye | `[extra:'legbye', legal:true, runs:1, batRuns:0]` | `[1, null, ...]` — credited to batsman's tally |

**Consequence:** `buildFeed`'s per-ball state update always credits `runs` to the
batsman and adds it to the partnership. There is no mechanism to separate bat
runs from extras. Fantasy scoring (which requires accurate bat-run attribution)
and bowling economy (which should not count extras against the bowler) will be
incorrect for any over containing extras.

**Source:** `index.html:872` (ball tuple comment) and `index.html:1368`
(`buildFeed` state update: `striker.runs += runs; s.runs += runs; bowler.runs += runs;`).

---

### G2 — Structured dismissal types

**Gap:** The ball tuple's `wicket` field accepts a freeform string
(e.g. `'Kane Williamson c sub b Taskin Ahmed 45'`) rather than a structured
object or enum.

**What this means in practice:** The engine treats the wicket string as a
display label only. There is no `dismissalType` field (caught/bowled/lbw/
run-out/stumped/hit-wicket) that analytics, fantasy scoring, or the AI
probability model could consume.

The string encoding is human-readable but not machine-parseable for:
- Categorising catch-vs-bowl-vs-lbw statistics
- Assigning fantasy points by dismissal type (different platforms award different
  points for caught vs bowled)
- Tracking how often a player was caught vs lbw'd in similar situations

**Source:** `index.html:872` (ball tuple comment).

---

### G3 — Bye/leg-bye attribution mixed into runs count

**Gap:** Related to G1. No separate signal for byes or leg-byes means they
inflate the batting team's total and the batsman's strike rate identically to
bat runs. The `buildFeed` state update has no conditional to exclude extras.

**What this means in practice:** A batsman who scores 38 runs off 30 balls
but has 4 leg-byes mixed in appears to have a strike rate of 140 when the
real bat strike rate is closer to 113. The scoreboard total is unaffected, but
player performance metrics are distorted.

**Source:** `index.html:1368` (`striker.runs += runs;` — no `batRuns` branch).

---

### G4 — Free-hit rule

**Gap:** The schema has no mechanism to signal that a delivery is a free-hit
following a no-ball. A batsman can be caught off a free-hit, which carries
different strategic weight than a normal ball.

**What this means in practice:** If Test Match E requires a no-ball + free-hit
sequence (common in T20 cricket), it cannot be represented. The free-hit ball
would need to be shown with the same encoding as any other delivery, and the
batsman's dismissal would be recorded identically to a normal wicket.

**Source:** `index.html:872` — no `isFreeHit` or `precedingBallWasNoBall` field.

---

## Per-ball limitation log

_(Populated during Step 2 ball-by-ball authoring)_

| Over.Ball | Event attempted | Gap hit | How represented instead |
|---|---|---|---|
| _TBD_ | _TBD_ | _TBD_ | _TBD_ |

---

## Summary for client

The current schema handles **legal deliveries** correctly. Its gaps are
entirely in **extras** and **dismissal categorisation**:

| Gap | Severity | Blocks |
|---|---|---|
| G1 — Extras encoding | High | Accurate strike rates, bowling economy, fantasy points for extras |
| G2 — Dismissal types | Medium | Per-dismissal analytics, type-specific fantasy scoring |
| G3 — Bye/leg-bye split | Medium | Batting accuracy in player stats and projections |
| G4 — Free-hit rule | Low (T20-specific) | Accurate T20 powerplay and death-overs modelling |

All four gaps are **schema extension items** — the fix is to add fields to the
delivery contract, not to change the rendering engine. `buildFeed` and every
downstream panel are pure functions of the delivery object; adding
`extraType`, `dismissalType`, and `isFreeHit` fields requires changes only to
the adapter/normaliser layer and `buildFeed`, not to the 3D engine or UI panels.

See also: [SCHEMA.md](SCHEMA.md) for the current annotated field reference.
