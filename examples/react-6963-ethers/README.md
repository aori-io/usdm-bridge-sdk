# react-6963-ethers — minimal React + EIP-6963 + ethers v6 integration

The same demo as [`react-6963`](../react-6963/README.md), but the integrator-side wallet glue is **ethers v6** instead of viem. The only piece that does the swap — `sdk.bridge({...})` — is byte-for-byte identical.

- **No Privy**, no RainbowKit, no wagmi, no AppKit, no WalletConnect.
- Wallet discovery is hand-rolled via [EIP-6963 (Multi Injected Provider Discovery)][eip-6963]: ~80 LOC in `src/useEip6963.ts`, with no third-party type imports.
- The user picks a wallet, the page wraps its EIP-1193 provider in `ethers.BrowserProvider`, gets a `JsonRpcSigner`, hands it to `ethersSignerToWalletClient` from `@aori/usdm-bridge-sdk/ethers`, and passes the resulting `SwapWalletClient` straight to `sdk.bridge`.
- Chain switching uses the SDK's exported `ChainSwitch` primitive, which calls EIP-3326 `wallet_switchEthereumChain` on the same provider via the adapter's EIP-1193 shim.

This is the **shortest possible path** from a fresh React app to a working bridge if your codebase is already on ethers and you don't want to bring viem into your call site.

> **Use this only for local development or personal demos.** This example reads `VITE_VT_API_KEY` from the env, which Vite inlines into the client bundle at build time and is visible to anyone who loads the page. For production, use the [`privy-next-serverless`](../privy-next-serverless/README.md) example, which keeps the key on a Next.js server route. (Yes, the same caveat as the viem flavor.)

[eip-6963]: https://eips.ethereum.org/EIPS/eip-6963

## Why this exists

The SDK is **wallet-kit agnostic and lib-agnostic**. Its public swap surface accepts a `SwapWalletClient`, which is a viem `WalletClient` plus a few optional escape hatches. The ethers adapter at `@aori/usdm-bridge-sdk/ethers` is a ~150 LOC bridge that takes an ethers `Signer` and returns a `SwapWalletClient` — the SDK never knows it's talking to ethers under the hood.

```ts
import { ethersSignerToWalletClient } from '@aori/usdm-bridge-sdk/ethers';
import { BrowserProvider } from 'ethers';

const browserProvider = new BrowserProvider(eip1193Provider, 'any');
const signer          = await browserProvider.getSigner();
const walletClient    = await ethersSignerToWalletClient(signer);

await sdk.bridge({ quote, walletClient, ... });
```

The adapter implements just enough EIP-1193 for the SDK's actual call sites:

| EIP-1193 method               | Mapped to                                    |
| ----------------------------- | -------------------------------------------- |
| `eth_accounts`                | `signer.getAddress()` (cached)               |
| `eth_chainId`                 | cached chain id (updated on switch)          |
| `eth_sendTransaction`         | `signer.sendTransaction(...)`                |
| `eth_signTypedData_v4`        | `signer.signTypedData(...)` (strips `EIP712Domain`) |
| `wallet_switchEthereumChain`  | `signer.provider.send('wallet_switchEthereumChain', ...)` |
| _(anything else)_             | `signer.provider.send(method, params)`       |

That's it. There's no separate code path inside the SDK for ethers — once you hand it a `SwapWalletClient`, the rest of the swap is identical to the viem flow.

## Heads-up: viem is still a transitive dep

`ethersSignerToWalletClient` builds a viem `WalletClient` internally (with `createWalletClient({ transport: custom(eip1193Shim) })`), and the SDK's swap pipeline is viem-based. So:

- You don't import `viem` in any file you write — that's the win this example is showing.
- `viem` is still in `node_modules` because `@aori/usdm-bridge-sdk` lists it as a required peer dep. Bundle-size wise this example ships the same viem code as the viem flavor.

If you need to drop viem entirely from the runtime, the SDK isn't structured for that today — it would be a non-trivial refactor. The adapter is for integrators who want to keep their own code on ethers, not for shrinking the bundle.

## What's different vs `react-6963` (viem flavor)

