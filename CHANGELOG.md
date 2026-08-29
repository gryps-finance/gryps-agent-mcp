# Changelog

## 0.2.0-alpha.3 (unreleased)

- The server now sends MCP `instructions` on initialize. Clients pass these to
  the model automatically, so an agent is oriented before its first call rather
  than inferring the server from fourteen tool descriptions.
- Added `gryps_capabilities`: what the server answers, what it refuses, which
  live sources it reads, and every known limitation paired with its consequence.
- Wrote the seven journey-spine prompt bodies. `gryps_next_step` previously
  named a destination without supplying the route; it now returns the runnable
  text, with `bodyStatus` marking any prompt whose body is not yet written.
- Exposed those prompts through the native MCP prompts capability, so clients
  surface the guided journey in their own interface.
- A test now requires every journey prompt to carry an explicit refusal or
  limit. It caught two of the seven on first run.

- Fee direction is now reported as an interval instead of a footnote. The
  engine never states whether `totalFeeRateBps` is per side or a round trip,
  and the answer is worth a factor of two, so every friction sample carries both
  readings. `gryps_friction_floor` gains `feeDirectionRange` with both round
  trips and both break-even edges; `gryps_edge_check` re-runs the gate against
  the alternative reading and reports `feeDirectionSensitivity.verdictStable`,
  saying plainly that a call is not decidable from live data when the verdict
  flips between them. `--fee-is-round-trip` became three-state: unset is
  unresolved, and `false` now means confirmed per side rather than merely
  assumed. `gryps_get_fee_schedule` reports the three states accordingly.
- Spread absence is now evidence rather than an assurance. Every order-book,
  depth, ticker, and quote path on the public v2 engine was probed and returns
  404; the probe is pinned in `SPREAD_SURFACE_PROBE` and surfaces as
  `spreadSurface` on every friction-derived response. Spread is absent
  upstream, not unwired here, and cannot be measured from this package until the
  engine ships a surface for it.
- Settlement identity is verified rather than relayed. The canonical chain,
  contract, and collateral token are pinned in this package and compared against
  what the engine reports; `gryps_venue_status` returns
  `verified | mismatch | unreported` with named mismatches and a loud
  limitation when the endpoint does not describe canonical Gryps.
- Symbol discovery no longer fails on the obvious input. A search for
  `bitcoin` used to return nothing. A curated alias table, checked against the
  live catalogue, rewrites common names to the ticker the venue actually lists
  (`matic` finds `POLUSDT`, `shiba inu` finds `1000SHIBUSDT`), substring hits
  are ranked exact-first, and a query that matches nothing returns the nearest
  listed symbols labelled as guesses. The same suggestions now appear in
  `not_found` messages. Aliases rewrite the query and never assert a market
  exists; substring guessing stays refused and similarity never resolves.
  `gryps_get_market` reports the route that resolved it.
- `gryps_signal_stack` now detects echoed sources. Exact repeats of one source,
  and anything sharing a declared `originId`, are folded into a single signal
  keeping the largest claim. Near-identical source names are not folded but have
  their pairwise correlation floored at 0.9, well above what source-family
  priors alone would give. The naive sum still counts every supplied signal, so
  the overstatement factor measures exactly the trap being warned about.
- Raised the release gate's package-size ceiling from 300k to 400k. It is an
  accidental-inclusion guard, not a budget, and the package has grown from four
  tools to thirteen; the path and content boundary assertions are unchanged.
- Test suite grew from 95 to 115.

- Added `gryps_next_step`: journey-aware onboarding. On a fresh install it
  returns one starting point rather than a catalogue, then routes from there.
- Added `gryps_prompt_library`: 25 staged prompts searchable by journey stage,
  experience level, purpose, autonomy, or free text.
- Both enforce the money line. Exploration below it (read-only and paper) is
  never withheld; live-stage guidance is withheld until the caller states the
  funding station is complete, or asks for that level deliberately. Recovery
  prompts are never gated, because they are needed exactly when someone is
  least able to go looking.
- The library is embedded rather than read from disk, so onboarding works when
  the venue is unreachable. Covered by test.
- Responses carry a capability boundary: these are prompts for the caller to
  run, describing a journey that continues outside a package that cannot trade.
- README and CONNECT.md now lead with the published npm install rather than the
  GitHub fallback, and the honesty-rule count is corrected to four.

- Added `gryps_paper_session`: rehearse trades against live oracle prices with
  zero capital. Open, close, status, and reset actions; entries and exits mark
  at the oracle mid with real per-leg friction charged, and every close
  decomposes the result into price move versus friction paid, with a narration
  that names the venue lesson when friction eats a favourable move. Unrealized
  status figures already charge the pending close, so a flat price shows as a
  small loss, which is the honest number. Positions are bookkeeping in the
  server process only: no order exists anywhere, and state dies with the
  process. Bounded at 20 open positions and 200 retained closes. Test suite
  grew from 84 to 95.
- Added the `invalid_request` error code for malformed tool arguments that are
  not configuration errors.

## 0.2.0-alpha.2

- Added `gryps_indicative_quote`: an indicative, non-firm execution estimate
  for one clip (oracle mid, estimated entry price, base quantity, all-in cost
  model with provenance). The public engine API exposes no quote, estimate, or
  preview endpoint (surface probed 2026-08-28: GET candidates 404; POST
  `/order`, `/leverage`, `/withdraw` exist but nothing quote-shaped), so the
  response is derived from oracle price plus measured friction and says so in
  `quoteBasis` and `engineQuoteSurface`. When the engine ships a real quote
  surface, this tool's basis flips to venue-quoted without changing its
  contract. Test suite grew from 50 to 54.
- Added `gryps_reference_price`: the live Gryps oracle price next to a
  fair-value mid from the configured reference venue (top-of-book midpoint),
  with divergence reported in basis points. This is the external anchor for
  oracle sanity checks and the first piece of the reference pricing layer that
  paper sessions need. Degrades typed rather than erroring: comparison
  disabled, market not listed, and venue unreachable are all real outcomes
  with the oracle side still served. Test suite grew from 54 to 58.

- Added `gryps_indicative_quote`: an indicative execution estimate for one clip,
  built from the live oracle price plus measured friction. The engine exposes no
  quote surface, so the response carries `firm: false`, `quoteStatus: derived`,
  and `engineQuoteSurface: absent`. It is a cost model, never a tradable quote.
- Added `gryps_reference_price`: the Gryps oracle beside a fair-value mid from a
  public reference venue, with divergence in basis points. Anchors oracle sanity
  checks and future paper-session pricing.
- Live smoke now exercises all ten tools, asserting that a derived estimate can
  never report itself as firm.
- Published unscoped as `gryps-agent-mcp`. The `@gryps.finance` scope was
  dropped because its dot breaks unquoted npx commands on Windows PowerShell.
- Provenance moved from publishConfig to an explicit workflow flag so the first
  publish can be done locally.

## 0.2.0-alpha.1

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
