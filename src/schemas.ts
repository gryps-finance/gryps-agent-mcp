import { z } from 'zod'

export const healthSchema = z
  .object({
    build: z.string().min(1),
    gitCommit: z.string().optional(),
    status: z.string().min(1),
    timestamp: z.string().min(1),
    version: z.string().min(1),
  })
  .strip()

export const configSchema = z
  .object({
    chainId: z.union([z.number(), z.string()]),
    contractAddress: z.string().min(1).optional(),
    contract: z.string().min(1).optional(),
    usdcAddress: z.string().min(1).optional(),
  })
  .passthrough()

export const marketSchema = z
  .object({
    symbol: z.string().min(1),
    baseAsset: z.string().min(1),
    quoteAsset: z.string().min(1),
    displayName: z.string().min(1),
    pricePrecision: z.number().int().min(0).max(30),
    quantityPrecision: z.number().int().min(0).max(30),
  })
  .strip()

export const marketsResponseSchema = z.union([
  z.array(marketSchema),
  z.object({ markets: z.array(marketSchema) }).strip(),
])

export const priceSchema = z
  .object({
    symbol: z.string().min(1),
    price: z.string().regex(/^\d+$/),
    timestamp: z.number().int().min(1_577_836_800_000).max(4_102_444_800_000),
  })
  .strip()

export const pricesResponseSchema = z
  .object({ prices: z.array(priceSchema) })
  .strip()

/**
 * The market-data surface. Found while probing the engine for a bid/ask
 * surface: it has no book, but it does carry the funding rate, which is the
 * holding cost this package used to ignore.
 */
export const marketDataSchema = z
  .object({
    symbol: z.string().min(1),
    fundingRate: z.union([z.string(), z.number()]),
    nextFundingTime: z.number().int().min(1_577_836_800_000).max(4_102_444_800_000),
    updatedAt: z.number().int().min(1_577_836_800_000).max(4_102_444_800_000),
    markPrice: z.union([z.string(), z.number()]).optional(),
    volume24h: z.union([z.string(), z.number()]).optional(),
  })
  .strip()

export const marketDataResponseSchema = z.union([
  z.array(marketDataSchema),
  z.object({ markets: z.array(marketDataSchema) }).strip(),
])

export const maintenanceBracketSchema = z
  .object({
    maxNotional: z.string().regex(/^\d+$/),
    mmrBps: z.number().int().nonnegative(),
    cum: z.string().regex(/^\d+$/),
    maxLeverage: z.number().positive(),
  })
  .strip()

export const symbolRiskSchema = z
  .object({
    defaultLeverage: z.number().positive(),
    maxLeverage: z.number().positive(),
    mmBrackets: z.array(maintenanceBracketSchema),
  })
  .strip()

export const feeTierSchema = z
  .object({
    tierLevel: z.number().int().nonnegative(),
    totalFeeRateBps: z.number().nonnegative(),
  })
  .strip()

export const riskConfigSchema = z
  .object({
    symbols: z.record(z.string(), symbolRiskSchema),
    feeTiers: z.array(feeTierSchema),
  })
  .strip()

export type HealthResponse = z.infer<typeof healthSchema>
export type ConfigResponse = z.infer<typeof configSchema>
export type MarketRecord = z.infer<typeof marketSchema>
export type PriceRecord = z.infer<typeof priceSchema>
export type RiskConfig = z.infer<typeof riskConfigSchema>
export type SymbolRisk = z.infer<typeof symbolRiskSchema>
export type MaintenanceBracket = z.infer<typeof maintenanceBracketSchema>
export type MarketDataRecord = z.infer<typeof marketDataSchema>
export type FeeTier = z.infer<typeof feeTierSchema>
