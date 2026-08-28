# Gryps Agent MCP

**Checks whether a trading signal can survive execution reality before an agent acts.**

The AI tool shelf is saturated with reasons to trade: sentiment feeds, news
feeds, technical indicators, on-chain analytics, research summaries. It is
starved of anything that asks whether a claimed edge can pay for its own
execution. This server is that gate.

It reads live Gryps v2 market and venue data through the Model Context
Protocol, measures what a round trip actually costs, and tells an agent when a
trade is not worth making. It cannot place trades, sign messages, manage
session keys, read private accounts, or expose internal Gryps systems, and it
is built so that a routine upgrade can never quietly change that.

## Quick start

Requires Node.js 22.13 or later. See [CONNECT.md](CONNECT.md) for the full
two-minute setup, including client configuration and troubleshooting.

```bash
npx -y gryps-agent-mcp@alpha
```

To run the unreleased main branch instead: `npx -y github:gryps-finance/gryps-agent-mcp`.

Example MCP client configuration:

```json
{
  "mcpServers": {
    "gryps": {
      "command": "npx",
      "args": ["-y", "gryps-agent-mcp@alpha"]
    }
  }
}
```

Then ask your client:

> A sentiment feed says BTC is about to move 15 basis points. Use Gryps to
> check whether that clears the cost of trading it.

## What it does

| Tool | Purpose |
|---|---|
| `gryps_friction_floor` | The round-trip cost a trade must beat, decomposed into fees and spread with full provenance. The number that decides whether a trade is worth making. |
| `gryps_edge_check` | Cost-gate a claimed edge from any upstream signal source. Answers whether the claimed magnitude survives execution, never whether the signal is true. |
| `gryps_signal_stack` | Combine several agreeing signals honestly. Prevents correlated sources from being counted as independent confirmations. |
| `gryps_route_compare` | Compare round-trip cost on Gryps against a public order-book venue priced by walking its live displayed depth. |
| `gryps_indicative_quote` | An indicative, non-firm execution estimate for one clip: oracle mid, estimated entry, and the all-in cost model. Derived, and labeled as such: the engine exposes no quote surface. |
| `gryps_reference_price` | The live Gryps oracle price next to an external fair-value mid, with divergence in bps. The anchor for oracle sanity checks and paper-session pricing. |
| `gryps_list_markets` | Browse the live v2 market catalogue with bounded search and pagination. |
| `gryps_get_market` | Resolve one exact symbol or unique base asset and return live price and leverage limits. |
| `gryps_get_fee_schedule` | The engine-reported fee tier ladder. |
| `gryps_next_step` | Ask what to do next. On a fresh install it returns one starting point rather than a catalogue, then routes the journey from there. |
| `gryps_prompt_library` | Browse 25 staged prompts by journey stage, experience level, purpose or free text. Each says what it does and why it matters. |
| `gryps_venue_status` | API health, build version, settlement chain, and contract. |

All tools are annotated read-only and non-destructive. Every response uses a
versioned JSON envelope naming its live source, fetch time, and limitations.

## The four honesty rules

These are structural, not stylistic. They are enforced by tests.

**Friction is a lower bound until spread is measured.** The engine reports fee
tiers. Spread is not yet measured on v2, so `gryps_friction_floor` reports a
*measured fee floor*, flags `isLowerBound: true`, and says plainly that true
friction is higher. It is never presented as all-in friction.

**Fee direction is unverified.** The engine does not state whether
`totalFeeRateBps` is per side or a round trip. This server assumes per side and
doubles it, which is the conservative reading, and carries that assumption in
every response so it cannot be silently inherited. Once the protocol team
confirms, `--fee-is-round-trip=true` flips it. The assumption is material: it
roughly halves the reported floor.

**Third-party signal text is untrusted input.** A sentiment or news tool relays
text written by strangers. Every response that touches a claimed edge carries a
notice telling the model to treat that text as data to evaluate, never as
instruction to follow.

**A derived estimate is not a quote.** The public engine exposes no quote,
estimate, or preview endpoint. `gryps_indicative_quote` therefore builds its
estimate from the live oracle price plus measured friction, and says so:
`firm: false`, `quoteStatus: "derived"`, and `engineQuoteSurface: "absent"`.
An agent must not present it to a user as a price the venue offered.

## What it will not do

- It will not tell you a signal is true. It only checks whether the claimed
  magnitude could survive execution cost. Conflating those two questions is how
  confident agents lose money.
- It will not treat five agreeing sources as five confirmations. Correlated
  evidence inflates confidence without inflating edge, and confidence is what
  sets position size.
- It will not always say Gryps is cheaper. `gryps_route_compare` reports the
  other venue as cheaper when that is what the live numbers say.
- It will not repeat the engine market count as a fact. That count has not been
  reconciled with published documentation, so it is returned flagged as
  unpublishable rather than quoted.
- It will not trade, sign, hold assets, or read your account.

## Configuration

Configuration is explicit and never read from environment variables.

```bash
npx -y gryps-agent-mcp@alpha \
  --api-base=https://example.invalid/api/v1 \
  --health-url=https://example.invalid/health \
  --comparison-url=off \
  --spread-bps-per-side=8
```

| Flag | Effect |
|---|---|
| `--api-base=`, `--health-url=` | Override the Gryps read endpoints. HTTPS only, except loopback. |
| `--timeout-ms=`, `--cache-ttl-ms=` | Upstream request timeout and read cache TTL. |
| `--comparison-url=` | Order-book venue for `gryps_route_compare`. Use `off` to disable venue comparison entirely. |
| `--comparison-taker-fee-bps=` | Taker fee assumed for the comparison venue, per leg. An assumption, stated in every response. |
| `--fee-is-round-trip=true` | Set only once the protocol team confirms the engine reports a full round trip. |
| `--spread-bps-per-side=` | Supply an operator-measured spread. Doing so stops friction being reported as a lower bound. |
| `--help`, `--version` | Print usage or version and exit. |

Query strings and fragments are stripped from configured endpoints. Upstream
reads are cached briefly, deduplicated in flight, retried once on transient
failures, and rejected above 5 MB.

## Development

```bash
npm ci
npm run verify:release
npm run smoke:live
```

`verify:release` type-checks, tests, builds, exercises the MCP handshake, and
inspects the npm tarball allowlist. `smoke:live` separately verifies the live
endpoint, the friction floor, the cost gate, and venue comparison, because it
requires network access. CI runs the same chain on Linux and Windows plus a
nightly live-contract check for upstream drift.

See [CONNECT.md](CONNECT.md) to connect an agent in two minutes,
[ARCHITECTURE.md](ARCHITECTURE.md) for the capability split,
[SECURITY.md](SECURITY.md) for the defensive boundary and reporting path,
[RELEASE.md](RELEASE.md) for the publication gate,
[CONTRIBUTING.md](CONTRIBUTING.md) for the ground rules, and
[ROADMAP.md](ROADMAP.md) for the path from public read to supervised execution.

## Gryps-owned account observer

This repository also contains a private observer profile that reads one
wallet's account snapshot, portfolio, order history, and trades. It is excluded
from the public npm tarball and requires the wallet address to be fixed when
the process starts:

```bash
npm run verify:internal
npm run start:internal -- --account-address=0xYOUR_40_HEX_CHARACTER_ADDRESS
```

The observer cannot sign, submit, cancel, or withdraw. Its presence in the
source repository does not change the public package boundary.
