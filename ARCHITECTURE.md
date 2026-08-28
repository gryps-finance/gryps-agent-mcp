# Architecture

## Product boundary

`@gryps/agent-mcp` is the permanent public read boundary. Its authority is
limited to fetching and returning public Gryps v2 market and venue data.

The package has four layers:

1. `EngineReadClient` validates fixed public HTTPS responses and caches them
   briefly.
2. `PublicReadService` resolves canonical market identity and produces the
   versioned response envelope.
3. `createPublicServer` registers the frozen MCP tool allowlist.
4. `index.ts` connects that server to local stdio transport.

The public entrypoint exports the first three layers so Gryps-owned internal
runtimes can reuse the same read contract without copying endpoint logic.

## Capability profiles

### Public read

- Market catalogue
- Exact market detail and current price
- Engine-reported fee schedule
- Venue health and settlement identity

### Internal observe

The repository now includes a separate private observer composition. It fixes
one wallet address at process start and reads its account snapshot, portfolio,
order history, and trades. It has no write methods and is excluded from the npm
tarball. It may later add raw chain events, custody reconciliation, session-key
oversight, paper sessions, routing, research, internal strategies, private
documentation, and operator diagnostics.

### Execution

This belongs in a separate process and package. It must provide an explicit
signer boundary, short-lived delegated authority, mandate ceilings, allowlists,
idempotency, unknown-state reconciliation, halt, revocation, and reduce-only
recovery.

Execution is an additive capability. It is never activated by a routine update
of the public package.

## Invariants

- The public tool list is frozen and tested.
- Public responses never include environment, filesystem, credential, account,
  internal strategy, or private repository details.
- Symbol resolution uses exact canonical, display, or unique base-asset matches.
  It never chooses a market using substring order.
- Upstream JSON is schema-validated before use.
- Errors are typed and sanitised.
- The package opens no network listener.
- The npm tarball is allowlisted and inspected before release.
- The private observer source, tests, and build output are absent from that
  tarball and never enter public MCP discovery.