| Concern                        | `react-6963-ethers` (this)                                                   | `react-6963` (viem)                                                  |
| ------------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Direct dep on viem             | ❌ none in user code (viem is still pulled in transitively by the SDK)        | ✅ `viem` for `createWalletClient`, `custom`, `formatUnits`, chains   |
| Direct dep on ethers           | ✅ `ethers ^6` — `BrowserProvider`, `formatUnits`                            | ❌                                                                    |
| Wallet client construction     | `BrowserProvider → getSigner() → ethersSignerToWalletClient(signer)`         | `createWalletClient({ account, chain, transport: custom(provider) })`|
| `viem/chains` lookup table     | ❌ not needed — adapter builds a stub `Chain` from the chain id              | ✅ `VIEM_CHAINS_BY_ID` map                                            |
| `formatUnits` source           | `ethers`                                                                     | `viem`                                                                |
| EIP-1193 type in `useEip6963`  | local `Eip1193Provider` interface (no viem import)                           | `EIP1193Provider` from viem                                           |
| `sdk.bridge({...})` call site  | identical                                                                    | identical                                                             |

Compare `src/App.tsx` and `src/useEip6963.ts` between the two folders to see exactly where the lines move.

## Setup

1. Build the SDK from the repo root (this example links it via `file:../..`):

   ```bash
   npm install
   npm run build
   ```

   The `npm run build` step is **required** — it produces `dist/ethers.js` and `dist/ethers.cjs`, which is what `@aori/usdm-bridge-sdk/ethers` resolves to. Without it the import fails at runtime.

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

## How the Signer reaches the SDK

```tsx
const { selected, account, connect } = useEip6963();

// (User picks a wallet → connect(detail))

const browserProvider = new BrowserProvider(selected.provider, 'any');
const signer          = await browserProvider.getSigner();

const walletClient = await ethersSignerToWalletClient(signer, {
  address: account,
  chain: { id: srcChainId },
});

await ChainSwitch(walletClient, srcChainId);   // SDK primitive

await sdk.bridge({
  quote,
  walletClient,
  onSuccess: (r) => /* run your post-success code here */,
});
```

The wallet-kit-specific surface area for the entire example is `useEip6963.ts` plus the four-line `BrowserProvider → getSigner → ethersSignerToWalletClient` chain in `App.tsx`. Swap that for any other ethers-Signer source (a managed wallet kit's exported signer, a `Wallet` connected to a custom provider, an AA bundler signer, etc.) and the rest of the demo is unchanged.

Why `'any'` is passed to `BrowserProvider`:

```ts
new BrowserProvider(provider, 'any')
```

Without it, ethers locks the provider to the network it sees on first connect and throws `network changed` when the user switches chains. `'any'` tells ethers to follow the wallet wherever it goes, which is what we want during a multi-chain bridge.

## File layout

```
examples/react-6963-ethers/
├── index.html              # Vite entry HTML, mounts #root
├── vite.config.ts          # Vite config (port 3000, excludes SDK from prebundling)
├── tsconfig.json
├── package.json            # No wallet-kit deps. Only react, react-dom, ethers, the SDK
├── .env.example
└── src/
    ├── main.tsx            # React entry: createRoot + <App/>  (no <Providers>!)
    ├── App.tsx             # The whole demo UI + wallet picker + ethers signer wiring
    ├── useEip6963.ts       # ~80 LOC EIP-6963 React hook (no viem import)
    ├── aori.config.ts      # SDK config (reads VITE_VT_API_KEY here)
    ├── globals.css
    └── vite-env.d.ts       # Types for import.meta.env
```

## Limitations of EIP-6963 vs a wallet kit

EIP-6963 is **discovery only** — same caveats as the viem flavor of this example. It surfaces the EIP-1193 providers already injected by browser-extension wallets, and gives you nothing else:

- No **embedded wallets** (no extension required, often email/social login).
- No **WalletConnect** (mobile wallets via QR).
- No **smart-account / paymaster integration** (account abstraction).
- No **server-side session resumption.**
- No **pre-built picker modal** with branding, ENS, balances, etc.

If your audience won't reliably have a browser-extension wallet, use `privy-next-serverless` (or another wallet kit) instead. The SDK call site is the same — and if your wallet kit hands you an ethers `Signer` rather than an EIP-1193 provider, you can plug it straight into `ethersSignerToWalletClient`.
