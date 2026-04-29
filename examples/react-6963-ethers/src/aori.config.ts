import type { UsdmBridgeConfig } from '@aori/usdm-bridge-sdk';

// ── Input tokens the user can pick from ──────────────────────────────────────
//
// Add to / remove from this array to change what shows up in the dropdown.
// The SDK's `tokens.supportedInputTokens` allow-list is derived from it, so
// `getQuote` will reject anything you haven't explicitly listed here.
//
// Unlike the viem flavor of this example, the ethers adapter does NOT need
// us to register a `viem/chains` definition for each id — it builds a stub
// Chain on the fly from the chain id. The user's wallet still needs the
// chain present in its own networks list (most modern wallets will offer to
// add it via `wallet_addEthereumChain` on first use).

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
  { chainId: 143,   address: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603', symbol: 'USDC', decimals: 6, label: 'USDC · Monad' },
];

export const DEFAULT_INPUT: InputTokenOption = INPUT_TOKENS[0]!;

// ── Output (fixed: USDM on MegaETH) ──────────────────────────────────────────

export const USDM_MEGAETH  = '0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7' as const;
export const DST_CHAIN_ID  = 4326;
export const USDM_DECIMALS = 18;

// ── Bridge SDK config ────────────────────────────────────────────────────────
//
// SECURITY: this example reads the LayerZero VT key from a VITE_* env var,
// which Vite inlines into the client bundle at build time. Anyone visiting
// the site can extract it from devtools. This is fine for local dev and
// personal demos, but use the `privy-next-serverless` example for anything
// reachable from the public internet.

export const usdmBridgeConfig: UsdmBridgeConfig = {
  apiKey: import.meta.env.VITE_VT_API_KEY,
  tokens: {
    supportedInputTokens:  INPUT_TOKENS.map((t) => ({ chainId: t.chainId, address: t.address })),
    supportedOutputTokens: [{ chainId: DST_CHAIN_ID, address: USDM_MEGAETH }],
  },
  settings: { defaultSlippage: 0.01 },
};
