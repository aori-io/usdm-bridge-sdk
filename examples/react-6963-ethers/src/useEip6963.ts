import { useCallback, useEffect, useState } from 'react';
import type { Eip1193Provider, Eip6963ProviderInfo } from 'ethers';

// ── EIP-6963 (Multi Injected Provider Discovery) ───────────────────────────
//
// EIP-6963 lets every installed browser wallet announce itself via a window
// event instead of fighting over `window.ethereum`. The page does:
//
//   window.dispatchEvent(new Event('eip6963:requestProvider'))
//
// and each wallet replies with:
//
//   window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
//     detail: { info: { uuid, name, icon, rdns }, provider }
//   }))
//
// This hook collects those announcements, lets you pick one, calls
// `eth_requestAccounts` on it, and then exposes the raw EIP-1193 provider so
// the caller can wrap it in an `ethers.BrowserProvider` and hand the
// resulting signer to `ethersSignerToWalletClient` from
// `@aori/usdm-bridge-sdk/ethers`.
//
// Both the EIP-1193 and EIP-6963 types are re-exported from `ethers` itself
// (`Eip1193Provider`, `Eip6963ProviderInfo`), so we use them directly instead
// of hand-rolling local copies. That keeps the type that flows out of this
// hook structurally identical to what `new BrowserProvider(provider)` wants.
//
// Spec: https://eips.ethereum.org/EIPS/eip-6963

/**
 * EIP-1193 provider plus the optional event-emitter methods every modern
 * injected wallet exposes for `accountsChanged` / `chainChanged`. Ethers'
 * `Eip1193Provider` only types `request`, so we widen it locally.
 */
export type Eip1193ProviderWithEvents = Eip1193Provider & {
  on?: (event: string, listener: (...args: any[]) => void) => void;
  removeListener?: (event: string, listener: (...args: any[]) => void) => void;
};

export interface Eip6963ProviderDetail {
  info: Eip6963ProviderInfo;
  provider: Eip1193ProviderWithEvents;
}

interface AnnounceProviderEvent extends CustomEvent<Eip6963ProviderDetail> {
  type: 'eip6963:announceProvider';
}

declare global {
  interface WindowEventMap {
    'eip6963:announceProvider': AnnounceProviderEvent;
  }
}

export interface Eip6963State {
  /** Every wallet that has announced itself so far. */
  providers: Eip6963ProviderDetail[];
  /** The wallet the user picked, or null. */
  selected: Eip6963ProviderDetail | null;
  /** Currently selected account (lowercased 0x string). */
  account: `0x${string}` | null;
  /** Decimal chain id reported by the wallet, or null. */
  chainId: number | null;
  /** Open the wallet's connection prompt, then mark it as selected. */
  connect: (detail: Eip6963ProviderDetail) => Promise<void>;
  /** Forget the selected wallet. (Wallets generally don't expose a programmatic disconnect.) */
  disconnect: () => void;
}

export function useEip6963(): Eip6963State {
  const [providers, setProviders] = useState<Eip6963ProviderDetail[]>([]);
  const [selected, setSelected] = useState<Eip6963ProviderDetail | null>(null);
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);

  // Discovery: collect every wallet that announces itself, then ask again
  // (some wallets only reply to a fresh request).
  //
  // Note: ethers v6 also ships `BrowserProvider.discover(...)` which does the
  // same dance and returns a single picked provider. We don't use it because
  // the demo wants to render a button per wallet — discovery here, picker
  // logic in App.tsx.
  useEffect(() => {
    function onAnnounce(event: AnnounceProviderEvent) {
      const detail = event.detail;
      setProviders((prev) =>
        prev.some((p) => p.info.uuid === detail.info.uuid) ? prev : [...prev, detail],
      );
    }
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    return () => window.removeEventListener('eip6963:announceProvider', onAnnounce);
  }, []);

  // Subscribe to account & chain changes on the selected provider so the UI
  // (and the ethers Signer we hand the SDK) stay in sync if the user switches
  // accounts or networks from the wallet popup directly.
  useEffect(() => {
    if (!selected) return;
    const provider = selected.provider;

    const handleAccountsChanged = (accs: string[]) => {
      const next = (accs?.[0] as `0x${string}` | undefined) ?? null;
      setAccount(next);
      if (!next) setSelected(null);
    };
    const handleChainChanged = (hex: string) => {
      setChainId(parseInt(hex, 16));
    };

    provider.on?.('accountsChanged', handleAccountsChanged);
    provider.on?.('chainChanged', handleChainChanged);
    return () => {
      provider.removeListener?.('accountsChanged', handleAccountsChanged);
      provider.removeListener?.('chainChanged', handleChainChanged);
    };
  }, [selected]);

  const connect = useCallback(async (detail: Eip6963ProviderDetail) => {
    const provider = detail.provider;
    const accounts = (await provider.request({
      method: 'eth_requestAccounts',
    })) as `0x${string}`[];
    const chainHex = (await provider.request({ method: 'eth_chainId' })) as string;

    setSelected(detail);
    setAccount((accounts[0] as `0x${string}` | undefined) ?? null);
    setChainId(parseInt(chainHex, 16));
  }, []);

  const disconnect = useCallback(() => {
    setSelected(null);
    setAccount(null);
    setChainId(null);
  }, []);

  return { providers, selected, account, chainId, connect, disconnect };
}
