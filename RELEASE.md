# Release Contract

## Automated gate

Run:

```bash
npm ci
npm run verify:release
npm run smoke:live
```

The automated gate must prove:

- strict TypeScript passes;
- all unit and public-boundary tests pass;
- the production build succeeds;
- MCP initialise and tool discovery return exactly four read-only tools;
- the npm tarball contains only the allowlisted release files;
- a clean consumer install can start the packed MCP binary;
- the current live endpoint returns a healthy venue, listed markets, a canonical
  BTC price, and at least one fee tier.
- private observer source and output are absent from the public tarball.

## Human gate before the first npm publication

- [x] Confirm the package name `@gryps/agent-mcp`.
- [x] Select the public source repository and add its URL to `package.json`.
- [ ] Confirm the `@gryps` npm organisation and publisher permissions.
- [ ] Confirm the MIT licence and copyright holder.
- [ ] Configure npm trusted publishing or an approved granular token with 2FA.
- [ ] Review the packed tarball from the release commit.
- [ ] Test Claude Desktop and Codex from the packed tarball on clean profiles.
- [ ] Complete a security review of the public boundary and package.
- [ ] Confirm the friction lower-bound and fee-basis limitations remain visible
  in tool output and in the README.
- [ ] Confirm the landing-page install command matches the published name and
  dist-tag.
- [ ] Name a support and rollback owner for the alpha window.

## First publication

Publish the prerelease under the `alpha` tag. Do not make it `latest` during the
initial limited-access period.

```bash
npm publish --tag alpha --access public --provenance
```

After publication, install by exact version in a clean directory, repeat the
MCP smoke test, and verify the npm package page before enabling the public site
action.

## Rollback

Do not delete a published package version. If a material defect is found:

1. Deprecate the affected version with a specific reason.
2. Move the public install instructions back to the last verified version.
3. Publish a corrected prerelease with a new immutable version.
4. Record what happened and the evidence required to resume the alpha.
