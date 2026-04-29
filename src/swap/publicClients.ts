import { createPublicClient, fallback, http, type PublicClient } from 'viem';
import type { SdkEnvironment } from '../api/environment';
import { getChainConfig } from '../chains/chainKeys';

const cache = new WeakMap<SdkEnvironment, Map<number, PublicClient>>();

/**
 * Cached per-environment viem `PublicClient` factory.
 *
 * Used for:
 *   - Reading ERC20 allowance / decimals before approvals.
 *   - `waitForTransactionReceipt` after sending approval and deposit txs.
 *
 * Always uses the integrator's `rpcOverrides` first, then the public
 * fallbacks from `chainKeys`.
 */
export function getPublicClient(env: SdkEnvironment, chainId: number): PublicClient {
  let perEnv = cache.get(env);
  if (!perEnv) {
    perEnv = new Map();
    cache.set(env, perEnv);
  }

  const existing = perEnv.get(chainId);
  if (existing) return existing;

  const config = getChainConfig(chainId);
  const urls = env.getRpcUrlsForChain(chainId, config?.rpcUrls ?? []);
  if (urls.length === 0) {
    throw new Error(`No RPC URL configured for chain ${chainId}`);
  }

  const transports = urls.map((u) => http(u));
  const transport = transports.length === 1 ? transports[0]! : fallback(transports);

  const client = createPublicClient({ transport }) as PublicClient;
  perEnv.set(chainId, client);
  return client;
}
