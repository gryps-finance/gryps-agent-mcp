import assert from 'node:assert/strict'
import test from 'node:test'
import { EngineReadClient } from '../src/client.js'
import { PublicReadService } from '../src/service.js'
import { bookMid, comparisonCoin, walkBook, type L2Book } from '../src/router.js'
import { comparisonBook, fixtureFetch, testConfig } from './fixtures.js'

const book: L2Book = {
  symbol: 'BTCUSDT',
  bids: [
    { price: 100, size: 1 },
    { price: 99, size: 100 },
  ],
  asks: [
    { price: 101, size: 1 },
    { price: 102, size: 100 },
  ],
}

test('maps a canonical symbol to the comparison venue coin', () => {
  assert.equal(comparisonCoin('BTCUSDT'), 'BTC')
  assert.equal(comparisonCoin('ETHUSDC'), 'ETH')
  assert.equal(comparisonCoin('BTC'), 'BTC')
})

test('walks the book and charges more impact for a larger clip', () => {
  assert.equal(bookMid(book), 100.5)
  const small = walkBook(book, 'buy', 50)
  const large = walkBook(book, 'buy', 5_000)
  assert.ok(small && large)
  assert.ok(large.impactBps > small.impactBps)
  assert.equal(small.exhausted, false)
})

test('reports exhaustion rather than pretending the book absorbed the clip', () => {
  const huge = walkBook(book, 'buy', 1_000_000)
  assert.ok(huge)
  assert.equal(huge.exhausted, true)
  assert.ok(huge.filledNotionalUsd < 1_000_000)
})

function serviceWith(comparisonResponder: (url: string) => Response | null) {
  const base = fixtureFetch()
  const fetcher: typeof fetch = async (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const override = comparisonResponder(raw)
    if (override) return override
    return base(input, init)
  }
  return new PublicReadService(
    new EngineReadClient({ config: testConfig, fetcher, retryDelayMs: 0 }),
    {
      comparisonUrl: testConfig.comparisonUrl,
      comparisonTakerFeeBps: testConfig.comparisonTakerFeeBps,
      feeIsRoundTrip: false,
      spreadBpsPerSide: undefined,
      timeoutMs: 1_000,
      fetcher,
    },
  )
}

test('ranks both venues and names the cheaper one', async () => {
  const service = serviceWith((url) =>
    url.startsWith('https://book.example.test')
      ? new Response(JSON.stringify(comparisonBook), { status: 200 })
      : null,
  )
  const response = await service.routeCompare({ symbol: 'BTC', side: 'long', notionalUsd: 10_000 })
  assert.equal(response.status, 'ok')
  assert.equal(response.data.venues.length, 2)
  assert.ok(response.data.cheapest)
  assert.equal(typeof response.data.spreadBetweenVenuesBps, 'number')
  assert.match(response.meta.limitations.join(' '), /Displayed book liquidity is not the same as executable liquidity/)
})

test('degrades to the Gryps side alone when the comparison venue is unreachable', async () => {
  const service = serviceWith((url) =>
    url.startsWith('https://book.example.test') ? new Response('gateway down', { status: 502 }) : null,
  )
  const response = await service.routeCompare({ symbol: 'BTC', side: 'long', notionalUsd: 10_000 })
  assert.equal(response.status, 'ok')
  assert.equal(response.data.cheapest, 'gryps-v2')
  assert.match(response.data.venues[1]!.note, /unreachable/)
})

test('treats an unlisted comparison market as a real routing outcome', async () => {
  const service = serviceWith((url) =>
    url.startsWith('https://book.example.test') ? new Response('null', { status: 200 }) : null,
  )
  const response = await service.routeCompare({ symbol: 'BTC', side: 'long', notionalUsd: 10_000 })
  assert.equal(response.data.venues[1]!.eligible, false)
  assert.match(response.data.venues[1]!.note, /not listed/)
})

test('explains when the comparison venue is ranked out for depth, not price', async () => {
  const thinBook = {
    levels: [
      [{ px: '79600', sz: '0.01' }],
      [{ px: '79650', sz: '0.01' }],
    ],
  }
  const service = serviceWith((url) =>
    url.startsWith('https://book.example.test')
      ? new Response(JSON.stringify(thinBook), { status: 200 })
      : null,
  )
  const response = await service.routeCompare({ symbol: 'BTC', side: 'long', notionalUsd: 5_000_000 })
  const comparison = response.data.venues[1]!
  assert.equal(comparison.exhausted, true)
  assert.equal(comparison.eligible, false)
  assert.equal(response.data.cheapest, 'gryps-v2')
  assert.match(response.data.narration, /displayed book ran out|indicative and not executable/)
  assert.match(
    response.meta.limitations.join(' '),
    /ranked out because its displayed depth could not fill the clip/,
  )
})
