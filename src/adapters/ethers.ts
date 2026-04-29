import { createWalletClient, custom, type Chain } from 'viem';
import type { SwapWalletClient } from '../swap/walletClient';

/**
 * Structural shape of an ethers v6 `Signer` (with provider) that this adapter
 * needs. Matches `ethers.Signer` and `ethers.JsonRpcSigner` without forcing a
 * runtime import — `ethers` stays an optional peer dependency.
 */
export interface EthersSignerLike {
  getAddress(): Promise<string>;
  provider: EthersProviderLike | null;
  sendTransaction(tx: {
    to?: string;
    data?: string;
    value?: bigint | string;
    gasLimit?: bigint | string;
    gasPrice?: bigint | string;
    chainId?: number | bigint;
  }): Promise<{ hash: string }>;
  signTypedData(
    domain: Record<string, unknown>,
    types: Record<string, unknown>,
    value: Record<string, unknown>,
  ): Promise<string>;
}

export interface EthersProviderLike {
  getNetwork(): Promise<{ chainId: bigint | number }>;
  /**
   * EIP-1193-style escape hatch present on `BrowserProvider` and
   * `JsonRpcProvider`. Used for chain switching and any non-standard methods
   * we don't intercept.
   */
  send?(method: string, params: unknown[]): Promise<unknown>;
}

/**
 * Wraps an ethers v6 `Signer` in a viem-compatible `WalletClient` so it can be
 * passed straight to `sdk.executeSwap` (or any of the low-level primitives).
 *
 * The bridge implements just enough of EIP-1193 for the SDK's actual call
 * sites: `eth_sendTransaction`, `eth_signTypedData_v4`, `eth_chainId`,
 * `eth_accounts`, and `wallet_switchEthereumChain`. Any other method is
 * forwarded to `signer.provider.send` when available.
 */
export async function ethersSignerToWalletClient(
  signer: EthersSignerLike,
  options?: {
    /** Cached address. Skips the initial `signer.getAddress()` round-trip. */
    address?: `0x${string}`;
    /** Pre-resolved chain (id only is enough). */
    chain?: { id: number; name?: string };
  },
): Promise<SwapWalletClient> {
  const address = (options?.address ?? ((await signer.getAddress()) as `0x${string}`));

  let chainId: number;
  if (options?.chain?.id) {
    chainId = options.chain.id;
  } else if (signer.provider) {
    const network = await signer.provider.getNetwork();
    chainId = Number(network.chainId);
  } else {
    throw new Error('ethersSignerToWalletClient: signer has no provider and no chain.id was passed');
  }

  const eip1193 = {
    request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      switch (method) {
        case 'eth_accounts':
        case 'eth_requestAccounts':
          return [address];

        case 'eth_chainId':
          return `0x${chainId.toString(16)}`;

        case 'eth_sendTransaction': {
          const tx = ((params ?? [])[0] ?? {}) as {
            to?: string;
            data?: string;
            value?: string;
            gas?: string;
            gasPrice?: string;
          };
          const sent = await signer.sendTransaction({
            ...(tx.to ? { to: tx.to } : {}),
            ...(tx.data ? { data: tx.data } : {}),
            ...(tx.value ? { value: BigInt(tx.value) } : {}),
            ...(tx.gas ? { gasLimit: BigInt(tx.gas) } : {}),
            ...(tx.gasPrice ? { gasPrice: BigInt(tx.gasPrice) } : {}),
          });
          return sent.hash;
        }

        case 'eth_signTypedData_v4': {
          const [, payload] = (params ?? []) as [unknown, string | object];
          const parsed = (typeof payload === 'string' ? JSON.parse(payload) : payload) as {
            domain: Record<string, unknown>;
            types: Record<string, unknown>;
            message: Record<string, unknown>;
          };
          // ethers v6 rejects the EIP712Domain entry; viem includes it in the
          // serialized payload. Strip it before delegating.
          const { EIP712Domain: _omit, ...types } = parsed.types as Record<string, unknown>;
          return signer.signTypedData(parsed.domain, types, parsed.message);
        }

        case 'wallet_switchEthereumChain': {
          if (signer.provider?.send) {
            const result = await signer.provider.send(method, (params ?? []) as unknown[]);
            const next = ((params ?? [])[0] as { chainId?: string } | undefined)?.chainId;
            if (next) chainId = parseInt(next, 16);
            return result;
          }
          throw new Error('Provider does not support wallet_switchEthereumChain');
        }

        default: {
          if (signer.provider?.send) {
            return signer.provider.send(method, (params ?? []) as unknown[]);
          }
          throw new Error(`Unsupported RPC method via ethers adapter: ${method}`);
        }
      }
    },
  };

  const chain: Chain = (options?.chain && {
    id: options.chain.id,
    name: options.chain.name ?? `chain-${options.chain.id}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [] } },
  }) ?? {
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [] } },
  };

  const walletClient = createWalletClient({
    account: address,
    chain,
    transport: custom(eip1193),
  });

  return walletClient as SwapWalletClient;
}
