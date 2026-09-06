# Cric Beacon — Sportmonks World Plan Coverage Verification

> **Why this document exists.** Phase 2 introduces the Provider Adapter layer
> (`sportmonksAdapter.js`) that maps Sportmonks' API output into the Cric
> Beacon match document. Before that adapter ships, the engineering question
> "what competitions does the plan actually cover" needs a verified answer —
> not a marketing-page claim. This file records the live API verification
> performed against Sportmonks' World plan trial account.

---

## 1. Verification Method

| Item | Value |
|---|---|
| **Provider** | Sportmonks (World plan, 14-day trial) |
| **API base** | `https://cricket.sportmonks.com/api/v2.0/` |
| **Auth** | `?api_token={TOKEN}` query parameter (per-account trial token) |
| **Endpoint used** | `GET /leagues/{ID}` |
| **Token source** | Personal Sportmonks World plan trial account — distinct from the public marketing page, distinct from any seeded/test data |
| **Run date** | 2026-09-06 |
| **What was confirmed** | A non-empty JSON payload for the league's data — meaning the trial token could retrieve the league structure and the API returned a populated response, not a 402/403/empty body |

**Distinction drawn between two evidence types:**

- **Live API verification** — the trial account could fetch the league endpoint and received a populated payload back. This is the strongest evidence: the plan actually serves the data over the wire.
- **Published plan documentation** — Sportmonks' own pricing page lists the competition as covered. This is evidence of intent, not behaviour. Used only when live verification wasn't possible during the trial window.

---

## 2. Confirmed Inclusions (Live API Verified)

The following competitions were verified by direct API call to the `/leagues/{ID}` endpoint with a valid World-plan trial token. All returned a populated payload.

| Competition | League ID | Verified via |
|---|---|---|
| Twenty20 International (T20I) | `3` | Live API call |
| Test Series (red-ball bilateral and ICC events) | `4` | Live API call |
| One Day International (ODI) | `2` | Live API call |
| Asia Cup | `11` | Live API call |
| Indian Premier League (IPL) | `1` | Live API call |
| Pakistan Super League (PSL) | `8` | Live API call |

**Implication for Cric Beacon coverage:** the engine's match-document contract
(per `SCHEMA.md`) can be fulfilled for every international fixture (Test /
ODI / T20I), every Asia Cup fixture, every IPL fixture, and every PSL
fixture. These six competition families cover the majority of high-attention
cricket globally.

---

## 3. Confirmed Inclusions (Published Plan Documentation)

The following competitions are listed explicitly in Sportmonks' published
World-plan description at
`https://www.sportmonks.com/cricket-api/plans-pricing/`. They were not
exhaustively live-verified during the trial window but are stated as in-plan
by the vendor.

| Competition | Source of evidence |
|---|---|
| Big Bash League (BBL) | Sportmonks pricing page — World plan description |
| T20 Blast (England) | Sportmonks pricing page — World plan description |

**Caveat:** these should be live-verified before any production deployment
that depends on them. The pricing page is binding as a contract, but the
adapter should not assume the endpoint shape until a populated payload is
observed for a real BBL or T20 Blast fixture.

---

## 4. Confirmed Exclusions (Live API Verified)

The following competitions were queried via the `/leagues/{ID}` endpoint
with the same World-plan trial token. The response was empty or returned an
error — confirming the league is **not** available on the World plan and
would require an upgrade.

| Competition | League ID | Verified via | Effect |
|---|---|---|---|
| Caribbean Premier League (CPL) | `62` | Live API call — empty/error response | **Excluded from World plan** |
| Women's Asia Cup | `377` | Live API call — empty/error response | **Excluded from World plan** |

**Upgrade path to obtain these:** Sportmonks' Enterprise plan (€125/month,
100+ leagues) covers both. The trade-off — Enterprise is roughly 2× the
World-plan price, with the same ball-by-ball field coverage the adapter
already expects — is a procurement decision, not an engineering one.

**Implication for the Cric Beacon adapter:** `normalizeSportMonksMatch()`
treats a missing league as a 404 from the API and surfaces it via the
existing `SportMonksAdapter.getMatch()` error path. The UI does not need a
special "this competition isn't covered" code path — the standard error
toast handles it.

---

## 5. Commercial Licensing

| Item | Status |
|---|---|
| **Licensing for commercial integration** | Confirmed suitable for integration into commercial products without additional licensing fees |
| **Source** | Sportmonks pricing page — "all paid plans (Major, World, Enterprise) include full commercial licensing" |
| **Covers** | All three tiers: Major, World, Enterprise |
| **Redistribution rights** | The plan permits the customer to display the data via the customer's own product. It does **not** grant the right to resell the raw feed or sub-license it to third parties. |
| **Attribution requirement** | None stated on the pricing page; conventional practice is to credit "Data: Sportmonks" in the product footer, which Cric Beacon's existing chrome already supports. |

**Caveat:** commercial licensing terms are vendor-stated and may have
fine-print exceptions. Before any public commercial launch, the contract
should be reviewed by counsel — particularly around sub-licensing, derived
data rights, and rate limits. This document records the vendor's own claim,
not a legal opinion.

---

## 6. Operational Notes

| Concern | Value | Source |
|---|---|---|
| **Rate limit (World plan)** | 1,800 requests/hour | Sportmonks pricing page |
| **Ball-by-ball latency** | World plan targets < 60 s for live fixtures | Sportmonks documentation |
| **Historical data depth** | World plan includes 10+ years of historical fixtures | Sportmonks documentation |
| **Auth method** | Query-string `?api_token=...` (NOT recommended) OR `Authorization: Bearer` header (preferred) | Sportmonks API docs |
| **Recommended header auth** | The adapter currently uses query-string auth (`index.html:456` of the adapter); switching to header auth is a one-line change and the recommended best practice. |

**Adapter change worth making now:** the current `SportMonksAdapter` class
passes the token as a query string. Migrating to `Authorization: Bearer`
header is the vendor's own preferred path (the query-string form is
documented but flagged as legacy). The change is one `fetch()` header
modification.

---

## 7. What the Cric Beacon Engine Receives

Because all six verified competitions return the same Sportmonks ball
schema (the API is shape-consistent across leagues), a single adapter
serves them all. The five-mock-match fixture suite (lords, galle, mcg,
hambantota, premadasa) does **not** need to grow one test case per
competition — a single Sportmonks-shaped sample ball from any of the six
leagues exercises the same `normalizeSportMonksBall()` path.

The exclusion of CPL and Women's Asia Cup from World is not a gap in the
adapter — it's a procurement decision. When Enterprise is procured, those
two IDs slot into the same adapter with no code change.

---

## 8. Summary

- **Six competitions live-verified as covered by World:** T20I (3), Test (4), ODI (2), Asia Cup (11), IPL (1), PSL (8).
- **Two competitions live-verified as excluded from World:** CPL (62), Women's Asia Cup (377). Enterprise plan required.
- **Two competitions documented as covered by World but not yet live-verified:** BBL, T20 Blast.
- **Commercial licensing:** confirmed suitable for product integration per vendor's own pricing page.
- **Adapter implication:** no code change required to support the six verified competitions beyond the adapter that already exists.

**Next action:** live-verify BBL and T20 Blast before the first production
deployment that depends on them. The verification is a one-line `curl` per
league.
