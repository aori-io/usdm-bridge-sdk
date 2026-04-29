import type { UsdmBridgeConfig } from '@aori/usdm-bridge-sdk';

// ── Input tokens the user can pick from ──────────────────────────────────────
//
// Add to / remove from this array to change what shows up in the dropdown.
// The SDK's `tokens.supportedInputTokens` allow-list is derived from it, so
// `getQuote` will reject anything you haven't explicitly listed here.
//
// If you add a new chain id, also add the matching `viem/chains` import in
// `chainsByChainId` below AND add the chain to `supportedChains` in
// `app/providers.tsx`, otherwise Privy won't know about it for switching.

export interface InputTokenOption {
  chainId: number;
  address: `0x${string}`;
  symbol: string;
  decimals: number;
  /** Short human label for the dropdown (e.g. "USDC · Base"). */
  label: string;
}

export const INPUT_TOKENS: InputTokenOption[] = [
  { chainId: 8453,  address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6, label: 'USDC · Base' },
  { chainId: 1,     address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6, label: 'USDC · Ethereum' },
  { chainId: 42161, address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', decimals: 6, label: 'USDC · Arbitrum' },
  { chainId: 10,    address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', symbol: 'USDC', decimals: 6, label: 'USDC · Optimism' },
  { chainId: 1,     address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', decimals: 6, label: 'USDT · Ethereum' },
];

export const DEFAULT_INPUT: InputTokenOption = INPUT_TOKENS[0]!;

// ── Output (fixed: USDM on MegaETH) ──────────────────────────────────────────

export const USDM_MEGAETH  = '0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7' as const;
export const DST_CHAIN_ID  = 4326;
export const USDM_DECIMALS = 18;

// ── Bridge SDK config ────────────────────────────────────────────────────────
//
// We point `vtApiBaseUrl` at our own Next.js Route Handler at /api/vt. That
// handler (see `app/api/vt/[...path]/route.ts`) injects the real LayerZero
// VT key from a server-only `VT_API_KEY` env var, so the key never reaches
// the browser. When `vtApiBaseUrl` is set, the SDK deliberately stops
// sending `apiKey` from the client — see `SdkEnvironment.getVtHeaders`.

export const usdmBridgeConfig: UsdmBridgeConfig = {
  vtApiBaseUrl: '/api/vt',
  tokens: {
    supportedInputTokens:  INPUT_TOKENS.map((t) => ({ chainId: t.chainId, address: t.address })),
    supportedOutputTokens: [{ chainId: DST_CHAIN_ID, address: USDM_MEGAETH }],
  },
  settings: { defaultSlippage: 0.01 },
};
