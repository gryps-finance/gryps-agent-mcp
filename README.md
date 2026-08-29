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
| `gryps_signal_stack` | Combine several agreeing signals honestly. Folds repeats of one source into a single signal, treats near-identical source names as one feed, and prevents correlated families from being counted as independent confirmations. |
| `gryps_margin_profile` | Where the position gets liquidated. Turns the venue published maintenance-margin ladder into the bracket, margin, leverage ceiling, and adverse move a size can absorb — and whether it survives long enough for the expected move to arrive. |
| `gryps_position_size` | How large. Bounded by the cost gate, the risk budget, the venue brackets, and survivability, reporting the largest size every constraint allows and naming the one that binds. |
| `gryps_funding_cost` | What holding costs, beside what entering costs. Over a long hold, carry can exceed the round trip entirely. |
| `gryps_route_compare` | Compare round-trip cost on Gryps against a public order-book venue priced by walking its live displayed depth. |
| `gryps_indicative_quote` | An indicative, non-firm execution estimate for one clip: oracle mid, estimated entry, and the all-in cost model. Derived, and labeled as such: the engine exposes no quote surface. |
| `gryps_reference_price` | The live Gryps oracle price next to an external fair-value mid, with divergence in bps. The anchor for oracle sanity checks and paper-session pricing. |
| `gryps_list_markets` | Browse the live v2 market catalogue with bounded search and pagination. Searches by common name (`bitcoin`, `matic`), and when nothing matches, names the nearest listed symbols as explicit guesses. |
| `gryps_get_market` | Resolve one exact symbol, common name, or unique base asset and return live price and leverage limits. Reports which route resolved it. |
| `gryps_measured_fees` | The median fee real fills actually paid, read from the settlement contract event log. A fill is a fact; a schedule is a claim. |
| `gryps_get_fee_schedule` | The engine-reported fee tier ladder. |
| `gryps_capabilities` | One call describing what the server answers, what it refuses, what it reads, and every known limitation with its consequence. |
| `gryps_next_step` | Ask what to do next. On a fresh install it returns one starting point rather than a catalogue, then routes the journey from there. |
| `gryps_prompt_library` | Browse 25 staged prompts by journey stage, experience level, purpose or free text. Each says what it does and why it matters. |
| `gryps_paper_session` | Rehearse trades against live prices with zero capital. Every close decomposes the result into price move versus friction paid. No order exists anywhere. |
| `gryps_venue_status` | API health, build version, and settlement identity checked against the chain and contract pinned in this package rather than relayed from the endpoint. |

All tools are annotated read-only and non-destructive. Every response uses a
versioned JSON envelope naming its live source, fetch time, and limitations.

## What an agent is told on connect

The server sends MCP `instructions` on initialize, so any client passes them to
the model as standing context without the user doing anything. They frame the
server as a cost gate rather than an idea source, point a new install at
`gryps_next_step`, and name the four ways an agent could mislead someone with
these tools.

The seven journey prompts are also exposed as native MCP prompts, so clients
that render prompts surface the guided path in their own interface. A tool has
to be invoked; a prompt is presented.

## Cost is not the only thing that stops a trade

A trade can clear its cost and still be a bad trade, and the venue publishes
enough to prove it. Every `risk-config` read returns a full maintenance-margin
ladder, so the same call that prices friction can also say where the position
stops existing.

On live BTC data, 150x leverage leaves roughly 27 basis points of room before
liquidation, and round-trip friction is 24 of them. Three basis points of actual
buffer, on a trade the cost gate alone would wave through. That is the gap
`gryps_margin_profile` and `gryps_position_size` close: the first says where the
position dies, the second says how large it can be before that becomes likely.

`gryps_funding_cost` closes the other one. Friction is charged twice and then
done; funding is charged the whole time the position is open. Holding a week can
cost several times the round trip this package has been gating on.

## The four honesty rules

These are structural, not stylistic. They are enforced by tests.

**Friction is a lower bound until spread is measured.** The engine reports fee
tiers. The public v2 engine exposes no bid/ask or depth surface at all — every
order-book, depth, ticker, and quote path was probed and returns 404 — so spread
is absent upstream rather than merely unwired here. `gryps_friction_floor`
therefore reports a *measured fee floor*, flags `isLowerBound: true`, carries
the probe result in `spreadSurface`, and says plainly that true friction is
higher. It is never presented as all-in friction.

**Fee direction is unverified, so both readings travel together.** The engine
does not state whether `totalFeeRateBps` is per side or a round trip, and the
answer is worth a factor of two. The headline number takes the conservative
per-side reading, and every response also carries the other one:
`gryps_friction_floor` returns `feeDirectionRange` with both round trips and
both break-even edges, and `gryps_edge_check` re-runs the gate against the
alternative and reports whether the verdict survives it. A verdict that flips
depending on an unresolved question is reported as not decidable from live data,
not as a decision. The flag is three-state: unset means unresolved,
`--fee-is-round-trip=true` and `=false` both mean an operator has confirmed the
basis, and the responses say which.

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
- It will not take an endpoint's word for what it is. The settlement chain and
  contract are pinned in this package and compared against what the engine
  reports, because a wrong or hostile endpoint describes itself with exactly the
  same confidence as the right one.
- It will not guess a symbol. Common names are rewritten through a curated alias
  table before exact matching, and near misses are returned as labelled
  suggestions. Neither ever resolves a market on your behalf by similarity.
- It will not trade, sign, hold assets, or read your account.

## Verify the boundary yourself

The read-only claim is only worth what a stranger can check. Every installed
copy audits itself:

```bash
npx -y gryps-agent-mcp@alpha --verify
```

It scans the JavaScript actually installed on your machine for the capabilities
this package promises never to have: transaction signing, private keys, wallet
clients, order placement, withdrawals, network listeners, environment
configuration, and subprocesses. It also lists every network destination present
in the shipped code, so you can see exactly where it is able to reach.

Add `--json` for machine-readable output. A failed audit exits non-zero, so a
pipeline can gate on it.

A pass is evidence about that version, not a promise about future ones, which is
why the check ships inside every version rather than living only in this
repository.

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
| `--fee-is-round-trip=` | Declare the fee basis once the protocol team confirms it. Unset means unresolved and both readings are reported; `true` roughly halves the reported floor; `false` confirms the per-side reading the server already assumes. |
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
