# @aori/usdm-bridge-sdk

Headless TypeScript SDK for the LayerZero VT (Value Transfer) API that powers the [`@aori/mega-swap-widget`](https://www.npmjs.com/package/@aori/mega-swap-widget). Same quote, sign, submit, and status-tracking flow as the widget — without React, wagmi, or any UI.

Use this when you want to bridge to/from USDM on MegaETH (or any other VT-supported pair) from a backend job, a CLI, a custom UI, or a non-React framework.

## Install

```bash
npm install @aori/usdm-bridge-sdk viem
# or
bun add @aori/usdm-bridge-sdk viem
```

`viem` is a required peer. `ethers` is an optional peer — only needed if you import the ethers adapter.

## Configure

`UsdmBridgeConfig` mirrors the widget's `aori.config.ts` shape, minus the theme/appearance/wallet-modal fields. The example below binds the **output** side of every pair to USDM on MegaETH (chain `4326`), which is the canonical Aori "USDM bridge" setup.

```ts
import type { UsdmBridgeConfig } from '@aori/usdm-bridge-sdk';

export const usdmBridgeConfig: UsdmBridgeConfig = {
  vtApiBaseUrl: '/api/vt',
  rpcOverrides: {
    1: '/api/rpc/1',
    10: '/api/rpc/10',
    56: '/api/rpc/56',
    143: '/api/rpc/143',
    4326: '/api/rpc/4326',
    8453: '/api/rpc/8453',
    42161: '/api/rpc/42161',
  },
  tokens: {
    defaultBase: { chainId: 1, address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' }, // USDC Ethereum
    defaultQuote: { chainId: 4326, address: '0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7' }, // USDM MegaETH
    supportedOutputTokens: [
      { chainId: 4326, address: '0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7' },
    ],
    supportedOutputChains: [4326],
  },
  walletScreening: {
    enabled: true,
    useChainalysisOracle: true,
    screeningUrl: '/api/screening',
  },
  settings: {
    defaultSlippage: 0.01,
    pollingIntervalMs: 4000,
    statusTimeoutMs: 300_000,
  },
};
```

`getQuote` rejects any pair whose input or output isn't in the configured `supported*` lists with `UnsupportedPairError` — that's how you keep one side of every quote bound to USDM.

## One-shot bridge (recommended)

`sdk.bridge(...)` runs the entire flow — `executeSwap`, the deposit-chain settle delay, and `pollStatus` — and resolves only after the order reaches a terminal state. Use the `onSuccess` / `onFailure` / `onSettled` hooks to trigger code in your application when the swap completes. All three are awaited before the returned promise resolves, so you can `await` side effects (analytics, crediting an account, sending a push notification, …) inline:

```ts
import { UsdmBridgeSdk } from '@aori/usdm-bridge-sdk';

const sdk = new UsdmBridgeSdk(usdmBridgeConfig);

const quote = await sdk.getQuote({ /* … */ });

const result = await sdk.bridge({
  quote,
  walletClient,
  onStep:         (step)   => console.log('step:', step.kind),
  onStatusChange: (status) => console.log('status:', status.status),

  onSuccess: async (r) => {
    await fetch('/api/credit-user', {
      method: 'POST',
      body: JSON.stringify({ userId, dstTxHash: r.dstTxHash, amount: r.quote.dstAmount }),
    });
  },
  onFailure: (r) => sentry.captureMessage('bridge failed', { extra: r }),
  onSettled: (r) => analytics.track('bridge_settled', { outcome: r.outcome, quoteId: r.quoteId }),
});

if (result.outcome === 'success') {
  console.log('Settled:', result.dstTxHash, result.explorerUrl);
} else {
  console.warn('Did not settle:', result.status.status);
}
```

`bridge()` resolves regardless of outcome — `result.outcome` is `'success'` for `SUCCEEDED`/`COMPLETED` and `'failure'` for `FAILED`/`CANCELLED`. The promise only **rejects** for actual errors: network failures, user-rejected signing, abort, or anything thrown from your hooks. If a hook throws, `bridge()` propagates the error so you can fail-fast on, say, a downstream API rejecting the credit.

Cancel a bridge in flight with an `AbortSignal`:

```ts
const ac = new AbortController();
const promise = sdk.bridge({ quote, walletClient, abortSignal: ac.signal, onSuccess });
// later…
ac.abort();
```

If you'd rather drive `executeSwap` and `pollStatus` separately (e.g. to render distinct "submitting" vs "settling" UI states), the lower-level flow below still works.

## Quote → Swap → Status (low-level)

```ts
import { UsdmBridgeSdk } from '@aori/usdm-bridge-sdk';
import { createWalletClient, custom } from 'viem';
import { mainnet } from 'viem/chains';
import { usdmBridgeConfig } from './usdm-bridge.config';

const sdk = new UsdmBridgeSdk(usdmBridgeConfig);

const walletClient = createWalletClient({
  account: '0xYourAddress',
  chain: mainnet,
  transport: custom(window.ethereum!),
});

// 1. Fetch a quote
const quote = await sdk.getQuote({
  srcChainId: 1,
  dstChainId: 4326,
  srcTokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC Ethereum
  dstTokenAddress: '0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7', // USDM MegaETH
  amount: '100',           // decimal human amount (100 USDC)
  srcTokenDecimals: 6,     // required for string/number `amount`
  // or: amount: 100_000_000n   // bigint = raw on-chain units (no decimals needed)
  srcWalletAddress: '0xYourAddress',
});

console.log(`Quote ${quote.id}: ${quote.srcAmount} -> ${quote.dstAmount}`);

// 2. Execute (chain-switch + approval + deposit + sign + submit)
const result = await sdk.executeSwap({
  quote,
  walletClient,
  onStep: (step) => console.log('step:', step),
  onTxHash: (hash, kind) => console.log(`${kind} tx: ${hash}`),
});

console.log(`Submitted ${result.quoteId}, tx hashes:`, result.txHashes);

// 3. Track status to terminal state
const finalStatus = await sdk.pollStatus(result.quoteId, {
  txHash: result.txHashes[result.txHashes.length - 1],
  onStatusChange: (s) => console.log('status:', s.status),
});

console.log('done:', finalStatus.status, finalStatus.dstTxHash);
```

### What `executeSwap` does

For each step in `quote.userSteps`:

| Step type   | Action                                                                                                                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TRANSACTION | Chain-switches the wallet, decodes calldata. If `approve(...)` it does the allowance/USDT-style reset/`maxUint256` dance and waits for receipt. Otherwise it sends as the native deposit. |
| SIGNATURE   | Chain-switches if needed, signs EIP-712 typed data with the wallet, then `POST /submit-signature` to the relayer.                                                                         |

After all steps complete you get back `{ quoteId, signature?, txHashes, isNativeDeposit, depositChainBlockTimeMs }`. If `isNativeDeposit`, wait `2 * depositChainBlockTimeMs` before the first `pollStatus` call (the widget does the same).

## Using ethers v6 instead of viem

```ts
import { UsdmBridgeSdk } from '@aori/usdm-bridge-sdk';
import { ethersSignerToWalletClient } from '@aori/usdm-bridge-sdk/ethers';
import { BrowserProvider } from 'ethers';

const sdk = new UsdmBridgeSdk(usdmBridgeConfig);

const provider = new BrowserProvider(window.ethereum!);
const signer = await provider.getSigner();
const walletClient = await ethersSignerToWalletClient(signer);

const quote = await sdk.getQuote(/* ... */);
await sdk.executeSwap({ quote, walletClient });
```

The adapter implements just enough EIP-1193 to bridge `eth_sendTransaction`, `eth_signTypedData_v4`, `eth_chainId`, `eth_accounts`, and `wallet_switchEthereumChain` to the corresponding ethers calls.

## Status tracking only

If you've already submitted via your own pipeline and just want polling:

```ts
import { UsdmBridgeSdk } from '@aori/usdm-bridge-sdk';

const sdk = new UsdmBridgeSdk({ vtApiBaseUrl: '/api/vt' });

const status = await sdk.pollStatus(quoteId, {
  txHash,
  interval: 4000,
  timeout: 300_000,
  onStatusChange: (s) => console.log(s.status),
  onSuccess: (s) => console.log('settled:', s.dstTxHash),
  onFailure: (s) => console.warn('did not settle:', s.status),
  onSettled: (s) => console.log('terminal:', s.status),
  // onComplete: (s) => …  ← legacy alias of onSettled, fires for any terminal state
});
```

Terminal statuses: `SUCCEEDED`, `COMPLETED` (success), `FAILED`, `CANCELLED` (failure). The semantic hooks (`onSuccess` / `onFailure` / `onSettled`) are awaited before `pollStatus` resolves; throws inside them reject the promise. Helpers `isSuccessStatus`, `isFailureStatus`, and `isTerminalStatus` are exported if you want to classify a status string yourself.

## Server-side proxying

In production, keep your VT API key and any private RPC URLs off the client.

### API proxy (`vtApiBaseUrl`)

Point `vtApiBaseUrl` at your own backend route. The SDK sends every quote/submit/status request there instead of directly to LayerZero.

```ts
new UsdmBridgeSdk({ vtApiBaseUrl: '/api/vt' /* no apiKey needed */ });
```

Your backend forwards to `https://transfer.layerzero-api.com/v1` with the real `x-api-key` injected from env vars.

### RPC proxy (`rpcOverrides`)

The SDK uses public RPCs by default for ERC20 allowance reads, receipt waits, and the Chainalysis sanctions oracle. Override per-chain:

```ts
new UsdmBridgeSdk({
  rpcOverrides: {
    1: '/api/rpc/1',
    4326: '/api/rpc/4326',
  },
});
```

This is independent of whatever your wallet provider uses for signing/sending — the SDK only uses these for read-side calls.

## Low-level primitives

When you want full control over the orchestration (e.g. interleaving custom UI between approval and deposit), import the standalone helpers and skip `executeSwap`:

```ts
import {
  requestQuote,
  ChainSwitch,
  handleApprovalStep,
  sendTransactionStep,
  signAndSubmit,
  pollOrderStatus,
  SdkEnvironment,
} from '@aori/usdm-bridge-sdk';

const env = new SdkEnvironment({ vtApiBaseUrl: '/api/vt' });
const quote = await requestQuote({ /* ... */ }, { env });

for (const step of quote.userSteps) {
  if (step.type === 'TRANSACTION') {
    await ChainSwitch(walletClient, /* chainId */);
    const wasApproval = await handleApprovalStep({ step, walletClient, ownerAddress, quote, env });
    if (!wasApproval) {
      await sendTransactionStep({ step, walletClient, userAddress: ownerAddress, fallbackChainKey: quote.srcChainKey });
    }
  } else {
    await signAndSubmit({ quote, signatureStep: step, userAddress: ownerAddress, walletClient, env });
  }
}

await pollOrderStatus(quote.id, env, { onStatusChange: (s) => console.log(s.status) });
```

## Supported chains

Built-in chain registry (extend via `rpcOverrides`):

| Chain ID | Key       |
| -------- | --------- |
| 1        | ethereum  |
| 10       | optimism  |
| 30       | rootstock |
| 56       | bsc       |
| 143      | monad     |
| 988      | stable    |
| 4326     | megaeth   |
| 8453     | base      |
| 9745     | plasma    |
| 42161    | arbitrum  |

## License

UNLICENSED — same terms as the rest of the Aori widget stack.
