# react-6963 — minimal React + EIP-6963 wallet integration

Same UI/flow as `privy-next-serverless`, but rips out the wallet kit:

- **No Privy**, no RainbowKit, no wagmi, no AppKit, no WalletConnect.
- Wallet discovery is done by hand using [EIP-6963 (Multi Injected Provider Discovery)][eip-6963]: ~70 LOC in `src/useEip6963.ts`.
- The user picks a wallet from the discovered list, the page calls `eth_requestAccounts` on its EIP-1193 provider, wraps it in a viem `WalletClient`, and hands that straight to `sdk.bridge`.
- Chain switching uses the SDK's exported `ChainSwitch` primitive, which calls EIP-3326 `wallet_switchEthereumChain` on the same provider.

This is the **shortest possible path** from a fresh React app to a working bridge — useful for understanding exactly what an integrator is responsible for vs. what the SDK does for you.

> **Use this only for local development or personal demos.** This example reads `VITE_VT_API_KEY` from the env, which Vite inlines into the client bundle at build time and is visible to anyone who loads the page. For production, use the sibling [`privy-next-serverless`](../privy-next-serverless/README.md) example, which keeps the key on a Next.js server route.

[eip-6963]: https://eips.ethereum.org/EIPS/eip-6963

## Why no SDK changes are needed

The SDK is **wallet-kit agnostic**. The only contract is "give me a viem `WalletClient`":

```ts
sdk.bridge({ walletClient, quote, ... })
```

Whatever produces that `WalletClient` — Privy's `wallet.getEthereumProvider()`, an EIP-6963 announcement, a wagmi connector, raw `window.ethereum`, a WalletConnect session — the SDK only ever talks to it through three viem actions:

| What the SDK does                  | viem call             | EIP-1193 method under the hood   |
| ---------------------------------- | --------------------- | -------------------------------- |
| Switch network before each step    | `walletClient.request`| `wallet_switchEthereumChain` (EIP-3326) |
| Send approval / deposit txs        | `sendTransaction`     | `eth_sendTransaction`            |
| Sign the EIP-712 quote             | `signTypedData`       | `eth_signTypedData_v4`           |

All three are standard EIP-1193 methods every browser wallet implements. So **the abstraction line lives at the EIP-1193 provider**, which is exactly where Privy and EIP-6963 both already terminate. There is no `walletMode` config and there shouldn't be: the SDK shouldn't know whether the EIP-1193 provider it's holding came from Privy, MetaMask, Rabby, or your own homebrew wallet.

That's also why these two examples can have wildly different connection layers but **literally identical** `sdk.bridge({...})` call sites.

## What's different vs `privy-next-serverless`

| Concern                  | `react-6963` (this example)                          | `privy-next-serverless`                                                                  |
| ------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Stack                    | React 19 + Vite SPA                                  | Next.js App Router                                                                       |
| Wallet kit               | Hand-rolled EIP-6963 hook                            | `@privy-io/react-auth` (managed: embedded wallets, social login, picker UI)              |
| Wallet → provider        | `provider.request({method:'eth_requestAccounts'})`   | `wallet.getEthereumProvider()`                                                            |
| Chain switching          | `ChainSwitch(walletClient, id)` (SDK primitive)      | `wallet.switchChain(id)` (Privy wraps the same RPC)                                       |
| Add chain to wallet      | Wallet's own UX, prompted on first switch attempt    | Pre-listed in Privy `supportedChains`                                                     |
| API key strategy         | `VITE_VT_API_KEY` inlined at build time              | `VT_API_KEY` server-only behind `/api/vt`                                                 |
| Embedded / social wallets| ❌ No — only injected wallets that announce via 6963 | ✅ Yes — Privy creates an embedded wallet for users without one                          |
| External deps for wallet | none (just `viem`)                                   | `@privy-io/react-auth`                                                                    |
| SDK call site            | identical                                            | identical                                                                                 |

The wallet-kit decision is independent from the API-key decision. If you wanted EIP-6963 in production, you'd combine this example's wallet layer with `privy-next-serverless`'s server proxy.

## Setup

1. Build the SDK from the repo root (this example links it via `file:../..`):

   ```bash
   npm install
   npm run build
   ```

2. Get a LayerZero VT API key from the LayerZero team.

3. Configure env:

   ```bash
   cp .env.example .env
   # edit .env and set:
   #   VITE_VT_API_KEY=...
   ```

4. Install + run:

   ```bash
   npm install
   npm run dev
   ```

   Open <http://localhost:3000>. You'll see one button per browser wallet that announced itself via EIP-6963 — typically MetaMask, Rabby, Coinbase Wallet, Phantom (EVM), Brave Wallet, etc. Pick one, approve the connection prompt, and the bridge UI is ready.

## How EIP-6963 discovery works

Two events handle the entire dance:

```ts
// Page → all wallets: "anyone home?"
window.dispatchEvent(new Event('eip6963:requestProvider'));

// Each wallet → page: "yes, here's me + my provider"
window.addEventListener('eip6963:announceProvider', (e) => {
  const { info, provider } = e.detail;
  // info: { uuid, name, icon, rdns }   provider: EIP-1193
});
```

`src/useEip6963.ts` wraps that into a React hook with `connect()` / `disconnect()` and listens for `accountsChanged` / `chainChanged` on the selected provider. That's the entire wallet stack.

## How the WalletClient reaches the SDK

```tsx
const { selected, account, connect } = useEip6963();

// (User picks a wallet from the picker → connect(detail))

const walletClient = createWalletClient({
  account,
  chain: selectedChain,
  transport: custom(selected.provider),    // ← EIP-1193 provider from 6963
});

await ChainSwitch(walletClient, srcChainId);   // SDK primitive

await sdk.bridge({
  quote,
  walletClient,
  onSuccess: (r) => /* run your post-success code here */,
});
```

The wallet-kit-specific surface area for the entire example is `useEip6963.ts`. Swap that file for a wagmi `useConnectorClient`, a Privy `useWallets`, a Dynamic.xyz `useDynamicContext`, etc., and nothing else changes.

## File layout

```
examples/react-6963/
├── index.html              # Vite entry HTML, mounts #root
├── vite.config.ts          # Vite config (port 3000, excludes SDK from prebundling)
├── tsconfig.json
├── tsconfig.node.json
├── package.json            # No wallet-kit deps. Only react, react-dom, viem, the SDK
├── .env.example
└── src/
    ├── main.tsx            # React entry: createRoot + <App/>  (no <Providers>!)
    ├── App.tsx             # The whole demo UI + wallet picker
    ├── useEip6963.ts       # ~70 LOC EIP-6963 React hook
    ├── aori.config.ts      # SDK config (reads VITE_VT_API_KEY here)
    ├── globals.css
    └── vite-env.d.ts       # Types for import.meta.env
```

## Limitations of EIP-6963 vs a wallet kit

EIP-6963 is **discovery only**. It surfaces the EIP-1193 providers already injected by browser-extension wallets. Things it deliberately does NOT give you, that managed kits like Privy / RainbowKit / AppKit do:

- **Embedded wallets** (no extension required, often email/social login).
- **WalletConnect** (mobile wallets via QR).
- **Smart-account / paymaster integration** (account abstraction).
- **Server-side session resumption.**
- **A pre-built picker modal** with branding, ENS, balances, etc.

If your audience won't reliably have a browser-extension wallet, use `privy-next-serverless` (or another wallet kit) instead. The SDK call site is the same.
