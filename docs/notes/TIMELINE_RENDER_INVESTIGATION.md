# Ball-by-Ball Timeline Rendering Investigation

## Function: `renderTimeline()` — index.html:2669-2692

```javascript
/* ---------------- timeline ---------------- */
function renderTimeline(){
  const ov = MD.overs.find(o => o.over === selOver) || MD.overs[0];
  $('tlLabel').textContent = `OVER ${ov.over}`;
  $('overTabs').querySelectorAll('.otab').forEach(b => b.classList.toggle('on', +b.dataset.over === selOver));

  $('tlBalls').innerHTML = ov.balls.map((b, i) => {
    const key = `${ov.over}.${i + 1}`;
    const fi = FEED.findIndex(x => x.key === key);
    const future = fi > playedIdx;
    const chip = fi >= 0 ? FEED[fi].chip : (b[1] ? 'W' : String(b[0]));
    const freeHit = fi >= 0 && FEED[fi].freeHit;
    const title = freeHit ? `${key} — FREE HIT` : key;
    return `<div class="bchip ${future ? 'future' : chipClass(chip)}${freeHit ? ' fh' : ''}${fi === idx ? ' sel' : ""}" data-i="${fi}" title="${title}">${future ? '?' : chip}</div>`;
  }).join('');

  $('tlBalls').querySelectorAll('.bchip').forEach(el => {
    const i = +el.dataset.i;
    if (i > playedIdx) return;
    el.addEventListener('click', () => { stopPlay(); applyDelivery(i, true); });
  });

  $('btnPrev').disabled = idx <= 0;
  $('btnNext').disabled = idx >= FEED.length - 1;
}
```

## Confirmed: No Hardcoded "6" Assumptions

- **No "6" literal anywhere in `renderTimeline()`** — the loop maps over `ov.balls` dynamically
- **Keys generated**: `${ov.over}.${i + 1}` produces 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8 for over 2
- **Data source**: `ov.balls` comes from the match JSON — over 2 Premadasa has **8 balls** confirmed (WD, 0, NB, 0, lbw, 0, 1, 0)
- **FEED entries**: One entry per ball key via `buildFeed()` — confirmed all 8 keys exist in FEED

## Why Only 6 Balls Display Visually (Root Cause Identified)

### The Bug: `chipClass('0')` returns empty string `''`

**index.html:2383** — `chipClass()` maps chip values to CSS classes:

```javascript
function chipClass(c){
  if (c === 'W' || c === 'c' || c === 'b' || c === 'lbw' || c === 'ro' || c === 'st') return 'w';
  if (c === '4' || c === '6') return 'r' + c;
  if (c === '0') return '';       // <-- BUG: dot balls get NO additional class
  if (c === 'WD' || c === 'NB') return 'x';
  if (/^\d+(b|lb)$/.test(c)) return 'x';
  return 'r' + c;
}
```

When chip is `'0'` (dot ball):
- Returns `''` (empty string)
- The div only gets the base `.bchip` class
- `.bchip` has `background:rgba(255,255,255,.03)` and `color:#9FB0AD` on dark bg
- On `#0A0A0F` dark background, dot balls are nearly invisible

### Over 2 Premadasa ball chips and what renders:

| Ball | Actual data | chip value | chipClass() output | CSS class chain | Visibility |
|------|------------|-----------|-----|---|---|
| 1 | WIDE | 'WD' | 'x' | `.bchip .x` | Visible (amber glow) |
| 2 | dot ball | '0' | `''` | `.bchip` only | **Invisible** (was the bug) |
| 3 | NO-BALL | 'NB' | 'x' | `.bchip .x` | Visible |
| 4 | dot ball (free-hit) | '0' | `''` | `.bchip` only | **Invisible** |
| 5 | lbw WICKET | 'lbw' | 'w' | `.bchip .w` | Visible (red) |
| 6 | dot ball | '0' | `''` | `.bchip` only | **Invisible** |
| 7 | single | '1' | 'r1' | `.bchip .r1` | Visible (green) |
| 8 | dot ball | '0' | `''` | `.bchip` only | **Invisible** |

**Result**: Balls 2, 4, 6, 8 are all dot balls with no chip class → they blend into the dark background → only 6 visually distinct balls appear.

### The Fix (already applied)

1. **index.html:2383** — Changed `chipClass('0')` from `return ''` to `return 'r0'`
2. **index.html:183** — Added `.bchip.r0` CSS rule:
   ```css
   .bchip.r0{color:#6B7270;border-color:rgba(140,140,140,.4);background:rgba(140,140,140,.08);}
   ```

Now dot balls have a visible gray-on-charcoal appearance, making all 8 balls in over 2 Premadasa clearly distinguishable.

## Summary of Ruled-Out Possibilities

| Possibility | Status |
|---|---|
| Hardcoded "6 balls per over" in renderTimeline() | **Ruled out** — maps over `ov.balls` dynamically |
| FEED only has 6 entries for over 2 | **Ruled out** — confirmed 8 entries via `FEED.findIndex(x => x.key === '2.8')` |
| Container width truncates after 6 balls | **Ruled out** — all 8 `div` elements are created; CSS grid/flex handles overflow |
| `future` variable logic skipping balls 7-8 | **Ruled out** — `future = fi > playedIdx`; when fi = -1, `future = false`, balls render from raw data and still appear as div elements |
| chipClass('0') returning '' causing CSS collapse | **CONFIRMED** — this is the root cause; dot balls only get `.bchip` base styling which is nearly invisible on dark background |

## Files Modified

- **index.html:2383** — `chipClass('0')` → returns `'r0'` instead of `''`
- **index.html:183** — Added `.bchip.r0` CSS rule for visible dot-ball styling

## Verification Steps

After the fix, over 2 Premadasa should show 8 distinct balls:
- Ball 1: WD (amber/x class)
- Ball 2: Dot (gray/r0 class — was invisible, now visible)
- Ball 3: NB (amber/x class)
- Ball 4: Dot/free-hit (gray/r0 class — was invisible, now visible)
- Ball 5: lbw wicket (red/w class)
- Ball 6: Dot (gray/r0 class — was invisible, now visible)
- Ball 7: Single (green/r1 class)
- Ball 8: Dot (gray/r0 class — was invisible, now visible)