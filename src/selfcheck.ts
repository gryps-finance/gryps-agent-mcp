/**
 * Self-audit of the installed package.
 *
 * The read-only claim is worth little if the only proof lives in a repository
 * the reader does not have. An external reviewer holding just the npm tarball
 * previously had to take the boundary on trust, which was fair criticism.
 *
 * This runs against the files actually installed on disk, not the source tree
 * and not a description of them. It reads its own shipped JavaScript, looks for
 * the capabilities the package promises never to have, and prints what it
 * found. A user runs it with `npx gryps-agent-mcp --verify` and needs no clone,
 * no toolchain, and no reason to believe us.
 *
 * A passing result is evidence, not proof: it shows this installed copy
 * contains no signing, ordering, credential, or listener code, which is the
 * specific claim made. It cannot speak for a future version, which is why the
 * check ships in every one.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PACKAGE_NAME, PACKAGE_VERSION, PUBLIC_TOOL_NAMES } from './constants.js'

interface Probe {
  id: string
  claim: string
  pattern: RegExp
}

/**
 * Each probe is one capability the package says it does not have. The patterns
 * target the shipped JavaScript, so they name runtime shapes rather than
 * TypeScript types that compile away to nothing.
 */
const FORBIDDEN_CAPABILITIES: Probe[] = [
  { id: 'no-transaction-signing', claim: 'Cannot sign transactions or typed data.', pattern: /signTypedData|_signTypedData|eth_signTransaction|personal_sign\b/ },
  { id: 'no-private-keys', claim: 'Handles no private keys or mnemonics.', pattern: /privateKey|PRIVATE_KEY|mnemonic|seedPhrase/ },
  { id: 'no-wallet-client', claim: 'Embeds no wallet or signer client.', pattern: /walletClient|new Wallet\(|ethers\.Wallet|WalletProvider/ },
  { id: 'no-order-placement', claim: 'Places, cancels, or modifies no orders.', pattern: /placeOrder|cancelOrder|submitOrder|createOrder|closePosition\(/ },
  { id: 'no-withdrawals', claim: 'Moves no funds.', pattern: /withdraw\(|requestWithdraw|transferFrom\(/ },
  { id: 'no-network-listener', claim: 'Opens no network listener.', pattern: /\.listen\(|createServer\(|new WebSocketServer/ },
  { id: 'no-env-configuration', claim: 'Reads no environment variables for configuration.', pattern: /process\.env\.[A-Z_]{2,}/ },
  { id: 'no-child-processes', claim: 'Spawns no child processes.', pattern: /child_process|execSync|spawnSync\(/ },
]

/** Non-GET verbs are allowed only for the documented public order-book read. */
const EXPECTED_NON_GET = /method:\s*'POST'/

export interface SelfCheckResult {
  package: string
  version: string
  installedFrom: string
  filesScanned: number
  bytesScanned: number
  toolsRegistered: readonly string[]
  checks: { id: string; claim: string; passed: boolean; foundIn: string[] }[]
  networkDestinations: string[]
  passed: boolean
  interpretation: string
}

function shippedFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.js')) out.push(path)
    }
  }
  walk(root)
  return out
}

/**
 * @param rootOverride Audit a different directory. Used by tests to prove the
 * check can fail; a real run always audits the installed package itself.
 */
export function runSelfCheck(rootOverride?: string): SelfCheckResult {
  const root = rootOverride ?? fileURLToPath(new URL('.', import.meta.url))
  const files = shippedFiles(root)

  let bytes = 0
  const contents = new Map<string, string>()
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    bytes += text.length
    // Root may or may not carry a trailing separator depending on how it was
    // derived, so normalise rather than assuming.
    const relative = file.slice(root.length).replace(/\\/g, '/').replace(/^\//, '')
    contents.set(relative, text)
  }

  const checks = FORBIDDEN_CAPABILITIES.map((probe) => {
    const foundIn: string[] = []
    for (const [name, text] of contents) {
      // The probe list itself necessarily contains these words.
      if (name.startsWith('selfcheck')) continue
      if (probe.pattern.test(text)) foundIn.push(name)
    }
    return { id: probe.id, claim: probe.claim, passed: foundIn.length === 0, foundIn }
  })

  // Every https URL literal the shipped code can reach.
  const destinations = new Set<string>()
  for (const [name, text] of contents) {
    if (name.startsWith('selfcheck')) continue
    for (const match of text.matchAll(/https:\/\/[a-z0-9.-]+/gi)) destinations.add(match[0])
  }

  const passed = checks.every((check) => check.passed)
  const usesPost = [...contents].some(([name, text]) => !name.startsWith('selfcheck') && EXPECTED_NON_GET.test(text))

  return {
    package: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    installedFrom: root,
    filesScanned: files.length,
    bytesScanned: bytes,
    toolsRegistered: PUBLIC_TOOL_NAMES,
    checks,
    networkDestinations: [...destinations].sort(),
    passed,
    interpretation: passed
      ? 'This installed copy contains no signing, key handling, order placement, withdrawal, listener, environment-configuration, or subprocess code. ' +
        (usesPost
          ? 'It issues one documented POST, to the public order-book venue used for cost comparison, which is a read. '
          : '') +
        'That is evidence about this version only. The check ships in every version so it can be repeated.'
      : 'At least one capability this package promises not to have was found in the installed files. Treat the read-only claim as unverified and report this.',
  }
}

export function formatSelfCheck(result: SelfCheckResult): string {
  const lines: string[] = [
    `${result.package} ${result.version}`,
    `installed at ${result.installedFrom}`,
    `scanned ${result.filesScanned} shipped files, ${result.bytesScanned.toLocaleString('en-US')} bytes`,
    '',
    'Capability checks (each is something this package promises not to do):',
  ]
  for (const check of result.checks) {
    lines.push(`  ${check.passed ? 'PASS' : 'FAIL'}  ${check.claim}`)
    if (!check.passed) lines.push(`        found in: ${check.foundIn.join(', ')}`)
  }
  lines.push('', `Network destinations in shipped code (${result.networkDestinations.length}):`)
  for (const destination of result.networkDestinations) lines.push(`  ${destination}`)
  lines.push('', `Tools registered: ${result.toolsRegistered.length}`)
  for (const tool of result.toolsRegistered) lines.push(`  ${tool}`)
  lines.push('', result.passed ? 'RESULT: PASS' : 'RESULT: FAIL', '', result.interpretation, '')
  return lines.join('\n')
}
