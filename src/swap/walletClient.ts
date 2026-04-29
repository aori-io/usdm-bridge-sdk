import type { WalletClient } from 'viem';

/**
 * Loose superset of viem's `WalletClient` that captures the optional fields the
 * widget already relies on for chain switching across providers (RainbowKit,
 * AppKit, MetaMask injected, etc.).
 *
 * The ethers adapter implements this same shape so `executeSwap` can stay
 * lib-agnostic.
 */
export type SwapWalletClient = WalletClient & {
  switchChain?: (args: { id: number }) => Promise<void>;
  send?: (method: string, params: unknown[]) => Promise<unknown>;
  getChainId?: () => number | Promise<number>;
};

export async function resolveChainId(
  walletClient: SwapWalletClient,
): Promise<number | null> {
  if (walletClient.chain?.id) return walletClient.chain.id;
  const result = walletClient.getChainId?.();
  if (result != null) return await result;
  return null;
}
