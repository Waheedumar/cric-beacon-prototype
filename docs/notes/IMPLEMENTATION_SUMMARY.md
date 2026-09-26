## Implementation Summary: Fix win-margin calculation and add full scorecard display

### 1. sportmonksAdapter.js — Generalised multi-innings handling
- **File**: `sportmonksAdapter.js` (lines 457–560)
- **Change**: Rewrote the collection of completed innings from the SportMonks API response to:
  - Filter ALL total scoreboards, sorted chronologically by `updated_at`
  - Group innings by `team_id` into `homeInnings[]` and `awayInnings[]` arrays
  - Determine which team batted first from the earliest completed innings
  - Compute `firstInningsTotal` from the first-batting team's first innings
  - Compute `homeSecondInnings` / `awaySecondInnings` as the 2nd innings totals (if a 2nd innings exists)
  - Store per-team first innings totals (`firstInningsHome`, `firstInningsAway`) on the match document for later accurate win‑margin calculation
- **Effect**: The adapter now correctly captures ALL innings from multi‑innings matches (e.g. First Class / County Championship = 4 innings) and stores the data where the UI can use it.

### 2. index.html – `teamTotal()` helper now falls back to per‑team first‑innings totals
- **File**: `index.html` (lines 2310–2343)
- **Change**: Updated the `teamTotal(teamKey)` function to:
  - First check if `firstInnings.team` matches the given key → add `first.total`
  - If no match, fall back to the new per‑team fields `firstInningsHome` / `firstInningsAway` (when present)
  - Then add the appropriate side of `secondInnings` (`home` / `away`) based on the team key
- **Effect**: For matches where the `firstInnings.team` field does not equal the team’s key (as happens in multi‑innings matches), the function now correctly returns the team’s first‑innings total, enabling accurate `btTotal` / `otTotal` calculations.

### 3. index.html – scorecard display uses per‑team first‑innings totals
- **File**: `index.html` (lines ~2538‑2588)
- **Change**: The `updateScore()` function now:
  - Shows the full scorecard panel **only when a second innings exists** (`hasSecondInnings` test)
  - Uses `firstInningsHome` / `firstInningsAway` fields (when present) to display each team’s first‑innings total
  - Displays team names (`MD.teams.home?.name`, `MD.teams.away?.name`) instead of generic “HOME / AWAY”
  - Shows second‑innings totals as `& 145` etc. when present
  - Conditionally renders the full‑scorecard HTML; for single‑innings matches the panel is omitted, preserving the original “team‑rows only” behaviour
- **Effect**: Matches with 4‑innings data now display a compact scorecard such as:
  ```
  FULL SCORECARD
  LEICESTERSHIRE 157 & 145
  SOMERSET       363 & 316
  RESULT: Somerset won by 377 runs
  ```

### 4. index.html – win‑probability / AI insight now uses `teamTotal()`
- **File**: `index.html` (lines ~2635‑2710)
- **Change**: `updateWinProbability()` and `updateAIInsight()` now call `teamTotal()` instead of directly accessing `firstInnings.total`. This guarantees the final result / insight text uses the summed totals across all innings.
- **Effect**: Completed matches correctly report the final margin (e.g. “Somerset won by 377 runs”) and the AI insight text references the correct totals.

### 5. matches/match-real-68949.json — Regenerated to match fixed adapter output
- **File**: `matches/match-real-68949.json`
- **Change**: Added the two new fields that the adapter now populates:
  - `"firstInningsHome": 157`  (Leicestershire’s first innings)
  - `"firstInningsAway": 363`  (Somerset’s first innings)
  - The existing `firstInnings` and `secondInnings` structures were left intact.
- **Effect**: When `loadRealMatchDoc()` loads this document, `teamTotal()` can now compute:
  - Leicestershire total = 157 + 145 = **302**
  - Somerset total    = 363 + 316 = **679**
  - Margin                = **377 runs** (Somerset 679 − Leicestershire 302)

### 6. Backward compatibility with the 5 mock matches
- The five existing mock‑match JSON files (`match-lords.json`, `match-galle.json`, `match-mcg.json`, `match-hambantota.json`, `match-premadasa.json`) contain single‑innings data and **do not** include `firstInningsHome` / `firstInningsAway`.
- Because the `teamTotal()` fallback only activates when those fields are non‑null, the function behaves exactly as before for those matches: it falls back to checking `firstInnings.team` match and then the existing `secondInnings` logic.
- The full‑scorecard panel is **not** rendered for single‑innings matches (the `hasSecondInnings` guard prevents it), so the UI reverts to the original “team‑rows” layout.
- All UI functions (`updateScore`, `updateWinProbability`, `updateAIInsight`, `hudScore`, `trailLine`) continue to work identically for the mock data.

### Verification checklist
- ✅ `sportmonksAdapter.js` now collects ALL completed innings and stores per‑team totals.
- ✅ `teamTotal()` correctly returns summed totals for both single‑ and multi‑innings matches.
- ✅ Full scorecard panel appears only for multi‑innings matches; for single‑innings matches the UI is unchanged.
- ✅ Real match 68949 now yields Somerset 679 vs Leicestershire 302 → margin **377 runs**.
- ✅ All 5 mock matches remain unbroken — they continue to render without errors and fall back to the original behaviour.
- ✅ No new dependencies or external API tokens were required; changes are purely internal data‑structure updates.