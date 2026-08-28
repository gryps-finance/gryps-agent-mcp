/**
 * Paper session bookkeeping. Pure state and arithmetic; no I/O.
 *
 * A paper position is a ledger entry in this process and nothing else. No
 * order exists anywhere, and the state dies with the process. The point is
 * rehearsal: every close decomposes the result into price move and friction
 * paid, so the venue's real lesson (friction dominates small edges) is
 * experienced with zero capital instead of learned with real money.
 */

import { PublicMcpError } from './errors.js'

export const MAX_OPEN_POSITIONS = 20
export const MAX_CLOSED_RETAINED = 200

export interface PaperPosition {
  id: string
  symbol: string
  side: 'long' | 'short'
  notionalUsd: number
  entryPriceUsd: number
  entryAtIso: string
  openFrictionBps: number
  openFrictionUsd: number
}

export interface ClosedPaperPosition extends PaperPosition {
  exitPriceUsd: number
  closedAtIso: string
  closeFrictionBps: number
  closeFrictionUsd: number
  pricePnlUsd: number
  frictionUsd: number
  netPnlUsd: number
}

export interface PaperTotals {
  openPositions: number
  closedPositions: number
  realizedPricePnlUsd: number
  realizedFrictionUsd: number
  realizedNetPnlUsd: number
}

export class PaperBook {
  private readonly openById = new Map<string, PaperPosition>()
  private closedPositions: ClosedPaperPosition[] = []
  private sequence = 0

  open(entry: Omit<PaperPosition, 'id'>): PaperPosition {
    if (this.openById.size >= MAX_OPEN_POSITIONS) {
      throw new PublicMcpError(
        'invalid_request',
        `The paper session already holds ${MAX_OPEN_POSITIONS} open positions. Close some before opening more.`,
      )
    }
    this.sequence += 1
    const position = { ...entry, id: `p${this.sequence}` }
    this.openById.set(position.id, position)
    return position
  }

  close(
    positionId: string,
    exit: { exitPriceUsd: number; closeFrictionBps: number; closedAtIso: string },
  ): ClosedPaperPosition {
    const position = this.openById.get(positionId)
    if (!position) {
      throw new PublicMcpError(
        'not_found',
        `No open paper position "${positionId}". Use action "status" to list open positions.`,
      )
    }
    this.openById.delete(positionId)

    const sideSign = position.side === 'long' ? 1 : -1
    const pricePnlUsd =
      sideSign * ((exit.exitPriceUsd - position.entryPriceUsd) / position.entryPriceUsd) * position.notionalUsd
    const closeFrictionUsd = (position.notionalUsd * exit.closeFrictionBps) / 10_000
    const frictionUsd = position.openFrictionUsd + closeFrictionUsd

    const closed: ClosedPaperPosition = {
      ...position,
      exitPriceUsd: exit.exitPriceUsd,
      closedAtIso: exit.closedAtIso,
      closeFrictionBps: exit.closeFrictionBps,
      closeFrictionUsd,
      pricePnlUsd,
      frictionUsd,
      netPnlUsd: pricePnlUsd - frictionUsd,
    }
    this.closedPositions.push(closed)
    if (this.closedPositions.length > MAX_CLOSED_RETAINED) {
      this.closedPositions = this.closedPositions.slice(-MAX_CLOSED_RETAINED)
    }
    return closed
  }

  openPositions(): PaperPosition[] {
    return [...this.openById.values()]
  }

  closed(): ClosedPaperPosition[] {
    return [...this.closedPositions]
  }

  totals(): PaperTotals {
    let price = 0
    let friction = 0
    for (const position of this.closedPositions) {
      price += position.pricePnlUsd
      friction += position.frictionUsd
    }
    return {
      openPositions: this.openById.size,
      closedPositions: this.closedPositions.length,
      realizedPricePnlUsd: price,
      realizedFrictionUsd: friction,
      realizedNetPnlUsd: price - friction,
    }
  }

  reset(): { openDiscarded: number; closedDiscarded: number } {
    const discarded = { openDiscarded: this.openById.size, closedDiscarded: this.closedPositions.length }
    this.openById.clear()
    this.closedPositions = []
    return discarded
  }
}

/** The honest sentence a close deserves, stated from the decomposition. */
export function closeNarration(closed: ClosedPaperPosition): string {
  const price = closed.pricePnlUsd
  const friction = closed.frictionUsd
  const net = closed.netPnlUsd
  const fmt = (value: number) => `$${Math.abs(value).toFixed(2)}`
  if (net >= 0) {
    return (
      `Net ${fmt(net)} gain: the price move earned ${fmt(price)} and friction took ${fmt(friction)}. ` +
      'A rehearsal win is not evidence the edge repeats.'
    )
  }
  if (price > 0) {
    return (
      `Net ${fmt(net)} loss despite a favourable ${fmt(price)} price move: friction of ${fmt(friction)} consumed it. ` +
      'This is the venue lesson: an edge must beat friction, not just be right.'
    )
  }
  return (
    `Net ${fmt(net)} loss: ${fmt(price)} adverse price move plus ${fmt(friction)} friction. ` +
    'Both the direction and the cost worked against this position.'
  )
}
