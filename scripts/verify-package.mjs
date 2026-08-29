import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const npmCli = process.env.npm_execpath
assert.ok(npmCli, 'npm_execpath is required for package verification')
const output = execFileSync(process.execPath, [npmCli, 'pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  encoding: 'utf8',
  env: { ...process.env, npm_config_update_notifier: 'false' },
})
const [pack] = JSON.parse(output)
assert.ok(pack)
const files = pack.files.map((file) => file.path)
for (const required of [
  'package.json',
  'README.md',
  'SECURITY.md',
  'ARCHITECTURE.md',
  'RELEASE.md',
  'CHANGELOG.md',
  'LICENSE',
  'dist/index.js',
]) {
  assert.ok(files.includes(required), `Packed artifact is missing ${required}`)
}
for (const path of files) {
  assert.doesNotMatch(path, /^(src|test|scripts|node_modules|\.npm-cache)\//)
  assert.doesNotMatch(path, /(write|signer|private-key|engineWire)/i)
}
/**
 * A ceiling on accidental inclusion, not a budget. The real boundary checks are
 * the path and content assertions above; this one exists to catch node_modules
 * or a stray build directory sneaking into the tarball. Raised from 300k when
 * the package grew from four tools to thirteen plus the prompt library, and
 * from 400k when chain fee measurement and the self-audit landed. Roughly a
 * third of the current size is source maps, which ship deliberately so a
 * reader can trace shipped behaviour back to source. The download is a
 * quarter of this figure.
 *
 * Raise it when real growth trips it; investigate when it jumps.
 */
assert.ok(pack.unpackedSize < 500_000, `Package is unexpectedly large: ${pack.unpackedSize} bytes`)

/**
 * Founders-internal readiness content must never ship. Publishing an assessment
 * of what the backend cannot yet do is a disclosure decision, not a docs
 * decision, so it is enforced here rather than left to review.
 */
const FORBIDDEN_CONTENT = [
  /backend owner/i,
  /\bSLO\b/,
  /incident path/i,
  /staging access/i,
  /session-key (registration|drill)/i,
  /G1[-–]G6/,
  /\$50[-–]100/,
  /supervised live/i,
  /engineWire/,
  /Mango/,
]
const shippedDocs = files.filter((path) => path.endsWith('.md'))
for (const doc of shippedDocs) {
  const text = readFileSync(fileURLToPath(new URL(`../${doc}`, import.meta.url)), 'utf8')
  for (const pattern of FORBIDDEN_CONTENT) {
    assert.doesNotMatch(text, pattern, `${doc} contains founders-internal content matching ${pattern}`)
  }
}

process.stdout.write(
  `Package boundary passed: ${files.length} files, ${pack.unpackedSize} unpacked bytes, ` +
    `${shippedDocs.length} shipped docs clean of internal content.\n`,
)
