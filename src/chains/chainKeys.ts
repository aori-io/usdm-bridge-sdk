/**
 * Minimal chain registry distilled from the widget's `chainsConfig.ts`.
 *
 * Only the fields needed by the SDK are tracked: the LayerZero chain key (used
 * in API request bodies), default public RPC URLs (used as fallback when the
 * integrator doesn't override), and `blockTimeMs` (used to delay status polling
 * after a native deposit, mirroring the widget behavior).
 */

export interface SdkChainConfig {
  id: number;
  /** LayerZero VT API chain key (sent in /quotes request bodies). */
  key: string;
  /** Public RPC fallbacks. Integrators should override via `rpcOverrides`. */
  rpcUrls: string[];
  /** Approximate block time, used to delay status polling after a deposit tx. */
  blockTimeMs: number;
}

export const CHAINS: Record<number, SdkChainConfig> = {
  1: {
    id: 1,
    key: 'ethereum',
    rpcUrls: [
      'https://ethereum.publicnode.com',
      'https://eth.llamarpc.com',
      'https://eth.drpc.org',
      'https://rpc.eth.gateway.fm',
    ],
    blockTimeMs: 5_000,
  },
  10: {
    id: 10,
    key: 'optimism',
    rpcUrls: [
      'https://mainnet.optimism.io',
      'https://optimism.llamarpc.com',
      'https://optimism.drpc.org',
    ],
    blockTimeMs: 2_000,
  },
  30: {
    id: 30,
    key: 'rootstock',
    rpcUrls: ['https://public-node.rsk.co'],
    blockTimeMs: 30_000,
  },
  56: {
    id: 56,
    key: 'bsc',
    rpcUrls: ['https://bsc-dataseed1.binance.org', 'https://bsc.drpc.org'],
    blockTimeMs: 2_000,
  },
  143: {
    id: 143,
    key: 'monad',
    rpcUrls: [
      'https://rpc.monad.xyz',
      'https://rpc1.monad.xyz',
      'https://rpc2.monad.xyz',
      'https://rpc3.monad.xyz',
    ],
    blockTimeMs: 1_000,
  },
  988: {
    id: 988,
    key: 'stable',
    rpcUrls: ['https://rpc.stable.xyz'],
    blockTimeMs: 1_000,
  },
  4326: {
    id: 4326,
    key: 'megaeth',
    rpcUrls: ['https://mainnet.megaeth.com/rpc', 'https://megaeth.drpc.org'],
    blockTimeMs: 1_000,
  },
  8453: {
    id: 8453,
    key: 'base',
    rpcUrls: [
      'https://mainnet.base.org',
      'https://base.llamarpc.com',
      'https://base.drpc.org',
    ],
    blockTimeMs: 2_000,
  },
  9745: {
    id: 9745,
    key: 'plasma',
    rpcUrls: ['https://rpc.plasma.to', 'https://9745.rpc.thirdweb.com'],
    blockTimeMs: 1_000,
  },
  42161: {
    id: 42161,
    key: 'arbitrum',
    rpcUrls: [
      'https://arb1.arbitrum.io/rpc',
      'https://arbitrum.llamarpc.com',
      'https://arbitrum.drpc.org',
    ],
    blockTimeMs: 250,
  },
};

const KEY_TO_ID: Record<string, number> = Object.values(CHAINS).reduce(
  (acc, cfg) => {
    acc[cfg.key] = cfg.id;
    return acc;
  },
  {} as Record<string, number>,
);

export function getChainConfig(chainId: number): SdkChainConfig | undefined {
  return CHAINS[chainId];
}

export function chainIdToKey(chainId: number): string | undefined {
  return CHAINS[chainId]?.key;
}

export function keyToChainId(key: string): number | undefined {
  return KEY_TO_ID[key];
}

export const SUPPORTED_CHAIN_IDS = Object.keys(CHAINS).map(Number);
