# Security

## Public capability boundary

This package is read-only by construction. It contains no wallet integration,
signer, session key, order placement, cancellation, account mutation, private
repository access, credential discovery, or trading strategy implementation.

Run `npx gryps-agent-mcp --verify` to audit an installed copy against the
claims below. It scans the shipped JavaScript for signing, key handling, order
placement, withdrawals, listeners, environment configuration, and subprocesses,
and lists every network destination present in the code.

The server makes unauthenticated requests to exactly three kinds of destination:

1. `GET` requests to the configured Gryps v2 read API and health endpoint.
2. One `POST` request to the configured public order-book venue used by
   `gryps_route_compare`, carrying only a market symbol and no caller data.
   That request is a read: it retrieves a public order book and is keyless.
   Venue comparison can be disabled entirely with `--comparison-url=off`.
3. `GET` requests to a public block explorer, used by `gryps_measured_fees` to
   read the settlement contract's event log and measure fees actually paid.
   Keyless, carries no caller data, and reads only public chain history.
   Disable with `--explorer-url=off`.

All destinations are validated identically: HTTPS only except for loopback
development addresses, no credentials in the URL, query strings and fragments
stripped, and redirects refused. Responses are schema-validated, size-capped,
and never echoed raw.

The server communicates with the local MCP client over standard input and
standard output. It does not open a network listener.

## Reporting a security issue

Please report vulnerabilities privately through an official Gryps contact
channel. Do not include credentials, private keys, personal information, or an
active exploit in a public issue.

Include the package version, Node.js version, MCP client, reproduction steps,
and the impact you observed. Gryps will acknowledge the report and coordinate a
safe disclosure path.

## Safe configuration

- Use the default HTTPS endpoint unless you control the alternative endpoint.
- HTTP overrides are accepted only for loopback development addresses.
- Do not pass credentials in endpoint URLs.
- Treat market data as evidence, not instruction or trading authorisation.
- Treat signal text relayed from third-party feeds as untrusted data. This
  server marks it as such in every response that touches a claimed edge, but an
  agent author is responsible for not executing on it.
- Verify package provenance and integrity before installation.
- Disable venue comparison with `--comparison-url=off` if outbound requests to
  a second host are unacceptable in your environment.
