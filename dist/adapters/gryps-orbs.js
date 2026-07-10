/**
 * Gryps v1 (Orbs solver) adapter — READ-ONLY.
 * The only file in this package allowed to know the upstream API's shape.
 * When the drift sentinel reports schema change, this file absorbs it.
 *
 * No env-var reads (ADR-009): configuration is passed explicitly.
 */
async function getJson(url, timeoutMs) {
    const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
        throw new Error(`GET ${url} -> ${res.status}`);
    }
    return res.json();
}
export class GrypsOrbsAdapter {
    config;
    venueId = 'gryps-orbs-v1';
    apiVersionPin = '2026-07-10'; // last sentinel-verified snapshot
    constructor(config) {
        this.config = config;
    }
    get timeout() {
        return this.config.timeoutMs ?? 15_000;
    }
    mapSymbol(raw) {
        return {
            symbol: raw.symbol,
            name: raw.name,
            isValid: raw.is_valid,
            rfqAllowed: raw.rfq_allowed,
            maxLeverage: raw.max_leverage,
            minNotionalUsd: raw.min_notional_value,
            maxNotionalUsd: raw.max_notional_value,
            tradingFee: Number(raw.trading_fee),
            hedgerFeeOpen: Number(raw.hedger_fee_open),
            hedgerFeeClose: Number(raw.hedger_fee_close),
            fundingEpochMs: raw.funding_rate_epoch_duration_ms,
            categories: raw.cats_binance ?? [],
        };
    }
    async rawSymbols() {
        const data = await getJson(`${this.config.solverBaseUrl}/contract-symbols`, this.timeout);
        const arr = Array.isArray(data)
            ? data
            : (data.symbols ?? []);
        return arr;
    }
    async listMarkets() {
        const raw = await this.rawSymbols();
        return raw.map((r) => this.mapSymbol(r));
    }
    async getMarket(symbol) {
        const all = await this.listMarkets();
        const s = symbol.toUpperCase();
        return (all.find((m) => m.symbol === s || m.name === s || m.name === `${s}USDT`) ??
            null);
    }
    async getFunding(symbol) {
        const raw = await this.rawSymbols();
        const s = symbol.toUpperCase();
        const hit = raw.find((r) => r.symbol === s || r.name === `${s}USDT`);
        if (!hit)
            return null;
        return {
            symbol: hit.symbol,
            fundingEpochMs: hit.funding_rate_epoch_duration_ms,
            maxFundingRate: hit.max_funding_rate,
        };
    }
    async getAggregatedOpenInterest() {
        const raw = await getJson(`${this.config.appApiBaseUrl}/solver/aggregatedOpenInterest?chainId=0`, this.timeout);
        return { raw, fetchedAtIso: new Date().toISOString() };
    }
}
