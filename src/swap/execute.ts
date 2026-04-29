import type { Hash } from 'viem';
import type { SdkEnvironment } from '../api/environment';
import { getChainConfig, keyToChainId } from '../chains/chainKeys';
import { QuoteStaleError } from '../errors';
import type { VtQuote } from '../types/vt';
import { ChainSwitch } from './chainSwitch';
import { handleApprovalStep, sendTransactionStep, signAndSubmit } from './steps';
import { type SwapWalletClient, resolveChainId } from './walletClient';

/** Stages reported via the `onStep` callback during `executeSwap`. */
export type ExecutionStep =
  | { kind: 'chain-switch'; chainId: number }
  | { kind: 'approval-skipped'; tokenAddress: string; chainId: number }
  | { kind: 'approval-reset-sent'; hash: Hash }
  | { kind: 'approval-sent'; hash: Hash }
  | { kind: 'deposit-sent'; hash: Hash; chainId: number }
  | { kind: 'signing' }
  | { kind: 'submitted'; quoteId: string; signature: string }
  | { kind: 'done'; quoteId: string };

export interface ExecuteSwapParams {
  quote: VtQuote;
  walletClient: SwapWalletClient;
  /** Defaults to `walletClient.account.address`. */
  userAddress?: string;
  /** Per-stage progress hook. */
  onStep?: (step: ExecutionStep) => void;
  /** Fired on every TRANSACTION hash (approvals + deposit). */
  onTxHash?: (hash: Hash, kind: 'approval' | 'approval-reset' | 'deposit') => void;
  /**
   * Optional staleness check called before submitting the signature. Returning
   * `{ canSubmit: false }` raises `QuoteStaleError`.
   */
  validateBeforeSubmit?: () => { canSubmit: boolean; reason?: string };
  /** When true, skips the implicit chain switch before each TRANSACTION step. */
  skipChainSwitch?: boolean;
  abortSignal?: AbortSignal;
}

export interface ExecuteSwapResult {
  quoteId: string;
  signature?: string;
  txHashes: Hash[];
  /** True when the quote contained at least one native (non-approval) deposit tx. */
  isNativeDeposit: boolean;
  /**
   * Approximate block time of the deposit chain (ms). Use this to delay the
   * first `pollStatus` call after a native deposit, mirroring the widget.
   */
  depositChainBlockTimeMs: number;
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Swap execution aborted', 'AbortError');
  }
}

/**
 * Walks every step in `quote.userSteps`:
 *
 *   1. For each TRANSACTION step:
 *        - chain-switches the wallet (unless `skipChainSwitch`),
 *        - if the calldata decodes as ERC20 `approve`, runs the allowance/
 *          reset/maxUint256 dance and waits for receipts,
 *        - otherwise treats it as a native deposit and sends it.
 *   2. For each SIGNATURE step:
 *        - signs the EIP-712 typed data,
 *        - POSTs `/submit-signature`.
 *
 * Returns enough metadata for the caller to drive `pollStatus` correctly
 * (notably `depositChainBlockTimeMs` to delay the first poll after a native
 * deposit, matching the widget's behavior).
 */
export async function executeSwap(
  params: ExecuteSwapParams,
  env: SdkEnvironment,
): Promise<ExecuteSwapResult> {
  const {
    quote,
    walletClient,
    onStep,
    onTxHash,
    validateBeforeSubmit,
    skipChainSwitch,
    abortSignal,
  } = params;

  const userAddress =
    params.userAddress || walletClient.account?.address;
  if (!userAddress) {
    throw new Error('userAddress is required (walletClient.account is missing)');
  }

  const result: ExecuteSwapResult = {
    quoteId: quote.id,
    txHashes: [],
    isNativeDeposit: false,
    depositChainBlockTimeMs: 0,
  };

  const steps = quote.userSteps ?? [];

  for (const step of steps) {
    checkAborted(abortSignal);

    if (step.type === 'TRANSACTION') {
      const resolvedKey = step.chainKey || quote.srcChainKey;
      const chainId = step.transaction?.encoded?.chainId
        || (resolvedKey ? keyToChainId(resolvedKey) : undefined);

      if (!skipChainSwitch && chainId) {
        const currentChainId = await resolveChainId(walletClient);
        if (currentChainId !== chainId) {
          onStep?.({ kind: 'chain-switch', chainId });
          await ChainSwitch(walletClient, chainId);
          // Brief settle delay to let the wallet finalize the network swap
          // before issuing the next request (matches widget timing).
          await new Promise((r) => setTimeout(r, 800));
        }
      }

      const wasApproval = await handleApprovalStep({
        step,
        walletClient,
        ownerAddress: userAddress,
        quote,
        env,
        onTxHash: (hash, kind) => {
          result.txHashes.push(hash);
          onTxHash?.(hash, kind);
          if (kind === 'approval-reset') onStep?.({ kind: 'approval-reset-sent', hash });
          else onStep?.({ kind: 'approval-sent', hash });
        },
      });

      if (wasApproval) {
        if (chainId && result.txHashes.length === 0) {
          // Decoded as approve but no tx was sent → already had sufficient
          // allowance.
          onStep?.({ kind: 'approval-skipped', tokenAddress: (step.transaction?.encoded?.to ?? step.to) ?? '', chainId });
        }
        continue;
      }

      if (validateBeforeSubmit) {
        const validation = validateBeforeSubmit();
        if (!validation.canSubmit) {
          throw new QuoteStaleError(validation.reason || 'Quote expired before deposit');
        }
      }

      result.isNativeDeposit = true;
      const srcConfig = chainId ? getChainConfig(chainId) : undefined;
      result.depositChainBlockTimeMs = srcConfig?.blockTimeMs ?? 5_000;

      const depositHash = await sendTransactionStep({
        step,
        walletClient,
        userAddress,
        fallbackChainKey: quote.srcChainKey,
      });
      result.txHashes.push(depositHash);
      onTxHash?.(depositHash, 'deposit');
      onStep?.({ kind: 'deposit-sent', hash: depositHash, chainId: chainId ?? 0 });
    } else if (step.type === 'SIGNATURE') {
      onStep?.({ kind: 'signing' });

      const sigChainId = (step.signature?.typedData?.domain as { chainId?: number | bigint })?.chainId;
      if (!skipChainSwitch && sigChainId != null) {
        const targetChainId = Number(sigChainId);
        const currentChainId = await resolveChainId(walletClient);
        if (currentChainId !== targetChainId) {
          onStep?.({ kind: 'chain-switch', chainId: targetChainId });
          await ChainSwitch(walletClient, targetChainId);
          await new Promise((r) => setTimeout(r, 200));
        }
      }

      const submitted = await signAndSubmit({
        quote,
        signatureStep: step,
        userAddress,
        walletClient,
        env,
        validateBeforeSubmit,
      });
      result.signature = submitted.signature;
      onStep?.({ kind: 'submitted', quoteId: submitted.quoteId, signature: submitted.signature });
    }
  }

  onStep?.({ kind: 'done', quoteId: quote.id });
  return result;
}
