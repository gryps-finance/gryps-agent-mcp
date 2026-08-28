import assert from 'node:assert/strict'
import test from 'node:test'
import { EngineReadClient } from '../src/client.js'
import { PublicMcpError } from '../src/errors.js'
import { PublicReadService } from '../src/service.js'
import { MAX_OPEN_POSITIONS, PaperBook, closeNarration, type ClosedPaperPosition } from '../src/paper.js'
import { fixtureBodies, fixtureFetch, testConfig } from './fixtures.js'

/**
 * A service over a mutable price feed and a controllable clock, so a test can
 * move the oracle price and bust the read cache between calls.
 */
function paperHarness() {
  const priceBody = structuredClone(fixtureBodies['/api/v1/prices']) as {
    prices: Array<{ symbol: string; price: string; timestamp: number }>
  }
  let nowMs = 0
  const client = new EngineReadClient({
    config: testConfig,
    fetcher: fixtureFetch({ '/api/v1/prices': priceBody }),
    nowMs: () => nowMs,
    retryDelayMs: 0,
  })
  return {
    service: new PublicReadService(client),
    setBtcPriceRaw(raw: string) {
      const record = priceBody.prices.find((price) => price.symbol === 'BTCUSDT')
      assert.ok(record)
      record.price = raw
      nowMs += testConfig.cacheTtlMs + 1
    },
  }
}

test('open charges the open leg and marks entry at the oracle mid', async () => {
  const { service } = paperHarness()
  const response = await service.paperSession({ action: 'open', symbol: 'BTC', side: 'long', notionalUsd: 10_000 })
  assert.equal(response.data.action, 'open')
  const position = response.data.position
  assert.ok(position)
  assert.equal(position.symbol, 'BTCUSDT')
  assert.equal(position.entryPriceUsd, 79_620.6)
  assert.equal(position.openFrictionBps, 12)
  assert.equal(position.openFrictionUsd, 12)
  assert.match(response.meta.limitations.join(' '), /No order exists anywhere/)
})

test('a flat close realises exactly the round-trip friction as a loss', async () => {
  const { service } = paperHarness()
  const opened = await service.paperSession({ action: 'open', symbol: 'BTC', side: 'long', notionalUsd: 10_000 })
  const closed = await service.paperSession({ action: 'close', positionId: opened.data.position!.id })
  assert.equal(closed.data.action, 'close')
  const position = closed.data.position as ClosedPaperPosition
  assert.equal(position.pricePnlUsd, 0)
  assert.equal(position.frictionUsd, 24)
  assert.equal(position.netPnlUsd, -24)
  assert.match(closed.data.narration!, /friction/i)
  assert.match(closed.meta.limitations.join(' '), /lower bound/)
})

test('a favourable move decomposes into price gain minus friction', async () => {
  const { service, setBtcPriceRaw } = paperHarness()
  const opened = await service.paperSession({ action: 'open', symbol: 'BTC', side: 'long', notionalUsd: 10_000 })
  setBtcPriceRaw('80416806000')
  const closed = await service.paperSession({ action: 'close', positionId: opened.data.position!.id })
  const position = closed.data.position as ClosedPaperPosition
  assert.ok(Math.abs(position.pricePnlUsd - 100) < 1e-6)
  assert.equal(position.frictionUsd, 24)
  assert.ok(Math.abs(position.netPnlUsd - 76) < 1e-6)
  assert.equal(closed.data.totals!.closedPositions, 1)
  assert.ok(Math.abs(closed.data.totals!.realizedNetPnlUsd - 76) < 1e-6)
})

test('a short loses when the price rises', async () => {
  const { service, setBtcPriceRaw } = paperHarness()
  const opened = await service.paperSession({ action: 'open', symbol: 'BTC', side: 'short', notionalUsd: 10_000 })
  setBtcPriceRaw('80416806000')
  const closed = await service.paperSession({ action: 'close', positionId: opened.data.position!.id })
  const shortPosition = closed.data.position as ClosedPaperPosition
  assert.ok(Math.abs(shortPosition.pricePnlUsd - -100) < 1e-6)
  assert.ok(Math.abs(shortPosition.netPnlUsd - -124) < 1e-6)
})

test('status marks open positions and charges the pending close honestly', async () => {
  const { service } = paperHarness()
  await service.paperSession({ action: 'open', symbol: 'BTC', side: 'long', notionalUsd: 10_000 })
  const status = await service.paperSession({ action: 'status' })
  assert.equal(status.data.action, 'status')
  const [position] = status.data.openPositions!
  assert.ok(position)
  assert.equal(position.markStatus, 'marked')
  assert.equal(position.mark?.unrealizedPricePnlUsd, 0)
  assert.equal(position.mark?.pendingCloseFrictionUsd, 12)
  assert.equal(position.mark?.unrealizedNetPnlUsd, -24)
  assert.match(status.meta.limitations.join(' '), /flat price shows as a small loss/)
})

test('close of an unknown position is a typed not_found and changes nothing', async () => {
  const { service } = paperHarness()
  await assert.rejects(
    () => service.paperSession({ action: 'close', positionId: 'p99' }),
    (error: unknown) => error instanceof PublicMcpError && error.code === 'not_found',
  )
})

test('open without its required arguments is a typed invalid_request', async () => {
  const { service } = paperHarness()
  await assert.rejects(
    () => service.paperSession({ action: 'open', symbol: 'BTC' }),
    (error: unknown) => error instanceof PublicMcpError && error.code === 'invalid_request',
  )
})

test('reset discards state and reports what it discarded', async () => {
  const { service } = paperHarness()
  await service.paperSession({ action: 'open', symbol: 'BTC', side: 'long', notionalUsd: 10_000 })
  const reset = await service.paperSession({ action: 'reset' })
  assert.equal(reset.data.openDiscarded, 1)
  const status = await service.paperSession({ action: 'status' })
  assert.equal(status.data.openPositions!.length, 0)
  assert.equal(status.data.totals!.closedPositions, 0)
})

test('the book refuses to exceed the open-position cap', () => {
  const book = new PaperBook()
  for (let index = 0; index < MAX_OPEN_POSITIONS; index += 1) {
    book.open({
      symbol: 'BTCUSDT',
      side: 'long',
      notionalUsd: 100,
      entryPriceUsd: 100,
      entryAtIso: '2026-08-29T00:00:00Z',
      openFrictionBps: 12,
      openFrictionUsd: 0.12,
    })
  }
  assert.throws(
    () =>
      book.open({
        symbol: 'BTCUSDT',
        side: 'long',
        notionalUsd: 100,
        entryPriceUsd: 100,
        entryAtIso: '2026-08-29T00:00:00Z',
        openFrictionBps: 12,
        openFrictionUsd: 0.12,
      }),
    (error: unknown) => error instanceof PublicMcpError && error.code === 'invalid_request',
  )
})

test('narration names the venue lesson when friction eats a favourable move', () => {
  const narration = closeNarration({
    id: 'p1',
    symbol: 'BTCUSDT',
    side: 'long',
    notionalUsd: 10_000,
    entryPriceUsd: 100,
    entryAtIso: '2026-08-29T00:00:00Z',
    openFrictionBps: 12,
    openFrictionUsd: 12,
    exitPriceUsd: 100.1,
    closedAtIso: '2026-08-29T00:01:00Z',
    closeFrictionBps: 12,
    closeFrictionUsd: 12,
    pricePnlUsd: 10,
    frictionUsd: 24,
    netPnlUsd: -14,
  })
  assert.match(narration, /friction of \$24\.00 consumed it/i)
  assert.match(narration, /beat friction, not just be right/)
})
