import { useCallback, useEffect, useState } from 'react';
import type { EIP1193Provider } from 'viem';

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
// `eth_requestAccounts` on it, and then exposes the EIP-1193 provider so the
// caller can wrap it in a viem `WalletClient` and hand it to the SDK.
//
// Spec: https://eips.ethereum.org/EIPS/eip-6963

export interface Eip6963ProviderInfo {
  uuid: string;
  name: string;
  /** data: URL with the wallet logo. */
  icon: string;
  /** Reverse-DNS identifier, e.g. "io.metamask". */
  rdns: string;
}

export interface Eip6963ProviderDetail {
  info: Eip6963ProviderInfo;
  provider: EIP1193Provider;
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
  // (and the WalletClient we hand the SDK) stay in sync if the user switches
  // accounts or networks from the wallet popup directly.
  useEffect(() => {
    if (!selected) return;
    const provider = selected.provider as EIP1193Provider & {
      on?: (event: string, handler: (...args: any[]) => void) => void;
      removeListener?: (event: string, handler: (...args: any[]) => void) => void;
    };

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
