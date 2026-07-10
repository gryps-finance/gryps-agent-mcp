/**
 * Gryps v1 (Orbs solver) adapter — READ-ONLY.
 * The only file in this package allowed to know the upstream API's shape.
 * When the drift sentinel reports schema change, this file absorbs it.
 *
 * No env-var reads (ADR-009): configuration is passed explicitly.
 */
import type { FundingSnapshot, MarketSummary, OpenInterestSnapshot, VenueAdapter } from './types.js';
export interface GrypsOrbsConfig {
    /** Solver registry base, e.g. the perps-streaming v1 root incl. chain + solver address. */
    solverBaseUrl: string;
    /** App-level solver API base (aggregated OI / funding endpoints). */
    appApiBaseUrl: string;
    timeoutMs?: number;
}
export declare class GrypsOrbsAdapter implements VenueAdapter {
    private readonly config;
    readonly venueId = "gryps-orbs-v1";
    readonly apiVersionPin = "2026-07-10";
    constructor(config: GrypsOrbsConfig);
    private get timeout();
    private mapSymbol;
    private rawSymbols;
    listMarkets(): Promise<MarketSummary[]>;
    getMarket(symbol: string): Promise<MarketSummary | null>;
    getFunding(symbol: string): Promise<FundingSnapshot | null>;
    getAggregatedOpenInterest(): Promise<OpenInterestSnapshot>;
}
