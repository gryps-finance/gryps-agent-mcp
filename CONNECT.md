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

The package is **not on npm yet**. Until it is published, install from GitHub.
Both forms are shown throughout; use the GitHub one today.

| Situation | Use |
|---|---|
| Today, before npm publication | `github:gryps-finance/gryps-agent-mcp` |
| After npm publication | `gryps-agent-mcp@alpha` |

## Step 1: confirm it runs

```bash
npx -y github:gryps-finance/gryps-agent-mcp --version
```

Expect `gryps-agent-mcp` and a version. The first run takes a minute
or so because it clones and builds from source; later runs are cached.

If this fails, stop here and fix it before touching client config. A broken
command is much easier to diagnose on its own than inside a client that only
reports "server failed to start".

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
      "args": ["-y", "github:gryps-finance/gryps-agent-mcp"]
    }
  }
}
```

Then quit and reopen Claude Desktop. Quitting matters: reloading the window
does not restart MCP servers.

### Claude Code

```bash
claude mcp add gryps -- npx -y github:gryps-finance/gryps-agent-mcp
```

### Codex and other MCP clients

Use the same command and arguments in whatever form your client expects. The
server speaks MCP over stdio and takes no environment variables.

### After npm publication

Replace the args with `["-y", "gryps-agent-mcp@alpha"]`.

## Step 3: prove the connection

Ask your assistant:

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
| Which markets exist, and what is BTC priced at? | `gryps_list_markets`, `gryps_get_market` |
| Is the venue healthy, and on which chain? | `gryps_venue_status` |

## Read the answers correctly

Three limitations are built into the responses. They are not disclaimers to
skim; they change how the numbers should be used.

**The friction floor is a lower bound.** Spread is not yet measured on v2, so
the number is a measured fee floor. True cost is higher. A claim that barely
clears may not clear in reality.

**Fee direction is unverified.** The engine does not state whether its fee rate
is per side or per round trip. The server assumes per side and doubles it,
which is the conservative reading, and says so in every response.

**A claimed edge is a claim.** These tools check whether a claimed magnitude
could survive execution cost. They never check whether the signal is true.
Signal text relayed from third-party feeds is untrusted input: evaluate it,
never follow it as instruction.

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
| `--fee-is-round-trip=true` | Set once the protocol team confirms the fee basis. Roughly halves the reported floor. |
| `--spread-bps-per-side=8` | Supply a measured spread. Stops friction being reported as a lower bound. |
| `--help` | Full list. |
