# Roadmap

The end state is an industry-grade agentic trading MCP toolchain for Gryps.
The path there is the capability ladder from [ARCHITECTURE.md](ARCHITECTURE.md):
`public-read → internal-observer → execution-gateway → supervised-live → agentic-live`.
No routine update of the public package ever moves a user up that ladder.

Status legend: `[x]` done, `[~]` in progress, `[ ]` open.

## 1. Public read hardening (this package)

- [x] Frozen public tool allowlist with boundary tests.
- [x] Strict upstream schema validation, sanitised typed errors, versioned envelopes.
- [x] Request timeout, redirect refusal, credential-free URL enforcement.
- [x] Short-TTL cache with in-flight deduplication and bounded size.
- [x] Single retry with backoff for transient upstream failures (429/5xx/network).
- [x] Oversized-response guard on upstream bodies.
- [x] Query-string stripping in endpoint configuration.
- [x] `--help` / `--version` CLI flags and graceful SIGINT/SIGTERM shutdown.
- [x] End-to-end MCP wire tests over an in-memory transport.
- [x] CI on Linux and Windows with the full release verification chain.
- [x] Measured friction floor with provenance and explicit lower-bound status.
- [x] Cost gating of a claimed edge, source-agnostic, with untrusted-signal notice.
- [x] Correlation-floored signal stacking, including echo detection: exact
      source repeats and shared `originId` fold together, near-identical source
      names are floored at 0.9 correlation.
- [x] Venue cost comparison by live book walk, including depth-exhaustion honesty.
- [x] Market-count claim gated behind an unreconciled flag.
- [ ] MCP `outputSchema` on every tool so clients can validate structured content.
- [x] `gryps_paper_session`: paper rehearsal against live oracle prices with
      real friction charged per leg and every close decomposed into price move
      versus friction paid. The price-stream contract it waited for is
      satisfied v1 by polling the oracle read; a streaming upgrade follows the
      websocket item in section 3 if the backend ships one.
- [x] `gryps_prompt_library`: the open prompt manifest, embedded rather than
      read from disk so onboarding survives an unreachable venue.
- [x] Fee direction reported as an interval, with verdict-stability checking in
      `gryps_edge_check`, until the protocol team confirms the basis.
- [x] Settlement identity pinned in-package and verified against the engine
      report rather than relayed.
- [x] Symbol discovery: curated alias table, exact-first ranking, and
      edit-distance suggestions in both browse results and `not_found` errors.
- [ ] Measure spread on v2 so the friction floor stops being a lower bound.
      This is the single highest-value open item: it converts the headline
      number from a fee floor into all-in friction. Blocked upstream, and now
      demonstrably so: every order-book, depth, ticker, and quote path was
      probed on 2026-08-29 and returns 404. The probe is pinned in
      `SPREAD_SURFACE_PROBE` and re-runs cheaply when the engine changes.
- [ ] Resolve the fee direction with the protocol team. Until then every cost
      figure is an interval, and `gryps_route_compare` favouring Hyperliquid
      depends on which reading is correct.
- [ ] Use `fundingRate` from the newly found `/api/v1/market-data` surface.
      Funding is a real holding cost this package does not yet charge, and the
      same response carries mark price and 24h volume.
- [ ] Structured stderr logging with `--log-level` (never stdout; stdio transport owns stdout).
- [ ] Request correlation IDs threaded through envelopes and logs.
- [ ] Circuit breaker + stale-while-revalidate cache so a flapping upstream degrades gracefully.
- [ ] Lint/format gate (ESLint or Biome) wired into CI; keep the current no-semicolon style.
- [ ] Coverage reporting (c8) with a ratcheting threshold in CI.
- [ ] Rate-limit guard for pathological MCP clients (token bucket per tool).
- [ ] Extract the shared HTTP/cache/validation core used by both `src/` and
      `internal-src/` without weakening the tarball boundary.

## 2. Release and supply chain

- [x] Tarball allowlist verification and clean-install smoke in the release gate.
- [x] Dependabot for npm and GitHub Actions.
- [x] npm publish pipeline via GitHub Actions with OIDC trusted publishing.
      Provenance requires a cloud runner and a public repository; both hold.
      Publishing from a laptop is not possible while provenance is enabled.
- [ ] Pin GitHub Actions to commit SHAs.
- [ ] `npm audit` / OSV scan job in CI.
- [ ] Signed release tags and a release checklist issue template.
- [ ] MCP registry / directory listing once the alpha cohort clears.

## 3. Data surface expansion (still read-only)

- [x] Reference price read: Gryps oracle beside an external fair-value mid with
      divergence in bps (`gryps_reference_price`). First piece of the reference
      pricing layer that paper sessions need.
- [ ] Candles/OHLCV, funding, and open-interest tools if and when the v2 API exposes them.
- [~] RFQ quote-read tool (indicative quotes) — the venue is RFQ-based, so this is
      the honest answer to "is there executable liquidity", which the market list is not.
      2026-08-28: the public engine API exposes no quote, estimate, or preview
      endpoint (GET candidates 404; POST `/order`, `/leverage`, `/withdraw` exist
      but nothing quote-shaped). Shipped `gryps_indicative_quote` as the derived
      stand-in: oracle mid plus the friction model, labeled non-firm with
      `engineQuoteSurface: absent`. The true venue-quoted read stays open and is
      blocked upstream; when the engine ships a quote surface the tool's basis
      flips without changing its contract.
- [ ] MCP resources for static venue documentation (fee policy, settlement identity).
- [ ] Streaming price updates as MCP resource subscriptions if the backend offers
      a websocket; otherwise document polling guidance.
- [ ] Streamable HTTP transport option with authentication for hosted deployment
      (currently stdio-only by design; HTTP widens the attack surface and needs
      its own threat model first).
- [ ] Docker image for the hosted variant.

## 4. Internal observer (private)

- [x] Fixed single-address account reads, no write methods, excluded from the tarball.
- [x] In-flight deduplication, bounded cache, pagination clamps.
- [ ] Raw chain-event reads and custody reconciliation against engine state.
- [ ] Session-key oversight: list active keys, expiries, and scopes for the account.
- [ ] Paper-session bookkeeping (positions, PnL) for strategy evaluation without execution.
- [ ] Operator diagnostics tool (config echo, cache stats, upstream latency).

## 5. Execution: out of scope for this package

Execution capability does not belong in this package and will never be added to
it. It requires a separate process and package with its own signer boundary,
short-lived delegated authority, mandate ceilings, allowlists, idempotency,
unknown-state reconciliation, halt, revocation, and reduce-only recovery, and
its own security review bar and release cadence.

That work is tracked privately and is gated on independent verification
evidence. No update to `gryps-agent-mcp` moves a user toward it.

## 6. Observability for this package

- [ ] OpenTelemetry traces from tool call through upstream to envelope.
- [ ] Alerting on upstream schema drift, latency, and error rate.
- [ ] Latency and availability objectives, set only after a measured baseline
      exists rather than asserted in advance.
