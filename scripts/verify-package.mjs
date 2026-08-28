import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
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
  'BACKEND-INTEGRATION.md',
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
assert.ok(pack.unpackedSize < 300_000, `Package is unexpectedly large: ${pack.unpackedSize} bytes`)
process.stdout.write(`Package boundary passed: ${files.length} files, ${pack.unpackedSize} unpacked bytes.\n`)
