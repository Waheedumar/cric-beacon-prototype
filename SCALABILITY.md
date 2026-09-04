# Cric Beacon — Production Scalability Overview

> Prepared for client technical validation. Honest assessment of the prototype's
> current architecture and what is proven today versus what requires new engineering.

---

## 1. Multiple Simultaneous Matches

The core 3D rendering engine and all match data panels are driven entirely by a
structured data object — a single source of truth for any given match. Because no
match reads from or writes to global state that other matches depend on, the engine
is naturally isolated: one match object feeds one view.

In a production application, supporting multiple simultaneous matches would mean
running one engine instance per active match tab or view panel, rather than a
single global instance as the prototype currently does. The engine code itself
does not need to change — it already handles this — but a management layer would
need to be built to instantiate multiple renderer contexts, assign each one a
portion of the browser's rendering budget, and handle cleanup when a user closes a
match view. On mobile especially, a sensible cap would be needed — perhaps three
or four simultaneous live views — before considering prioritised rendering states
such as a paused thumbnail versus a fully animated view.

---

## 2. Ball-by-Ball Live Updates

The prototype currently works with a pre-loaded delivery feed: every ball in the
over sequence is authored in advance and stored in memory, and the interface lets
you scrub forward and backward through it like a timeline. This is useful for
demonstrating what the panels and 3D visualisation look like at any point in an
over, but it is fundamentally static.

Moving to a live scenario — where new deliveries arrive ball by ball as they
happen in a real match — requires a data pipeline that continuously injects new
entries into that same feed. The most practical approach is connecting the engine
to a WebSocket or polling endpoint from a cricket data provider and writing a
small adapter layer that converts each incoming delivery record into the exact
shape the engine expects. The rendering side — the 3D ball flight, the scorecard,
the win probability chart, the wagon wheel — would need no changes, because those
panels are already pure functions of the current delivery object. The work is
entirely in the data plumbing.

---

## 3. Multiple Users

Because the prototype runs entirely in the browser, every user's session is
completely independent. There is no server-side state shared between users, which
is why the prototype works for one person at a time without any backend
infrastructure.

Supporting many users simultaneously in production is primarily a question of how
many concurrent connections your data feed can support and how you distribute match
data to each connected browser without sending more than necessary. The cricket data
pipeline would be deployed on a server, connected to a provider, and would then
fan out delivery events to whatever number of browsers are watching a given match.
The 3D engine and all the UI panels are already designed to update reactively
as the data changes — they do not need to be rewritten for multi-user support.
The scalability challenge sits entirely in the backend and the data feed
connection layer, not in the frontend.

---

## 4. Different Competitions, Venues, and Teams

Adding new competitions, tournaments, venues, or teams is — by design — a data task
rather than a code task. The Hambantota match addition demonstrated this precisely:
a new match object was written into the same data structure, and the existing
engine rendered it correctly without any changes to the 3D code, the UI panels,
or the ball-trajectory logic. A new T20 league, a different venue with different
boundary dimensions and floodlight settings, or a different team's kit colours —
all of these are just fields in the match data document. A new match enters the
system the same way a new entry enters a database: the data is defined, and the
engine reads it. The only constraint on new competitions or venues is the
completeness and accuracy of the data provided.

---

## 5. Live AI Insights

> **Full technical specification: [AI_INTELLIGENCE.md](AI_INTELLIGENCE.md)**

The insight panel currently generates its commentary from pre-written template rules
that branch on conditions such as "if wicket, say X; if boundary, say Y." This
works well enough to show what the panel looks like and how it behaves, but the
text is selected from a set of branches rather than genuinely reasoned.

Two independent services replace the current template layer. The **probability
service** (XGBoost / gradient-boosted trees, not an LLM) produces per-ball win
probabilities and SHAP-driven driver attributions for the "why" modal. The **LLM
commentary service** (Claude Sonnet, with an open-weights fallback) writes the
insight card and the modal lede in natural language from a strict JSON input
contract. Both services share the same state bundle built from the delivery object
the engine already produces — `buildFeed` and every downstream consumer are
unchanged. The swap-in plan has six independently-revertable steps from today's
template deltas to the full production stack.

---

## 6. Fantasy Intelligence and Alert Systems (WhatsApp / Telegram)

Fantasy scoring and push alerts are features that sit downstream of the same match
data the engine already processes. The prototype already includes a fantasy points
table and the AI insight card — both are consumers of the live delivery feed. To
add a fantasy scoring notification or a push alert to WhatsApp or Telegram, a new
data subscriber would be added that listens to the same feed the panels listen to,
evaluates the relevant rules or calls the LLM, and routes the output to the
appropriate channel.

The data model does not change; only the consumers do. This is the key
architectural benefit of building around a clean data seam: new features can be
layered on without touching the core engine.

---

## 7. Multi-Match and Mobile Scalability

