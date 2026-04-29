import { ChainSwitchError, isUserRejectionError } from '../errors';
import { type SwapWalletClient, resolveChainId } from './walletClient';

/**
 * Best-effort cross-provider chain switch. Tries `wallet_switchEthereumChain`
 * (EIP-3326) over `request`, viem's `switchChain`, and the legacy `send`
 * fallback in that order. Returns `true` if the wallet is on the requested
 * chain after the call.
 *
 * Throws `ChainSwitchError` for any failure other than user rejection (which
 * surfaces a more specific message).
 */
export async function ChainSwitch(
  walletClient: SwapWalletClient,
  requiredChainId: number,
): Promise<boolean> {
  try {
    const currentChainId = await resolveChainId(walletClient);
    if (currentChainId === requiredChainId) return true;

    if (walletClient.request) {
      await walletClient.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${requiredChainId.toString(16)}` }],
      } as any);
    } else if (walletClient.switchChain) {
      await walletClient.switchChain({ id: requiredChainId });
    } else if (walletClient.send) {
      await walletClient.send('wallet_switchEthereumChain', [
        { chainId: `0x${requiredChainId.toString(16)}` },
      ]);
    } else {
      throw new ChainSwitchError("Wallet doesn't support chain switching");
    }

    const newChainId = await resolveChainId(walletClient);
    return newChainId === requiredChainId;
  } catch (error) {
    if (isUserRejectionError(error)) {
      throw new ChainSwitchError('User rejected the chain switch request');
    }
    if (error instanceof ChainSwitchError) throw error;
    throw new ChainSwitchError(
      `Please switch your wallet to the required network (Chain ID: ${requiredChainId})`,
    );
  }
}
