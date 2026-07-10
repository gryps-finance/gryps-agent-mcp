/**
 * Chain-side adapter: PerpsRollup (Gryps/Orbs v2) on Polygon PoS.
 * READ-ONLY, plain eth_call — works on free public RPCs, no key, no API.
 * The chain is the venue truth source that cannot have its DNS deleted.
 */
export const DEFAULT_POLYGON_ROLLUP = {
    rpcUrl: 'https://polygon-bor-rpc.publicnode.com',
    proxyAddress: '0xc206B7725E6E6631516B4FEa100F8a07Bbc736Ee',
    usdcAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
};
// keccak256 selectors, precomputed from the verified ABI
const SEL_GET_ROOT = '0x8270482d'; // getCurrentRoot()
const SEL_GET_SEQ = '0x42af35fd'; // getSequenceNumber()
const SEL_BALANCE_OF = '0x70a08231'; // balanceOf(address)
const IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'; // EIP-1967
async function rpc(url, method, params) {
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'user-agent': 'gryps-agent-mcp/0.2',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json());
    if (body.error || body.result === undefined) {
        throw new Error(`RPC ${method}: ${JSON.stringify(body.error)}`);
    }
    return body.result;
}
export class PolygonRollupAdapter {
    config;
    venueId = 'gryps-v2-polygon';
    constructor(config = DEFAULT_POLYGON_ROLLUP) {
        this.config = config;
    }
    async heartbeat() {
        const { rpcUrl, proxyAddress, usdcAddress } = this.config;
        const call = (to, data) => rpc(rpcUrl, 'eth_call', [{ to, data }, 'latest']);
        const [root, seqHex, blockHex, balHex, implRaw] = await Promise.all([
            call(proxyAddress, SEL_GET_ROOT),
            call(proxyAddress, SEL_GET_SEQ),
            rpc(rpcUrl, 'eth_blockNumber', []),
            call(usdcAddress, SEL_BALANCE_OF + proxyAddress.slice(2).toLowerCase().padStart(64, '0')),
            rpc(rpcUrl, 'eth_getStorageAt', [proxyAddress, IMPL_SLOT, 'latest']),
        ]);
        return {
            venueId: this.venueId,
            block: parseInt(blockHex, 16),
            sequenceNumber: parseInt(seqHex, 16),
            stateRoot: root,
            custodyUsdc: Number(BigInt(balHex)) / 1e6,
            implementation: '0x' + implRaw.slice(-40),
            checkedAtIso: new Date().toISOString(),
        };
    }
}
