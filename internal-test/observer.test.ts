import assert from 'node:assert/strict'
import test from 'node:test'
import { AccountReadClient } from '../internal-src/client.js'
import { ObserverConfigurationError, parseObserverConfig, type ObserverConfig } from '../internal-src/config.js'
import { INTERNAL_OBSERVER_TOOLS } from '../internal-src/server.js'

const address = '0x0000000000000000000000000000000000000001'
const config: ObserverConfig = {
  accountAddress: address,
  apiBase: 'https://example.test/api/v1',
  timeoutMs: 1_000,
  cacheTtlMs: 5_000,
}

const fetcher: typeof fetch = async (input) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url)
  const suffix = url.pathname.split(`/user/${address}`)[1]
  const body = suffix === ''
    ? { user: { address, balance: '1000000', nonce: 2 }, positions: [], pendingOrders: [], pendingWithdrawals: [] }
    : suffix === '/portfolio'
      ? { userAddress: address, totalEquity: '1000000' }
      : suffix === '/orders/history'
        ? { orders: [], total: 0, limit: 20, offset: 0 }
        : { trades: [], total: 0, limit: 20, offset: 0 }
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

test('requires one fixed EVM account address', () => {
  assert.throws(
    () => parseObserverConfig([]),
    (error: unknown) => error instanceof ObserverConfigurationError,
  )
  assert.equal(parseObserverConfig([`--account-address=${address}`]).accountAddress, address)
})

test('maps all four live account-read contracts', async () => {
  const client = new AccountReadClient(config, fetcher)
  const [snapshot, portfolio, orders, trades] = await Promise.all([
    client.snapshot(),
    client.portfolio(),
    client.orders(20, 0),
    client.trades(20, 0),
  ])
  assert.equal(snapshot.user.address, address)
  assert.equal(portfolio.userAddress, address)
  assert.equal(orders.total, 0)
  assert.equal(trades.total, 0)
})

test('clamps pagination bounds before they reach the upstream URL', async () => {
  const requested: string[] = []
  const recordingFetcher: typeof fetch = async (input, init) => {
    requested.push(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url)
    return fetcher(input, init)
  }
  const client = new AccountReadClient(config, recordingFetcher)
  await client.orders(10_000, -5)
  assert.match(requested[0] ?? '', /limit=100&offset=0$/)
})

test('observer discovery is fixed to account reads and contains no write tool', () => {
  assert.deepEqual([...INTERNAL_OBSERVER_TOOLS], [
    'gryps_account_snapshot',
    'gryps_account_portfolio',
    'gryps_account_order_history',
    'gryps_account_trades',
  ])
  assert.doesNotMatch(INTERNAL_OBSERVER_TOOLS.join(' '), /order_(place|cancel)|withdraw|sign|execute/i)
})
