import { z } from 'zod'

const integerString = z.string().regex(/^-?\d+$/)

export const accountSnapshotSchema = z
  .object({
    user: z
      .object({
        address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
        balance: integerString,
        nonce: z.number().int().nonnegative(),
        feeTier: z.number().int().nonnegative().optional(),
      })
      .passthrough(),
    positions: z.array(z.object({ symbol: z.string().min(1) }).passthrough()),
    pendingOrders: z.array(z.unknown()),
    pendingWithdrawals: z.array(z.unknown()),
  })
  .passthrough()

export const portfolioSchema = z
  .object({
    userAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  })
  .passthrough()

export const ordersSchema = z
  .object({
    orders: z.array(z.unknown()),
    total: z.number().int().nonnegative(),
    limit: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
  })
  .passthrough()

export const tradesSchema = z
  .object({
    trades: z.array(z.unknown()),
    total: z.number().int().nonnegative(),
    limit: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
  })
  .passthrough()

export type AccountSnapshot = z.infer<typeof accountSnapshotSchema>
export type Portfolio = z.infer<typeof portfolioSchema>
export type OrdersPage = z.infer<typeof ordersSchema>
export type TradesPage = z.infer<typeof tradesSchema>
