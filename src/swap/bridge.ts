import type { Hash } from 'viem';
import type { SdkEnvironment } from '../api/environment';
import { type PollOrderStatusOptions, isSuccessStatus, pollOrderStatus } from '../api/status';
import type { VtOrderStatus, VtQuote } from '../types/vt';
import { type ExecuteSwapParams, type ExecutionStep, executeSwap } from './execute';
import type { SwapWalletClient } from './walletClient';

/**
 * One-shot end-to-end bridge result. Includes everything an integrator needs
 * to render a "done" screen, fire analytics, or trigger downstream side
 * effects (e.g. crediting a user account in the embedding application).
 */
export interface BridgeResult {
  quote: VtQuote;
  quoteId: string;
  txHashes: Hash[];
  signature?: string;
  /** Final terminal status from `pollStatus`. */
  status: VtOrderStatus;
  /** Semantic outcome derived from `status.status`. */
  outcome: 'success' | 'failure';
  /** Convenience accessors copied off `status`. */
  srcTxHash?: string;
  dstTxHash?: string;
  explorerUrl?: string;
  isNativeDeposit: boolean;
  depositChainBlockTimeMs: number;
}

export interface BridgeParams {
  quote: VtQuote;
  walletClient: SwapWalletClient;
  /** Defaults to `walletClient.account.address`. */
  userAddress?: string;

  /** Per-execution-stage progress hook (chain switch, approval, deposit, signing, …). */
  onStep?: (step: ExecutionStep) => void;
  /** Fired on every TRANSACTION hash (approvals + deposit). */
  onTxHash?: ExecuteSwapParams['onTxHash'];
  /** Forwarded to `pollStatus`. Fired whenever the order status string changes. */
  onStatusChange?: (status: VtOrderStatus) => void;

  /** Fired once when the order settles successfully (`SUCCEEDED` / `COMPLETED`). Awaited. */
  onSuccess?: (result: BridgeResult) => void | Promise<void>;
  /** Fired once when the order ends unsuccessfully (`FAILED` / `CANCELLED`). Awaited. */
  onFailure?: (result: BridgeResult) => void | Promise<void>;
  /** Fired once on any terminal state, after `onSuccess`/`onFailure`. Awaited. */
  onSettled?: (result: BridgeResult) => void | Promise<void>;

  /** Optional staleness check called before submitting the signature. */
  validateBeforeSubmit?: ExecuteSwapParams['validateBeforeSubmit'];
  /** When true, skips the implicit chain switch before each TRANSACTION step. */
  skipChainSwitch?: boolean;
  abortSignal?: AbortSignal;

  /**
   * Override the default deposit-chain settle delay. The widget waits
   * `2 * depositChainBlockTimeMs` between the deposit tx and the first
   * `pollStatus` call when `isNativeDeposit` is true. Set to `0` to disable.
   */
  depositSettleDelayMs?: number;

  /** Pass-through tuning for the underlying `pollStatus` call. */
  pollOptions?: Pick<PollOrderStatusOptions, 'interval' | 'timeout'>;
}

/**
 * Sleep that resolves early if the provided AbortSignal fires. Throws
 * `AbortError` in that case so callers see the same shape as `executeSwap`'s
 * abort handling.
 */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Bridge aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('Bridge aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * One-shot end-to-end bridge: `executeSwap` → optional deposit-settle delay →
 * `pollStatus` → classify outcome → fire `onSuccess`/`onFailure`/`onSettled` →
 * resolve with a single `BridgeResult`.
 *
 * Resolves regardless of outcome (`outcome: 'success' | 'failure'`). Only
 * actual errors (network, user-rejected signing, hook throws, abort) reject
 * the returned promise.
 */
export async function bridge(
  params: BridgeParams,
  env: SdkEnvironment,
): Promise<BridgeResult> {
  const {
    quote,
    walletClient,
    userAddress,
    onStep,
    onTxHash,
    onStatusChange,
    onSuccess,
    onFailure,
    onSettled,
    validateBeforeSubmit,
    skipChainSwitch,
    abortSignal,
    depositSettleDelayMs,
    pollOptions,
  } = params;

  const executeResult = await executeSwap(
    {
      quote,
      walletClient,
      userAddress,
      onStep,
      onTxHash,
      validateBeforeSubmit,
      skipChainSwitch,
      abortSignal,
    },
    env,
  );

  const settleDelay = depositSettleDelayMs
    ?? (executeResult.isNativeDeposit ? 2 * executeResult.depositChainBlockTimeMs : 0);
  if (settleDelay > 0) {
    await abortableSleep(settleDelay, abortSignal);
  }

  const lastTxHash = executeResult.txHashes[executeResult.txHashes.length - 1];

  const status = await pollOrderStatus(executeResult.quoteId, env, {
    ...(pollOptions ?? {}),
    ...(lastTxHash ? { txHash: lastTxHash } : {}),
    ...(abortSignal ? { signal: abortSignal } : {}),
    ...(onStatusChange ? { onStatusChange } : {}),
  });

  const outcome: BridgeResult['outcome'] = isSuccessStatus(status.status) ? 'success' : 'failure';

  const result: BridgeResult = {
    quote,
    quoteId: executeResult.quoteId,
    txHashes: executeResult.txHashes,
    ...(executeResult.signature ? { signature: executeResult.signature } : {}),
    status,
    outcome,
    ...(status.srcTxHash ? { srcTxHash: status.srcTxHash } : {}),
    ...(status.dstTxHash ? { dstTxHash: status.dstTxHash } : {}),
    ...(status.explorerUrl ? { explorerUrl: status.explorerUrl } : {}),
    isNativeDeposit: executeResult.isNativeDeposit,
    depositChainBlockTimeMs: executeResult.depositChainBlockTimeMs,
  };

  if (outcome === 'success') {
    await onSuccess?.(result);
  } else {
    await onFailure?.(result);
  }
  await onSettled?.(result);

  return result;
}
