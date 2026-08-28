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
- MCP initialise and tool discovery return exactly the frozen read-only tool allowlist;
- the npm tarball contains only the allowlisted release files;
- a clean consumer install can start the packed MCP binary;
- the current live endpoint returns a healthy venue, listed markets, a canonical
  BTC price, and at least one fee tier.
- private observer source and output are absent from the public tarball.

## Human gate before the first npm publication

- [x] Confirm the package name `gryps-agent-mcp`.
- [x] Select the public source repository and add its URL to `package.json`.
- [ ] Confirm npm publisher permissions for the account doing the first publish.
- [ ] Confirm the MIT licence and copyright holder.
- [ ] Configure npm trusted publishing after the first publish.
- [ ] Review the packed tarball from the release commit.
- [ ] Test Claude Desktop and Codex from the packed tarball on clean profiles.
- [ ] Complete a security review of the public boundary and package.
- [ ] Confirm the friction lower-bound and fee-basis limitations remain visible
  in tool output and in the README.
- [ ] Confirm the landing-page install command matches the published name and
  dist-tag.
- [ ] Name a support and rollback owner for the alpha window.

## Publish the first version locally, then automate everything after

npm attaches a trusted publisher to an existing package, so trusted publishing
cannot be configured before the package exists. npm's interface redirects that
attempt into creating a Team, which is not what is needed.

The way through is a single local publish. It needs no token: `npm login`
authenticates interactively and answers 2FA at the prompt, which is exactly what
a CI runner cannot do. **Do not create a token with "Bypass two-factor
authentication" for this.** npm warns against it on the token page and is
restricting that token class; trusted publishing exists to replace it.

Provenance is requested by the workflow with an explicit `--provenance` flag
rather than in `publishConfig`, so a local publish is not blocked by it.

### One time, to create the package

```bash
npm login
npm publish --tag alpha
```

The first version ships without a provenance attestation. That is the only cost,
and it is acceptable for an alpha.

### Then switch to trusted publishing

1. On npmjs.com open the package settings, find **Trusted Publisher**, choose
   **GitHub Actions**.
2. Set organisation `gryps-finance`, repository `gryps-agent-mcp`, workflow
   filename `publish.yml`. Allow `npm publish`.

Every release after this runs through the Publish workflow, authenticates over
OIDC with no stored credential, and carries provenance.

### Running a release

Use the **Publish** workflow from the Actions tab.

- Leave `dry-run` checked first. That runs the full verification chain, packs
  the tarball, prints its contents, and stops without publishing.
- Re-run with `dry-run` unchecked to publish.
- Publishing a GitHub Release also triggers it, always under the `alpha` tag.

The workflow refuses to publish a version that already exists, and after a real
publish it installs the package from the registry and starts it, so a broken
release is caught immediately rather than by the first user.

## First publication

Publish the prerelease under the `alpha` tag. Do not make it `latest` during the
initial limited-access period. The workflow defaults to `alpha` for this reason.

The workflow already installs the published version from the registry and
starts it. After that, verify the npm package page shows the provenance
attestation and links to this repository, then enable the public site action.

## Rollback

Do not delete a published package version. If a material defect is found:

1. Deprecate the affected version with a specific reason.
2. Move the public install instructions back to the last verified version.
3. Publish a corrected prerelease with a new immutable version.
4. Record what happened and the evidence required to resume the alpha.
