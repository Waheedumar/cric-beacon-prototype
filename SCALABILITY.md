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

The insight panel currently generates its commentary from pre-written template rules
that branch on conditions such as "if wicket, say X; if boundary, say Y." This
works well enough to show what the panel looks like and how it behaves, but the
text is selected from a set of branches rather than genuinely reasoned.

A real LLM integration would take the live match state as its input — current
score, partnership size, bowler figures, venue conditions, momentum trend — and
produce natural-language analysis that reflects what is actually happening. The
architectural seam is the same: the engine exposes a clean data object, and the
insight service reads from it. Whether that service calls a branching template
function or an LLM API is a swap at the service layer, not a change to the data
contract. The difference between the prototype and production is the intelligence
sitting behind that seam.

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
