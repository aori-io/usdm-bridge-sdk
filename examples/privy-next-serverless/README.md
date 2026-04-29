# privy-next-serverless — Next.js + Privy with a server-side API key

Production-shaped Next.js 15 App Router demo of `@aori/usdm-bridge-sdk` using:

- **[Privy](https://privy.io)** for wallet auth (embedded wallets, email, Google, external wallets)
- **A serverless Route Handler** at `app/api/vt/[...path]/route.ts` that proxies every LayerZero VT API call from the browser, injecting the real API key from a **server-only** env var (`VT_API_KEY`, no `NEXT_PUBLIC_` prefix). The key is never sent to the client.

If you only need a quick local demo and don't care about the key being visible in the browser, the sibling [`next-2`](../next-2/README.md) example is a smaller version that just reads `NEXT_PUBLIC_VT_API_KEY` from a client component.

## Architecture

```
┌──────────────────┐    fetch /api/vt/quotes        ┌────────────────────────┐    fetch https://transfer.layerzero-api.com/v1/quotes
│  Browser         │ ──────────────────────────────▶│  Next.js Route Handler │ ─────────────────────────────────────────────────▶ LayerZero VT API
│  (UsdmBridgeSdk  │                                │  app/api/vt/[...path]  │      Authorization: x-api-key: $VT_API_KEY
│   vtApiBaseUrl:  │ ◀──────────────────────────────│  (Node runtime)        │ ◀─────────────────────────────────────────────────
│   '/api/vt')     │       proxied response         └────────────────────────┘
└──────────────────┘
```

The browser-side SDK is configured with `vtApiBaseUrl: '/api/vt'`, which makes it stop sending the `x-api-key` header itself (see `SdkEnvironment.getVtHeaders` — when `vtApiBaseUrl` is set, the SDK assumes a proxy is injecting the key). All three SDK call sites (`POST /quotes`, `POST /submit-signature`, `GET /status/{id}`) get caught by the catch-all `[...path]` route.

## Setup

1. Build the SDK from the repo root (the example links it via `file:../..`):

   ```bash
   npm install
   npm run build
   ```

2. Get a Privy App ID from <https://dashboard.privy.io>.

3. Get a LayerZero VT API key from the LayerZero team.

4. Configure env:

   ```bash
   cp .env.example .env.local
   # edit .env.local and set:
   #   NEXT_PUBLIC_PRIVY_APP_ID=...
   #   VT_API_KEY=...                  ← no NEXT_PUBLIC_ prefix, server-only
   ```

5. Install + run:

   ```bash
   npm install
   npm run dev
   ```

   Open <http://localhost:3000>.

## File layout

```
examples/privy-next-serverless/
├── app/
│   ├── api/
│   │   └── vt/
│   │       └── [...path]/
│   │           └── route.ts   # Catch-all proxy, injects x-api-key server-side
│   ├── layout.tsx             # Root layout, mounts <Providers>
│   ├── providers.tsx          # Client component: <PrivyProvider>
│   ├── page.tsx               # Client component: the demo UI
│   ├── aori.config.ts         # SDK config (vtApiBaseUrl: '/api/vt', no apiKey)
│   └── globals.css
├── next.config.mjs
├── tsconfig.json
├── package.json
└── .env.example
```

## How the proxy works

`app/api/vt/[...path]/route.ts`:

- Runs on the Node runtime (`export const runtime = 'nodejs'`).
- Reads `process.env.VT_API_KEY` server-side. Returns `500 { error: 'VT_API_KEY is not configured…' }` if missing — that's how you'll know if you forgot to set the env var.
- Forwards method, query string, body (streamed), and most client headers to `https://transfer.layerzero-api.com/v1/...`. Hop-by-hop headers and any incoming `x-api-key` / `authorization` / `cookie` are stripped before forwarding.
- Streams the upstream response body back to the browser with the same status code.
- Defaults to the LayerZero production base URL; override per-environment via `VT_API_UPSTREAM` if you ever need to point at a staging endpoint.

This proxy is intentionally minimal so it stays easy to read. In real deployments you'd typically want to add:

- **Rate limiting / per-user quotas** (e.g. via the user's session or Privy user ID).
- **Origin / CSRF checks** so other websites can't shell into your VT quota by hitting your proxy from their pages.
- **Logging / metrics** so you can see what the SDK is asking for.
- **Caching** for any responses that are safely cacheable (most aren't — quotes are user-specific and short-lived).

## SDK config (the only thing that differs from the simple example)

```ts
// app/aori.config.ts
export const usdmBridgeConfig: UsdmBridgeConfig = {
  vtApiBaseUrl: '/api/vt',           // ← every quote/submit/status hits the proxy
  tokens: { /* ... */ },
  settings: { defaultSlippage: 0.01 },
};
```

There is **no** `apiKey` field on the client. The SDK's `SdkEnvironment` enforces this:

```ts
// from src/api/environment.ts
if (!this.vtApiBaseUrl && this.apiKey) {
  headers['x-api-key'] = this.apiKey;
}
```

When `vtApiBaseUrl` is set, the client never sends `x-api-key`. The proxy is the only thing that knows the key.

## How Privy plugs into the SDK

Privy hands every wallet (embedded or external) an EIP-1193 provider. We wrap it in a viem `WalletClient` and hand that straight to `sdk.bridge`:

```tsx
const { wallets } = useWallets();
const wallet = wallets[0];

await wallet.switchChain(selectedInput.chainId);
const provider = await wallet.getEthereumProvider();

const walletClient = createWalletClient({
  account: wallet.address,
  chain: selectedChain,
  transport: custom(provider),
});

await sdk.bridge({
  quote,
  walletClient,
  onSuccess: (r) => /* run your post-success code here */,
});
```

That's the entire Privy-specific surface area. The same pattern works for any wallet kit (RainbowKit, AppKit, ConnectKit, dynamic.xyz) — they all expose an EIP-1193 provider.

## Notes on App Router

- `app/providers.tsx` is marked `'use client'` because Privy's provider needs the browser runtime.
- `app/page.tsx` is a client component for the same reason (wallet state, signing, etc.).
- `app/api/vt/[...path]/route.ts` is the only server-side code. It runs on Vercel as a Serverless Function (or on whatever Node host you deploy to).
