# gryps-agent-mcp — agent notes

Public read-only MCP server (stdio) for live Gryps v2 market/venue data, plus a
private single-account observer profile that never ships in the npm tarball.

## Hard invariants — do not "improve" these away

- `PUBLIC_TOOL_NAMES` is a frozen four-tool allowlist with boundary tests.
- The public package must never gain execution, signing, credentials, env-var
  configuration, or a network listener. Execution belongs in a separate package
  (see ROADMAP.md §5).
- `internal-src/`, `internal-test/`, `internal-dist/` must stay out of the npm
  tarball (`npm run verify:package` proves it).
- stdout belongs to the stdio MCP transport. Diagnostics go to stderr only.
- Symbol resolution is exact-match only; substring guessing is refused by design.

## Layout

- `src/` public server: config → client (HTTP+cache+retry) → service (envelopes) → server (MCP tools).
- `internal-src/` observer: same shape, one wallet address fixed at process start.
- `scripts/` release verification (`npm run verify:release` chains all of it).

## Verification

`npm run verify:release` must pass before any commit lands on main.
`npm run smoke:live` needs network access; it is not part of CI PR gates.
Style: no semicolons, single quotes, explicit `.js` on relative imports.
