'use client';

import type { ReactNode } from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { arbitrum, base, mainnet, optimism } from 'viem/chains';

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

if (typeof window !== 'undefined' && !PRIVY_APP_ID) {
  // eslint-disable-next-line no-console
  console.warn(
    '[example] NEXT_PUBLIC_PRIVY_APP_ID is not set. Copy .env.example to .env.local and add your Privy App ID.',
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID ?? 'missing-app-id'}
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#FDB913',
          walletList: ['detected_wallets', 'metamask', 'rainbow', 'wallet_connect'],
        },
        loginMethods: ['email', 'wallet'],
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
        },
        defaultChain: base,
        supportedChains: [base, mainnet, arbitrum, optimism],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
