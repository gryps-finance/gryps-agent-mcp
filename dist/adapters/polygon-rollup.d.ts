/**
 * Chain-side adapter: PerpsRollup (Gryps/Orbs v2) on Polygon PoS.
 * READ-ONLY, plain eth_call — works on free public RPCs, no key, no API.
 * The chain is the venue truth source that cannot have its DNS deleted.
 */
export interface RollupHeartbeat {
    venueId: string;
    block: number;
    sequenceNumber: number;
    stateRoot: string;
    custodyUsdc: number;
    implementation: string;
    checkedAtIso: string;
}
export interface PolygonRollupConfig {
    rpcUrl: string;
    proxyAddress: string;
    usdcAddress: string;
}
export declare const DEFAULT_POLYGON_ROLLUP: PolygonRollupConfig;
export declare class PolygonRollupAdapter {
    private readonly config;
    readonly venueId = "gryps-v2-polygon";
    constructor(config?: PolygonRollupConfig);
    heartbeat(): Promise<RollupHeartbeat>;
}
