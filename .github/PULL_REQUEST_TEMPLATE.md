## What changed

<!-- One or two sentences. Link the roadmap item if this implements one. -->

## Boundary checklist

- [ ] The public tool allowlist (`PUBLIC_TOOL_NAMES`) is unchanged, or this PR explicitly says why it changed.
- [ ] No execution, signing, credential, or network-listener capability was added to the public package.
- [ ] Internal observer source stays out of the npm tarball (`npm run verify:package` passes).
- [ ] `npm run verify:release` passes locally.
- [ ] CHANGELOG.md updated if behaviour changed.
