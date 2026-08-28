# Security

## Public capability boundary

This package is read-only by construction. It contains no wallet integration,
signer, session key, order placement, cancellation, account mutation, private
repository access, credential discovery, or trading strategy implementation.

The server makes unauthenticated `GET` requests only to the configured Gryps v2
read API. It communicates with the local MCP client over standard input and
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
- Verify package provenance and integrity before installation.
