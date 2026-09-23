**Done.** Commit `0391a78` pushed to `origin/master`.

---

### Final Milestone 1 Validation Package

**1. Extras Test Table (8 scenarios)**
| Input | extraType | chip | result | PASS |
|-------|-----------|------|--------|------|
| Wide (1) | wide | WD | WIDE | ✅ |
| Wide (4) | wide | WD | WIDE | ✅ |
| No-ball (1) | noball | NB | NO BALL | ✅ |
| No-ball + 4 bat (5 total) | noball | NB | NO BALL | ✅ |
| Bye (1) | bye | 1b | 1 BYE | ✅ |
| Bye (4) | bye | 4b | 4 BYES | ✅ |
| Leg-bye (1) | legbye | 1lb | 1 LEG BYE | ✅ |
| Leg-bye (4) | legbye | 4lb | 4 LEG BYES | ✅ |

**2. Strike Rotation Table (12 scenarios)**
| Extra | Runs | Expected Rotation | Actual | PASS |
|-------|------|-------------------|--------|------|
| wide | 1/2 | No | No | ✅ |
| noball | 1/2 | No | No | ✅ |
| bye | 1/3 | Yes | Yes | ✅ |
| bye | 2/4 | No | No | ✅ |
| legbye | 1/3 | Yes | Yes | ✅ |
| legbye | 2/4 | No | No | ✅ |

**3. No-Ball 4+1 Output**
```json
{
  "runs": 5,
  "extraType": "noball",
  "batRuns": 4,
  "extraRuns": 1,
  "strikerRuns": 4,
  "strikerBalls": 0,
  "teamTotal": 5,
  "bowlerRuns": 5,
  "chip": "NB",
  "result": "NO BALL"
}
```
✅ `batRuns=4` (off the bat), `extraRuns=1` (no-ball penalty), `strikerBalls=0` (not a legal ball), team total = 5

**4. Test vs T20I Free-Hit**
| Format | Free-hit? | Actual | PASS |
|--------|-----------|--------|------|
| Test | No | false | ✅ |
| T20I | Yes | true | ✅ |

**5. Free-Hit Wicket Restriction (5 types)**
| Dismissal on FH | Should Void? | dismissed | freeHitRejected | PASS |
|-----------------|--------------|-----------|-----------------|------|
| caught | Yes | false | true | ✅ |
| bowled | Yes | false | true | ✅ |
| lbw | Yes | false | true | ✅ |
| runout | No | true | false | ✅ |
| stumped | Yes | false | true | ✅ |

**6. Dismissal Type Short Codes (5 types)**
| Type | Chip | Result | PASS |
|------|------|--------|------|
| caught | c | CAUGHT | ✅ |
| bowled | b | BOWLED | ✅ |
| lbw | lbw | LBW | ✅ |
| runout | ro | RUN OUT | ✅ |
| stumped | st | STUMPED | ✅ |

**7. Final Regression (5 matches)**
| Match | Final Runs | Wickets | Deliveries | Core State Identical? |
|-------|------------|---------|------------|----------------------|
| lords | 291 | 7 | 30 | ✅ PASS |
| galle | 314 | 4 | 12 | ✅ PASS |
| mcg | 413 | 8 | 12 | ✅ PASS |
| hambantota | 31 | 2 | 25 | ✅ PASS |
| premadasa | 60 | 6 | 36 | ⚠️ EXPECTED DIFF (10 extras) |

**8. Commit Hash** — `0391a78`

**9. Known Limitations** (unchanged from TEST_MATCH_E_SCHEMA_GAPS.md):
- G1 Extras encoding — ✅ NOW FIXED in buildFeed()
- G2 Structured dismissal types — ✅ NOW FIXED (parseDismissal regex)
- G3 Bye/leg-bye split — ✅ NOW FIXED (extraType='bye'/'legbye', batRuns=0)
- G4 Free-hit rule — ✅ NOW FIXED (format-aware, rejects non-runout wickets)

*Remaining outside Milestone 1 scope:* DRS, real ball-tracking, substitutions, multi-innings formats