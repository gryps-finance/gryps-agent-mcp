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

- [x] Confirm the package name `@gryps.finance/agent-mcp`.
- [x] Select the public source repository and add its URL to `package.json`.
- [ ] Confirm the `gryps.finance` npm organisation and publisher permissions.
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

## Publishing is automated and cannot be done locally

npm only accepts provenance generated on a cloud runner from a public
repository. Because `publishConfig.provenance` is `true`, a local
`npm publish` fails by design. Publication runs through
`.github/workflows/publish.yml` using npm trusted publishing (OIDC), so no npm
token is stored in this repository.

### The first publish needs a token, later ones do not

npm attaches a trusted publisher to an existing package, so the setting cannot
be configured before the package exists. The npm interface tends to redirect
that attempt into creating a Team, which is not what is needed.

Break the loop by authenticating the first publish with a token. Provenance is
still produced, because provenance depends on running on a cloud runner from a
public repository, not on how the publish authenticated.

1. On npmjs.com create a **Granular Access Token**, scoped to the
   `gryps.finance` organisation with **Read and write** packages permission and
   a short expiry.
2. In this repository add it as the Actions secret `NPM_TOKEN`
   (Settings, Secrets and variables, Actions).
3. Run the Publish workflow with `dry-run` unchecked. The package now exists.
4. On npmjs.com open the package settings, find **Trusted Publisher**, choose
   **GitHub Actions**, and set organisation `gryps-finance`, repository
   `gryps-agent-mcp`, workflow filename `publish.yml`. Allow `npm publish`.
5. **Delete the `NPM_TOKEN` secret and revoke the token.** Every later release
   authenticates over OIDC with no stored credential.

The workflow supports both paths with no edits: it uses the token when the
secret is present and OIDC when it is not.

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
