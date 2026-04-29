import type { WalletScreeningConfig } from '../screening/walletScreening';

export interface TokenRef {
  chainId: number;
  address: string;
}

export interface UsdmBridgeConfig {
  /** Direct LayerZero VT API key. Omit and set `vtApiBaseUrl` to a server-side proxy in production. */
  apiKey?: string;
  /** Override the LayerZero VT API base URL (e.g. a relative proxy path like `/api/vt`). */
  vtApiBaseUrl?: string;
  /** Per-chain RPC URL overrides used by SDK-side public clients (allowance reads, receipt waits, screening). */
  rpcOverrides?: Partial<Record<number, string | string[]>>;

  tokens?: {
    /** Optional default input (sell) token, surfaced via `sdk.config.tokens.defaultBase`. */
    defaultBase?: TokenRef;
    /** Optional default output (buy) token, surfaced via `sdk.config.tokens.defaultQuote`. */
    defaultQuote?: TokenRef;
    /** When set, `getQuote` rejects pairs whose input token is not in this list. */
    supportedInputTokens?: TokenRef[];
    /** When set, `getQuote` rejects pairs whose output token is not in this list. */
    supportedOutputTokens?: TokenRef[];
    /** When set, `getQuote` rejects pairs whose input chain is not in this list. */
    supportedInputChains?: number[];
    /** When set, `getQuote` rejects pairs whose output chain is not in this list. */
    supportedOutputChains?: number[];
  };

  walletScreening?: WalletScreeningConfig;

  settings?: {
    /** Default fee tolerance percent passed to the VT API. Falls back to 2 (2%). */
    defaultSlippage?: number;
    /** Polling interval (ms) for `pollStatus`. Default 4000. */
    pollingIntervalMs?: number;
    /** Single-quote request timeout (ms) for `getQuote`. Default 15000. */
    quoteTimeoutMs?: number;
    /** Total timeout (ms) for `pollStatus` before giving up. Default 300000. */
    statusTimeoutMs?: number;
  };

  integrator?: {
    id?: number;
    feeRecipient?: string;
    feeAmount?: number;
  };
}
