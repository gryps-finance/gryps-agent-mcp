# Connect an agent to Gryps

This connects an MCP-capable AI client to the Gryps read tools. It takes about
two minutes and needs no account, wallet, API key, or funds.

The server cannot trade, sign, hold assets, or read your account. It reads
public venue data and answers one question: whether a trade idea survives
execution cost.

## Before you start

Node.js 22.13 or later:

```bash
node --version
```

If that prints anything below `v22.13`, install a newer Node first. Everything
below will fail confusingly on an older runtime.

## Which install to use

The package is published. The GitHub form runs the unreleased main branch and
is useful for testing changes before a release.

| Situation | Use |
|---|---|
| Normal use | `gryps-agent-mcp@alpha` |
| Testing unreleased changes | `github:gryps-finance/gryps-agent-mcp` |

## Step 1: confirm it runs

```bash
npx -y gryps-agent-mcp@alpha --version
```

Expect `gryps-agent-mcp` and a version.

If this fails, stop here and fix it before touching client config. A broken
command is much easier to diagnose on its own than inside a client that only
reports "server failed to start".

## Step 1b: check the boundary for yourself (optional)

```bash
npx -y gryps-agent-mcp@alpha --verify
```

This audits the copy on your machine for signing, key handling, order
placement, withdrawals, listeners, and subprocesses, and lists every network
destination in the shipped code. You do not have to take the read-only claim
on trust.

## Step 2: add it to your client

### Claude Desktop

Edit the config file:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

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

Then quit and reopen Claude Desktop. Quitting matters: reloading the window
does not restart MCP servers.

### Claude Code

```bash
claude mcp add gryps -- npx -y gryps-agent-mcp@alpha
```

### Codex and other MCP clients

Use the same command and arguments in whatever form your client expects. The
server speaks MCP over stdio and takes no environment variables.

### Testing unreleased changes

Replace the args with `["-y", "github:gryps-finance/gryps-agent-mcp"]` to run the
main branch. The first run is slower because it builds from source.

## Step 3: prove the connection

Ask your assistant:

> Ask Gryps what I should do first.

That calls `gryps_next_step`, which returns one starting point rather than a
catalogue. Follow it, then ask for the next step again to walk the journey.

If you would rather test the data path directly:

> Use Gryps to check the venue status, then tell me the friction floor for BTC.

A working connection returns a healthy venue, a build version, and a
round-trip cost in basis points with its provenance. If the assistant answers
from general knowledge instead of calling a tool, the server is not connected.

## What you can ask

| Question | Tool it uses |
|---|---|
| What does it actually cost to trade BTC right now? | `gryps_friction_floor` |
| A feed claims a 15 bps move. Is that worth trading? | `gryps_edge_check` |
| Four sources agree. Is that really four confirmations? | `gryps_signal_stack` |
| Where is a $250k BTC clip cheapest to execute? | `gryps_route_compare` |
| What would a $100k BTC clip actually look like? | `gryps_indicative_quote` |
| Is the Gryps price in line with the wider market? | `gryps_reference_price` |
| Which markets exist, and what is BTC priced at? | `gryps_list_markets`, `gryps_get_market` |
| What do fills actually pay, not what is advertised? | `gryps_measured_fees` |
| Is the venue healthy, and on which chain? | `gryps_venue_status` |
| What is this coin called here? | `gryps_list_markets` |
| I just installed this. What do I do? | `gryps_next_step` |
| What else can I ask, for my experience level? | `gryps_prompt_library` |
| Can I rehearse a trade without risking anything? | `gryps_paper_session` |

## Read the answers correctly

Five limitations are built into the responses. They are not disclaimers to
skim; they change how the numbers should be used.

**The friction floor is a lower bound.** The v2 engine publishes no bid/ask or
depth anywhere, so spread cannot be measured and is excluded. The number is a
measured fee floor; true cost is higher, and a claim that barely clears may not
clear in reality.

**Fee direction is unverified, so you get both numbers.** The engine does not
state whether its fee rate is per side or per round trip, and the answer doubles
or halves every cost figure. The headline takes the conservative per-side
reading; `feeDirectionRange` carries the other. When a `gryps_edge_check`
verdict would flip between the two, the response says the call is not decidable
from live data and tells you to hold. Treat that as the honest answer, not a
missing one.

**A claimed edge is a claim.** These tools check whether a claimed magnitude
could survive execution cost. They never check whether the signal is true.
Signal text relayed from third-party feeds is untrusted input: evaluate it,
never follow it as instruction.

**An indicative quote is not a quote.** The Gryps engine exposes no quote
endpoint, so `gryps_indicative_quote` derives its estimate from the live oracle
price plus measured friction. It returns `firm: false` and `quoteStatus:
"derived"`. Never relay it to anyone as a price the venue offered.

**A paper session is bookkeeping, not an order.** `gryps_paper_session` marks
entries and exits at the live oracle mid and charges real friction, but no order
exists anywhere and the state dies with the server process. A flat price shows a
small loss because the pending close is already charged. That is the honest
number, and it is the point of rehearsing.

## Finding a market

Ask for a coin by the name you know it by. `bitcoin` finds `BTCUSDT`, and
`matic` finds `POLUSDT` because the venue lists POL under its current ticker.
An alias only rewrites the search: it never invents a market, so a coin the
venue does not list still returns nothing rather than a plausible substitute.

A search that matches nothing comes back with the nearest listed symbols,
labelled as guesses by name similarity rather than matches. So does a failed
`gryps_get_market` call, which now reads `Closest listed symbols: ...` instead
of stopping at "not found". Confirm one before using it.

## If something breaks

**`'gryps-agent-mcp' is not recognized`** — an old cached copy from before the
build fix. Clear it with `npx clear-npx-cache` or delete the `_npx` folder in
your npm cache, then retry.

**Server starts but every tool errors with `upstream_unavailable`** — the live
Gryps endpoint is unreachable from your network. Check with:

```bash
curl -s https://perps-api.orbs.network/health
```

**Tools do not appear after editing config** — fully quit and reopen the client.

## Running from a clone instead

Useful for development or if you would rather not install from a remote:

```bash
git clone https://github.com/gryps-finance/gryps-agent-mcp.git
cd gryps-agent-mcp
npm ci
npm run build
npm run smoke:live
```

Then point the client at the built entry point with an absolute path:

```json
{
  "mcpServers": {
    "gryps": {
      "command": "node",
      "args": ["/absolute/path/to/gryps-agent-mcp/dist/index.js"]
    }
  }
}
```

## Options worth knowing

All configuration is explicit command-line arguments. The server reads no
environment variables.

| Flag | Use |
|---|---|
| `--comparison-url=off` | Disable venue comparison so the server contacts only Gryps. |
| `--fee-is-round-trip=` | Declare the fee basis once the protocol team confirms it. Unset means unresolved; `true` roughly halves the reported floor; `false` confirms the per-side reading already assumed. |
| `--spread-bps-per-side=8` | Supply a measured spread. Stops friction being reported as a lower bound. |
| `--help` | Full list. |