This section covers two separate but related questions: how the engine behaves at
scale with multiple simultaneous match views, and how it behaves across the range
of devices on which a cricket app is used — from flagship phones to budget
Android tablets.

---

### 7.1 Where the Prototype Stands Today

The prototype is a single-instance application. One `initEngine()` call creates one
renderer, one scene, one camera, one OrbitControls, and one `requestAnimationFrame`
loop. `loadMatch(def)` swaps the data and rebuilds the scene meshes — it never
creates a second renderer. The loop caps `dt` at 50 ms, which prevents runaway
physics on slow frames but does not otherwise monitor performance.

The codebase already makes several mobile-friendly choices:

| Decision | Where it lives | Effect |
|---|---|---|
| DPR cap: `Math.min(devicePixelRatio, IS_SMALL ? 1.5 : 2)` | `index.html:1861` | Budget phones avoid the 3×–4× DPR tax |
| Antialias disabled below 900 px | `index.html:1859` | Reduces fragment shader work on small screens |
| Crowd instances: 900 (desktop) / 420 (mobile) | `index.html:1524` | Halves the instanced-draw-call load on mobile |
| Tab-visibility pause: loop exits early when hidden | `index.html:1955` | No GPU work while tab is backgrounded |
| `powerPreference:'high-performance'` | `index.html:1859` | Requests the discrete GPU where one exists |

What the prototype does not yet have: no FPS monitoring, no adaptive quality
ladder, no multi-instance management layer, and no per-match isolation of WebGL
contexts.

---

### 7.2 Mobile Rendering Architecture

The 3D engine is built on a lean subset of Three.js that is already compatible
with mobile browsers:

**No expensive features.** The renderer uses no shadow maps, no real-time
reflections, no post-processing passes, and no physics engine. The ball flight
uses `CatmullRomCurve3` (a single spline sample per frame). Fielder movement
uses a linear `lerp` — no collision detection or rigid-body simulation. The render
loop calls `renderer.render(scene, camera)` exactly once per frame.

**Lighting is cheap.** Three lights total: a `HemisphereLight` (sky/ground colour
blend, no depth passes) plus two `DirectionalLight`s (flat shading via
`MeshLambertMaterial` throughout the scene). No shadow casting.

**Instanced geometry handles the stadium.** The crowd (900 or 420 instances via a
single `InstancedMesh` draw call) and the advertising boards (44 instances, also
an `InstancedMesh`) mean the draw-call count stays low even on mid-range
Android. Rough per-instance count at startup:

| Object | Meshes | Draw calls (desktop) | Draw calls (mobile) |
|---|---|---|---|
| Ground (grass rings + pitch + markings) | ~15 | 1 (multi-ring circle) | 1 |
| Stadium tiers + roof | 3 | 3 | 3 |
| Crowd (instanced) | 900 | 1 | 1 |
| Advertising boards (instanced) | 44 | 1 | 1 |
| Floodlights | 4 | 4 | 4 |
| Players (3 batsmen + 1 bowler + 11 fielders = 15) | ~75 (5 per player) | 15 | 15 |
| Ball | 1 | 1 | 1 |
| **Total** | **~1 050** | **~26** | **~26** |

~26 draw calls is well within mobile GPU budget. The constraint on low-end
devices is not draw calls but fill rate — the vignette overlay, the HUD gradient,
and the stadium geometry all contribute. The existing DPR cap of 1.5 on small
screens is the first line of defence here.

**Font loading.** Google Fonts (Plus Jakarta Sans, Inter, JetBrains Mono) load via
CDN and fall back to `system-ui` during the network request. No font files are
bundled.

---

### 7.3 Adaptive Quality Ladder

A production app needs to adapt to the full device spectrum. The prototype has the
hooks in place; the quality ladder is the missing layer. The recommendation is a
four-tier system triggered at boot and re-evaluated on error or once per session:

| Tier | Target | DPR cap | Crowd | Antialias | Shadow maps | Post-FX |
|---|---|---|---|---|---|---|
| **1 — Flagship** | High-end desktop / tablet | 2 | 900 | Yes | — | — |
| **2 — Mid-range** | Mainstream phones (Snapdragon 7-series, A15+) | 1.5 | 420 | No | — | — |
| **3 — Budget** | Low-end Android (gaming score < 500) | 1.0 | 200 | No | — | — |
| **4 — Extreme constraint** | Old Android WebView, 1 GB RAM | 1.0 | 0 | No | Off | Off |

Tier detection uses `navigator.hardwareConcurrency`, `navigator.deviceMemory`,
and a WebGL context-info query (`MAX_TEXTURE_SIZE`, `MAX_RENDERBUFFER_SIZE`).
A WebGL info endpoint (`WEBGL_debug_renderer_info`) gives the GPU string for
hardware-specific allowlists (e.g. Mali-4xx blacklist for a known driver bug).

