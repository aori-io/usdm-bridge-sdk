import { parseUnits, getAddress } from 'viem';
import type { SdkEnvironment } from './environment';
import { chainIdToKey } from '../chains/chainKeys';
import { QuoteRequestError } from '../errors';
import type { VtQuote, VtQuotesResponse } from '../types/vt';

export interface RequestQuoteParams {
  srcChainId: number;
  dstChainId: number;
  srcTokenAddress: string;
  dstTokenAddress: string;
  /**
   * The amount the user wants to send on the source chain. Two forms:
   *  - `bigint`: raw on-chain units (e.g. `1_000_000n` = 1 USDC at 6 decimals).
   *    `srcTokenDecimals` is not required.
   *  - `string` or `number`: a human-readable decimal amount (e.g. `"1"`,
   *    `"1.5"`, `0.5`). `srcTokenDecimals` is REQUIRED and `parseUnits` is
   *    applied. `"1"` and `"1.0"` are equivalent.
   *
   * To avoid ambiguity, digit-only strings are NOT treated as raw units. If
   * you have raw units in a string, convert to bigint first: `BigInt(str)`.
   */
  amount: bigint | string | number;
  /** Required when `amount` is a string or number. Ignored for bigint. */
  srcTokenDecimals?: number;
  srcWalletAddress: string;
  /** Defaults to `srcWalletAddress`. */
  dstWalletAddress?: string;
  options?: {
    /** Fee tolerance percent (1 = 1%). Defaults to `settings.defaultSlippage * 100` or `2`. */
    feeTolerancePercent?: number;
    amountType?: 'EXACT_SRC_AMOUNT' | 'EXACT_DST_AMOUNT';
  };
  /** Hard timeout for this single quote fetch. Default: env.quoteTimeoutMs or 15000. */
  timeoutMs?: number;
  /** External abort signal, composed with the internal timeout. */
  signal?: AbortSignal;
}

export interface RequestQuoteContext {
  env: SdkEnvironment;
  /** Default fee tolerance percent, applied when `options.feeTolerancePercent` is missing. */
  defaultFeeTolerancePercent?: number;
  /** Default request timeout. */
  defaultTimeoutMs?: number;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Normalize the user-facing `amount` into a raw on-chain units string suitable
 * for the VT API.
 *
 * Contract:
 *  - `bigint` is always raw on-chain units. No `decimals` needed.
 *  - `string` / `number` is always a decimal human amount. `decimals` is
 *    REQUIRED. `parseUnits(amount, decimals)` is applied. `"1"`, `"1.0"`,
 *    `1` all map to the same raw value.
 *
 * Digit-only strings are intentionally NOT treated as raw units — that
 * overloading was a footgun (callers wired a UI text input into `amount`
 * along with `srcTokenDecimals` and silently got 1e-decimals of the value
 * they meant). Pass raw values as `bigint` to disambiguate.
 */
function normalizeAmount(
  amount: RequestQuoteParams['amount'],
  decimals: number | undefined,
): string {
  if (typeof amount === 'bigint') return amount.toString();

  const str = String(amount).trim();
  if (str.length === 0) throw new Error('amount is empty');
  if (!/^\d+(\.\d+)?([eE][+-]?\d+)?$/.test(str)) {
    throw new Error(`Invalid amount: ${str}`);
  }

  if (decimals == null) {
    throw new Error(
      `srcTokenDecimals is required when passing amount as a string or number (${str}). ` +
        `Pass amount as a bigint to send raw on-chain units instead.`,
    );
  }
  return parseUnits(str, decimals).toString();
}

/**
 * Compose an external `AbortSignal` with an internal timeout. Returns the
 * combined signal plus a `cancel` to clear the timer if the caller finishes
 * early.
 */
function withTimeout(timeoutMs: number, external?: AbortSignal): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort((external as any)?.reason);
  if (external) {
    if (external.aborted) controller.abort((external as any).reason);
    else external.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer);
      if (external) external.removeEventListener('abort', onAbort);
    },
  };
}

function selectQuote(quotes: VtQuote[]): VtQuote | undefined {
  // Match the widget: prefer AORI_V1 routes, fall back to first.
  const aori = quotes.find((q) => q.routeSteps?.[0]?.type === 'AORI_V1');
  return aori ?? quotes[0];
}

/**
 * POST /quotes — fetches quotes from the LayerZero VT API and returns the
 * preferred one (AORI_V1 if available). Throws `QuoteRequestError` for HTTP
 * errors or empty result sets.
 */
export async function requestQuote(
  params: RequestQuoteParams,
  ctx: RequestQuoteContext,
): Promise<VtQuote> {
  const {
    srcChainId,
    dstChainId,
    srcTokenAddress,
    dstTokenAddress,
    amount,
    srcTokenDecimals,
    srcWalletAddress,
    dstWalletAddress,
    options,
  } = params;

  const srcChainKey = chainIdToKey(srcChainId);
  const dstChainKey = chainIdToKey(dstChainId);
  if (!srcChainKey) throw new Error(`Unknown srcChainId: ${srcChainId}`);
  if (!dstChainKey) throw new Error(`Unknown dstChainId: ${dstChainId}`);

  const normalizedAmount = normalizeAmount(amount, srcTokenDecimals);

  const feeTolerancePercent =
    options?.feeTolerancePercent ?? ctx.defaultFeeTolerancePercent ?? 2;

  const body = {
    srcChainKey,
    dstChainKey,
    srcTokenAddress: getAddress(srcTokenAddress),
    dstTokenAddress: getAddress(dstTokenAddress),
    amount: normalizedAmount,
    srcWalletAddress: srcWalletAddress || ZERO_ADDRESS,
    dstWalletAddress: dstWalletAddress || srcWalletAddress || ZERO_ADDRESS,
    options: {
      amountType: options?.amountType ?? 'EXACT_SRC_AMOUNT',
      feeTolerance: { type: 'PERCENT', amount: feeTolerancePercent },
    },
  };

  const timeoutMs = params.timeoutMs ?? ctx.defaultTimeoutMs ?? 15_000;
  const { signal, cancel } = withTimeout(timeoutMs, params.signal);

  let res: Response;
  try {
    res = await fetch(`${ctx.env.getVtApiUrl()}/quotes`, {
      method: 'POST',
      headers: ctx.env.getVtHeaders(),
      body: JSON.stringify(body),
      signal,
    });
  } finally {
    cancel();
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({} as any));
    const msg = (errBody as { message?: string })?.message || res.statusText;
    throw new QuoteRequestError(`Quote request failed: ${msg}`, { status: res.status });
  }

  const data = (await res.json()) as VtQuotesResponse;
  const quotes = data.quotes ?? [];
  const selected = selectQuote(quotes);
  if (!selected) {
    throw new QuoteRequestError('No quotes returned for this pair', { emptyQuotes: true });
  }

  selected._receivedAt = Date.now();
  return selected;
}
