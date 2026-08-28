# Changelog

## Unreleased (0.2.0-alpha.1)

Consolidates the decision layer from `@gryps/agent-core` into the public
read-only package, turning it from a venue-data reader into a cost gate.

- Added `gryps_friction_floor`: the live round-trip cost a trade must beat,
  decomposed into fees and spread with explicit provenance. Reports
  `isLowerBound: true` while spread is unmeasured on v2, and states whether the
  engine fee rate was read as per side or round trip.
- Added `gryps_edge_check`: cost-gates a claimed edge from any upstream signal
  source. Source-agnostic; checks magnitude only, never signal truth. Low
  confidence and repeated round trips both widen the required edge.
- Added `gryps_signal_stack`: combines several agreeing signals without letting
  correlated sources count as independent confirmations. A caller cannot
  declare more independence than the source families allow.
- Added `gryps_route_compare`: compares Gryps round-trip cost against a public
  order-book venue priced by walking live displayed depth. Reports the other
  venue as cheaper when that is true, and distinguishes "ranked out on price"
  from "ranked out because displayed depth could not fill the clip".
- Added the untrusted-signal notice to every response that touches a claimed
  edge, so a model reads the boundary in place.
- `gryps_venue_status` no longer presents the engine market count as a fact. It
  is returned flagged `reconciledWithDocumentation: false` and
  `publishableAsClaim: false` while 701 versus 470/471 is unresolved.
- `gryps_get_market` now returns an explicit `PRICE_UNAVAILABLE` status instead
  of a silent null price.
- New configuration: `--comparison-url`, `--comparison-taker-fee-bps`,
  `--fee-is-round-trip`, `--spread-bps-per-side`.
- Test suite grew from 24 to 50, covering friction provenance, edge gating,
  correlation flooring, book walking, depth exhaustion, and the MCP wire.

## Superseded draft (0.1.0-alpha.2)

- Added a single automatic retry with backoff for transient upstream failures
  (network errors, HTTP 429/5xx). Non-retryable statuses fail immediately.
- Added an oversized-response guard on upstream bodies (5 MB cap).
- Bounded the read cache size in both the public client and the internal
  observer, and added in-flight request deduplication to the observer.
- Query strings are now stripped from configured endpoints so override URLs
  cannot smuggle credentials or break path joining.
- Added `--help` / `--version` CLI flags and graceful SIGINT/SIGTERM shutdown.
- The internal observer clamps pagination bounds before they reach the
  upstream URL, even when used as a library.
- `createPublicServer` accepts an options object (fetcher, clock, retry delay)
  for deterministic end-to-end testing; public API is otherwise unchanged.
- Added end-to-end MCP wire tests over an in-memory transport, plus tests for
  retry behaviour, pagination, ambiguity, and missing-price limitations.
- Added GitHub Actions CI (Linux + Windows), a nightly live-contract check,
  Dependabot, CODEOWNERS, a PR boundary checklist, CONTRIBUTING.md, and
  ROADMAP.md.

## 0.1.0-alpha.1

- Added a public read-only MCP server over stdio.
- Added live Gryps v2 market catalogue, exact market detail, fee schedule, and
  venue status tools.
- Added exact symbol and base-asset resolution. Substring matches are refused.
- Added typed response envelopes with source, freshness, schema version, and
  limitations.
- Added strict upstream response validation, request timeouts, short-lived
  caching, and sanitised errors.
- Added release tests proving the public tool allowlist and npm tarball boundary.
