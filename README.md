# Gryps Agent MCP

Public, read-only access to live Gryps v2 market and venue data through the
Model Context Protocol (MCP).

This alpha lets a compatible AI client inspect the venue before any account,
wallet, or trading authority is involved. It does not place trades, sign
messages, manage session keys, read private accounts, or expose internal Gryps
systems.

## Quick start

Requires Node.js 22.13 or later.

Run once with npm:

```bash
npx -y @gryps/agent-mcp@alpha
```

Example MCP client configuration:

```json
{
  "mcpServers": {
    "gryps": {
      "command": "npx",
      "args": ["-y", "@gryps/agent-mcp@alpha"]
    }
  }
}
```

After the client reconnects, ask:

> Use Gryps to check venue status, then show me the current BTC market record.

## Public tools

| Tool | Purpose |
|---|---|
| `gryps_list_markets` | Browse the live v2 market catalogue with bounded search and pagination. |
| `gryps_get_market` | Resolve one exact symbol or unique base asset and return its current price and leverage limits. |
| `gryps_get_fee_schedule` | Read the engine-reported fee tiers with the unresolved fee-basis limitation stated explicitly. |
| `gryps_venue_status` | Check API health, build version, settlement chain, contract, and listed market count. |

All tools are annotated as read-only and non-destructive. Every response uses a
versioned JSON envelope and names its live source, fetch time, and limitations.

## Important limitations

- A listed market is not a promise that an executable quote is available.
- Prices are decoded from the v2 engine's 1e6 fixed-point representation.
- `totalFeeRateBps` is reported exactly as supplied by the engine. Whether that
  value is per side or round trip remains unverified in this alpha.
- Market data can be delayed, unavailable, or incorrect. It is not investment
  advice or trade authorisation.
- This package has no HTTP server. The alpha uses local stdio transport only.

## Explicit endpoint configuration

The default read API is `https://perps-api.orbs.network/api/v1`. Configuration
is explicit and does not read environment variables:

```bash
npx -y @gryps/agent-mcp@alpha \
  --api-base=https://example.invalid/api/v1 \
  --health-url=https://example.invalid/health
```

Only HTTPS endpoints are accepted, except for loopback development addresses.
Query strings and fragments are stripped from configured endpoints. `--help`
and `--version` print usage and identity without starting the server.

Upstream reads are cached briefly, deduplicated in flight, retried once on
transient failures (network errors, HTTP 429/5xx), and rejected when a
response body exceeds 5 MB.

## Architecture and execution upgrade

The exported read client and service are stable building blocks for Gryps-owned
internal runtimes. Future execution capability should be installed and enabled
as a separate, explicit component with its own signer, mandate, reconciliation,
and revocation boundary. A routine upgrade of this public package must never
silently add trading authority.

## Development

```bash
npm ci
npm run verify:release
npm run smoke:live
```

`verify:release` type-checks, tests, builds, exercises the MCP handshake, and
inspects the npm tarball allowlist. `smoke:live` separately verifies the current
public endpoint because it requires network access.

Continuous integration runs the same verification chain on Linux and Windows,
plus a nightly live-contract check against the public endpoint to detect
upstream API drift.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the capability split,
[BACKEND-INTEGRATION.md](BACKEND-INTEGRATION.md) for the verified backend map,
[RELEASE.md](RELEASE.md) for the publication gate,
[SECURITY.md](SECURITY.md) for the defensive boundary and reporting path,
[CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and ground rules, and
[ROADMAP.md](ROADMAP.md) for the path from public read to supervised agentic
trading.

## Gryps-owned account observer

This repository also contains a private observer profile that reads one wallet's
account snapshot, portfolio, order history, and trades. It is deliberately
excluded from the public npm tarball and requires the wallet address to be fixed
when the process starts:

```bash
npm run verify:internal
npm run smoke:internal
npm run start:internal -- --account-address=0xYOUR_40_HEX_CHARACTER_ADDRESS
```

The observer cannot sign, submit, cancel, or withdraw. Its presence in the
source repository does not change the four-tool public package boundary.