A second signal is a **frame-time budget**. After 30 warm-up frames, if the
90th-percentile frame time exceeds 20 ms (50 fps equivalent) on two
consecutive checks, the engine steps down one tier and rebuilds the instanced
meshes. The existing `ResizeObserver` already triggers a resize pass; the same
pattern extends to quality changes.

The HUD panels, 2D canvas charts, and HTML overlays are not affected by the
quality ladder — they render at full fidelity at every tier.

---

### 7.4 Multiple Simultaneous Match Views

Supporting multiple live matches — in separate browser tabs, in a split-screen
view, or as a dashboard of thumbnail previews — means running multiple Three.js
renderer instances simultaneously. Each `initEngine()` call creates an independent
`WebGLRenderer`, `WebGLContext`, `scene`, and `animation loop`. The state is
fully isolated: each engine reads only its own `MD` data object.

The hard constraint is **the browser's WebGL context limit**. Every `new
THREE.WebGLRenderer({ canvas })` acquires a WebGL context. Chrome desktop allows
up to 16 contexts total (16 shared across all renderer types, not per-page).
Mobile Chrome is stricter: 16 contexts per renderer type, typically with only 6
visible at once. Exceeding the limit causes `WebGL: CONTEXT_LOST` or silently
returns `null` on the context.

The practical implication for a multi-match product:

- **Tab-per-match** is the simplest model. Chrome enforces ~16 tab hard limit in
  practice (including background tabs). This maps to ~12 simultaneous 3D match
  views on desktop. On mobile the per-tab overhead is higher; 4–6 tabs is the
  realistic ceiling before OOM kills a tab.
- **Split-screen dashboard** — a single page showing 4 match thumbnails — means
  4 `initEngine()` calls in one tab. A 2 × 2 grid on a flagship phone is
  technically possible but risks frame-rate contention on the GPU command queue.
  The better approach is to render only the **active** view at full fidelity;
  thumbnail views use a downsampled canvas (1/4 resolution, 1 fps refresh) until
  tapped.
- **Context sharing.** `THREE.WebGLRenderer` accepts a `shareContext` option that
  lets multiple renderers share a single WebGL context. This avoids the context
  limit entirely but requires that all shared renderers target the same `<canvas>`
  (not useful for separate viewports) or use a manual multi-viewport approach.
  Not currently used in the prototype; adding it is a medium-effort change if a
  single-page multi-match view is needed.

A production management layer would:

1. Track the active set of engine instances.
2. On tab-hidden: demote the hidden engine to 1 fps (or 0 fps with manual
   `renderer.render()` on demand for thumbnail updates).
3. On tab-visible: promote back to full frame rate with a 30-frame warm-up before
   full quality resumes.
4. Enforce a per-tab cap (e.g. 4 simultaneous instances) and gracefully
   degrade extras to 2D previews.

---

### 7.5 Memory Model

Each engine instance allocates roughly:

| Resource | Estimate (per instance) |
|---|---|
| Scene geometry + materials (no textures) | ~15–20 MB |
| WebGL context (GPU VRAM) | ~8–12 MB |
| Renderer + controls JS heap | ~2 MB |
| **Total per instance** | **~25–35 MB** |

On a device with 4 GB total RAM and a 2 GB GPU budget, the theoretical ceiling
is 50–80 simultaneous instances — far more than any realistic use case. On a
1 GB RAM budget phone the ceiling drops to 12–15. On a 512 MB device it is
4–6.

The existing crowd instance count reduction (900 → 420 → 200 → 0 across tiers)
is the primary memory lever. Player meshes are fixed at 15 per instance regardless
of tier.

---

### 7.6 What's Proven Today vs. What Needs Building

**Proven today:**
- The renderer runs on mobile Chrome and Safari without crashes.
- The DPR cap and antialias toggle are already implemented.
- Tab-visibility pauses the loop cleanly.
- `loadMatch()` correctly rebuilds the scene from new data without a page reload.
- The ~26 draw-call budget is compatible with mid-range Android.

**Needs building for production:**
- Quality-tier detection (GPU info + frame-time budget) and automatic tier
  switching at runtime.
- Engine instance management layer (track active instances, throttle background
  ones, enforce a per-tab cap).
- Per-quality-tier crowd count and optional player detail (LOD — reduce 5 meshes
  per player to 3 or 1 on low tiers).
- An FPS / frame-time monitor exposed to the dev toolbar (not surfaced to users)
  to support the tier-down signal.
- Memory pressure listener (`navigator.deviceMemory`, `memory` API) to force a
  tier downgrade before the browser kills the tab.
- A 2D fallback for extreme constraints (no WebGL, or `WEBGL_lose_context`
  fires): a static SVG pitch diagram with animated dot markers, showing the same
  delivery data without 3D.

The rendering architecture is sound. The mobile story is solid at tier 2
(mid-range phones). The gap between prototype and production is entirely in the
management layer that monitors device capability, enforces quality constraints,
and orchestrates multiple engine instances.
