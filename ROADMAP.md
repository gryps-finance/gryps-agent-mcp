# Roadmap

The end state is an industry-grade agentic trading MCP toolchain for Gryps.
The path there is the capability ladder from [ARCHITECTURE.md](ARCHITECTURE.md):
`public-read → internal-observer → execution-gateway → supervised-live → agentic-live`.
No routine update of the public package ever moves a user up that ladder.

Status legend: `[x]` done, `[~]` in progress, `[ ]` open.

## 1. Public read hardening (this package)

- [x] Frozen four-tool public allowlist with boundary tests.
- [x] Strict upstream schema validation, sanitised typed errors, versioned envelopes.
- [x] Request timeout, redirect refusal, credential-free URL enforcement.
- [x] Short-TTL cache with in-flight deduplication and bounded size.
- [x] Single retry with backoff for transient upstream failures (429/5xx/network).
- [x] Oversized-response guard on upstream bodies.
- [x] Query-string stripping in endpoint configuration.
- [x] `--help` / `--version` CLI flags and graceful SIGINT/SIGTERM shutdown.
- [x] End-to-end MCP wire tests over an in-memory transport.
- [x] CI on Linux and Windows with the full release verification chain.
- [ ] MCP `outputSchema` on every tool so clients can validate structured content.
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
- [ ] npm publish pipeline via GitHub Actions with OIDC trusted publishing.
      Note: npm provenance links resolve only if the source repo is public;
      decide public/private before the first publish or drop `provenance`.
- [ ] Pin GitHub Actions to commit SHAs.
- [ ] `npm audit` / OSV scan job in CI.
- [ ] Signed release tags and a release checklist issue template.
- [ ] MCP registry / directory listing once the alpha cohort clears.

## 3. Data surface expansion (still read-only)

- [ ] Candles/OHLCV, funding, and open-interest tools if and when the v2 API exposes them.
- [ ] RFQ quote-read tool (indicative quotes) — the venue is RFQ-based, so this is
      the honest answer to "is there executable liquidity", which the market list is not.
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

## 5. Execution gateway (separate package, never this one)

Blockers before any code merges (from [BACKEND-INTEGRATION.md](BACKEND-INTEGRATION.md)):

- [ ] Versioned API contract or OpenAPI publication from the backend owner.
- [ ] Non-empty owned test account validating every account field and pagination.
- [ ] Staging access with a reproducible session-key registration/revocation drill.
- [ ] Signed order, cancel, reduce-only close, and fill reconciliation on staging.
- [ ] Query-by-request-id or an agreed deterministic fallback for unknown outcomes.
- [ ] Confirmed session-key scope, expiry units, withdrawal exclusion, revocation semantics.
- [ ] Fee-basis decision (per side vs round trip) and measured spread/slippage.
- [ ] Backend owner, compatibility policy, rate limits, incident path, and SLO.

Design requirements once unblocked:

- [ ] Separate `@gryps/execution-gateway` process and package with its own review bar.
- [ ] EIP-712 signer boundary: keys live in a signer process/enclave, never in the MCP server.
- [ ] Short-lived delegated session keys; registration and revocation drills automated.
- [ ] Mandate ceilings enforced in code: max notional, per-symbol allowlist,
      max leverage, daily loss halt, reduce-only recovery mode.
- [ ] Idempotency keys on every order mutation; unknown-state reconciliation loop.
- [ ] Kill switch: one command halts new orders and flattens or freezes per mandate.
- [ ] Append-only audit log of every intent, signature, submission, and outcome.
- [ ] Paper-trading mode that exercises the identical code path minus the signer.

## 6. Supervised and agentic live (gates G1–G6)

- [ ] G1–G4: paper and staging evidence, drills, reconciliation proofs.
- [ ] G5: the $50–100 supervised live test with full audit capture.
- [ ] G6: formal operating approval, monitoring, alerting, and rollback rehearsal
      before any agent runs unattended.
- [ ] Risk engine as a standing service: position limits, drawdown halts,
      exposure aggregation across accounts.
- [ ] Observability: OpenTelemetry traces from tool call → upstream → envelope,
      alerting on schema drift, latency, and error-rate SLOs.
