import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'USDC (Base) → USDM (MegaETH)',
  description: 'Minimal @aori/usdm-bridge-sdk + Privy example',
};

// Everything below is client-driven (Privy + wallet signing), so skip static
// prerendering. Otherwise Privy's provider errors out during `next build`
// when no real App ID is present.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
