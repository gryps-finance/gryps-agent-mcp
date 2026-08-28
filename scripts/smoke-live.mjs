import assert from 'node:assert/strict'
import { defaultConfig } from '../dist/config.js'
import { EngineReadClient } from '../dist/client.js'
import { PublicReadService } from '../dist/service.js'

const service = new PublicReadService(new EngineReadClient({ config: defaultConfig() }))
const [status, btc, fees] = await Promise.all([
  service.venueStatus(),
  service.getMarket({ symbol: 'BTC' }),
  service.getFeeSchedule(),
])

assert.equal(status.status, 'ok')
assert.equal(status.data.service.status, 'healthy')
assert.ok(status.data.listedMarkets > 0)
assert.equal(btc.data.market.symbol, 'BTCUSDT')
assert.ok((btc.data.price?.usd ?? 0) > 0)
assert.ok(fees.data.tiers.length > 0)

process.stdout.write(
  `Live smoke passed: ${status.data.listedMarkets} listed markets, ${btc.data.market.symbol} ${btc.data.price.usd} USD, engine ${status.data.service.version}.\n`,
)
