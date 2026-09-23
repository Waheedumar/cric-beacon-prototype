# Over 2 — Current balls Array (Premadasa Match, index.html MOCK_MATCHES)

The current `balls` array for over 2 in `index.html` (lines 1313–1321). Every element is shown exactly as it appears in the source.

```javascript
[
  [1, null, 89, 'full', 'leg', null, 'WIDE — sliding down leg side, called by the umpire. Hasaranga has overpitched. One extra run.', 'wide'],
  [0, null, 86, 'good', 'off', null, 'Defended solidly into the pitch. Hasaranga finding good rhythm.'],
  [2, null, 88, 'good', 'middle', 'midwicket', 'NO-BALL — Joseph oversteps! Driven through midwicket for one, plus the penalty. Free-hit coming.', 'noball'],
  [0, null, 90, 'good', 'off', null, 'FREE-HIT — short and wide, Perera reaches for it but cannot connect cleanly. No run.'],
  [0, 'Kusal Perera lbw b Hasaranga 6', 87, 'full', 'middle', null, 'WICKET — straightening from Hasaranga, trapped on the back pad. Umpire raises the finger. Perera departs for 6.'],
  [0, null, 85, 'good', 'leg', null, 'First ball for Mendis — defended solidly into the pitch.'],
  [1, null, 84, 'good', 'middle', 'mid-on', 'Mendis works it back through mid-on for a single. Good running.'],
  [0, null, 87, 'good', 'off', null, 'Hasaranga drifts outside off — Mendis shoulders arms. DOT.']
]
```

## Count

- **Total ball entries: 8**

## Breakdown by type

| # | runs | wicket | extraType | Description |
|---|------|--------|-----------|-------------|
| 1 | 1 | null | **wide** | Wide down leg side — 1 extra run, not a legal ball |
| 2 | 0 | null | (absent) | Defended off the pitch — legal delivery |
| 3 | 2 | null | **noball** | No-ball driven through midwicket — 1 bat run + 1 penalty, free-hit next |
| 4 | 0 | null | (absent) | Free-hit — no run, still counts as legal for striker balls |
| 5 | 0 | **Perera lbw** | (absent) | Wicket — Perera lbw b Hasaranga, departs for 6 |
| 6 | 0 | null | (absent) | First ball for Mendis — defended solidly |
| 7 | 1 | null | (absent) | Single — Mendis works it back through mid-on |
| 8 | 0 | null | (absent) | Dot — Mendis shoulders arms |

## Cricket-rule notes

- **Wides** (ball 1) and **no-balls** (ball 3) are **illegal deliveries** — they do not count toward the batsman's `strikerBalls` faced, but they ARE counted as bowled deliveries in the over.
- **Free-hit** (ball 4) follows the no-ball (ball 3) per T20I rules.
- The **6 legal deliveries** for the over are balls 2, 4, 5, 6, 7, 8 — totaling 8 entries because 2 are wide/no-ball extras.
- `perOverRuns` for over 2 is **5** (was 3 before the over-length fix: +1 from the added single in ball 7).