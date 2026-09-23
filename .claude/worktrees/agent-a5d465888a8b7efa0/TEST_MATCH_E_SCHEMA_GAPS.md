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

Each row is a concrete event from the authored 5-over passage where a
schema gap was hit. The "Engine credits" column shows exactly what the
`buildFeed` state-update logic in `index.html:1371-1379` records for the
event, so the client can see the difference between the cricket reality
and the engine's state.

| Over.Ball | Event | Gap | How represented | Engine credits (real cricket) | What the engine actually does |
|---|---|---|---|---|---|
| 2.1 | Wide down leg, no ball faced | **G1** | `[1, null, 89, 'full', 'leg', 'keeper', 'WIDE — …']` | +1 to team total, +1 to bowler.extras, **0 to batsman**, **no strike rotation** | +1 to batsman (KP), +1 to bowler.runs, **strike swap on odd value** (KP→PN), `s.partnership.runs += 1` |
| 2.5 | LBW — Perera out | **G2** | `[0, 'Kusal Perera lbw b Hasaranga 6', 87, 'full', 'middle', null, 'WICKET — …']` | Dismissal type as 'lbw' available to analytics/fantasy; new batsman on strike | Dismissal text is the ONLY representation; engine treats it as a display label. New batsman (KM) on strike. Partnership reset to 0/0. |
| 3.5 | Bowled — Mendis out | **G2** | `[0, 'Kusal Mendis b Shamar Joseph 5', 144, 'yorker', 'middle', null, 'WICKET — …']` | Dismissal type as 'bowled' available | Same as above — only text representation. New batsman (CA) on strike. |
| 4.2 | No-ball + 1 bat-run through midwicket | **G1** | `[1, null, 141, 'full', 'leg', 'midwicket', 'NO-BALL — …']` | +1 team extra (no-ball) + 1 bat run, total 2 this ball; **+0 to bowler** (no-balls not charged); **no strike rotation** | +1 to batsman (CA), +1 to bowler.runs, strike swap (CA→PN), partnership += 1 — **bowler incorrectly charged 1 run, strike incorrectly rotated** |
| 4.3 | Free-hit (the ball after 4.2 no-ball) | **G4** | `[4, null, 140, 'full', 'leg', 'midwicket', 'FREE-HIT — …']` — **normal ball encoding** | Batsman cannot be dismissed off this ball (except run-out); the schema has no signal for that | Ball recorded as a normal legal 4 — a free-hit catch would be recorded identically to any other wicket |
| 5.3 | Leg-bye off the pads, no bat | **G3** | `[1, null, 132, 'good', 'leg', 'fine-leg', 'LEGBYE — …']` | +1 to team total, **+0 to batsman.runs**, +0 to bowler.runs | +1 to batsman (PN), +1 to bowler.runs, strike swap, partnership += 1 — **batsman and bowler both incorrectly credited** |
| 5.5 | Caught at long-on — Asalanka out | **G2** | `[0, 'Charith Asalanka c Pooran b Johnson 2', 136, 'full', 'leg', 'long-on', 'WICKET — …']` | Dismissal type 'caught' available | Same as 2.5/3.5 — text-only. New batsman (SS) on strike. Partnership reset. |

### Other balls in the passage (no schema gap hit)

For context, the rest of the 30 balls are legal deliveries (dots, singles,
doubles, fours) and exercise the engine correctly:

- **Singles:** 1.2, 1.4, 2.3, 2.6, 3.6, 4.5 (six events)
- **Doubles:** 1.6, 5.2 (two events)
- **Fours (off the bat):** 1.3, 3.3, 4.3 (three events) — note 4.3 was a
  free-hit delivery (G4); the four itself is a normal off-the-bat boundary,
  but it would have been unimpeachable for dismissal purposes
- **Sixes:** 0 events authored (could have added one; variety is sufficient
  without it)
- **Dots:** 1.1, 1.5, 2.2, 2.4, 3.1, 3.2, 3.4, 4.1, 4.4, 4.6, 5.1, 5.4,
  5.6 (thirteen events)
- **Wickets:** 2.5 (LBW), 3.5 (Bowled), 5.5 (Caught) — three events, all
  text-only representation per G2

### What the demo will look like

Total: **25/3** after 5 overs. The three G1/G3/G4 gaps (balls 2.1, 4.2,
4.3, 5.3) all show in the live UI as ordinary legal deliveries — there
is no visual marker that anything unusual happened. The cricket-aware
reader can spot the events in the per-ball text, but the engine state
(wickets, runs, partnerships, bowling figures) is wrong for those balls.

---

## Summary for client

The current schema handles **legal deliveries** correctly. Its gaps are
entirely in **extras** and **dismissal categorisation**:

| Gap | Severity | Blocks | Confirmed by ball |
|---|---|---|---|
| G1 — Extras encoding | **High** | Accurate strike rates, bowling economy, fantasy points for extras | 2.1 (wide), 4.2 (no-ball) |
| G2 — Dismissal types | **High** | Per-dismissal analytics, type-specific fantasy scoring | 2.5 (lbw), 3.5 (bowled), 5.5 (caught) |
| G3 — Bye/leg-bye split | **Medium** | Batting accuracy in player stats and projections | 5.3 (leg-bye) |
| G4 — Free-hit rule | **Medium** (T20-specific) | Accurate T20 powerplay and death-overs modelling | 4.3 (free-hit ball) |

All four gaps are **schema extension items** — the fix is to add fields to the
delivery contract, not to change the rendering engine. `buildFeed` and every
downstream panel are pure functions of the delivery object; adding
`extraType`, `dismissalType`, and `isFreeHit` fields requires changes only to
the adapter/normaliser layer and `buildFeed`, not to the 3D engine or UI panels.

### Quick demo reference (which balls to inspect in the live UI)

Open `index.html` → select **SL v WI · R. Premadasa** → press Play on
the ball-by-ball timeline:

| Ball | What to look for | What the UI will show |
|---|---|---|
| 2.1 | Wide down leg (G1) | Text reads "WIDE — sliding down leg side, called by umpire." But: Perera credited with 1 run; Joseph's bowling figures inflated by 1 run; strike rotated to Nissanka (incorrect — wide should not rotate strike) |
| 2.5 | LBW dismissal (G2) | Text reads "WICKET — straightening, trapped on the back pad." But: no 'lbw' type field available for analytics; dismissal shown only as a string |
| 3.5 | Bowled dismissal (G2) | Text reads "WICKET — BOWLED! Yorker crashes into middle stump." Same G2 limitation as above |
| 4.2 | No-ball (G1) | Text reads "NO-BALL — Joseph oversteps! Driven through midwicket." Engine incorrectly charges Joseph 1 run and rotates strike (real cricket: no run to bowler, no strike rotation) |
| 4.3 | Free-hit (G4) | Text reads "FREE-HIT — driven through midwicket, races to the fence." No schema signal for free-hit. Engine treats it as a normal boundary-four; any dismissal on this ball would be recorded identically to a normal wicket |
| 5.3 | Leg-bye (G3) | Text reads "LEGBYE — worked off the pads, no bat involved." Engine credits Nissanka with 1 run — in real cricket a leg-bye does not credit the batsman; his strike rate and stats are inflated |
| 5.5 | Caught dismissal (G2) | Text reads "WICKET — lofted down the ground, Pooran settles under it." Same G2 limitation — no structured 'caught' type field |

See also: [SCHEMA.md](SCHEMA.md) for the current annotated field reference.
