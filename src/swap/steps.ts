import {
  type Address,
  type Hash,
  type WalletClient,
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  maxUint256,
} from 'viem';
import { sendTransaction, signTypedData } from 'viem/actions';
import type { SdkEnvironment } from '../api/environment';
import { keyToChainId } from '../chains/chainKeys';
import { QuoteStaleError, isUserRejectionError } from '../errors';
import { submitSignature } from '../api/submit';
import type { VtQuote, VtUserStep } from '../types/vt';
import { getPublicClient } from './publicClients';
import { type SwapWalletClient } from './walletClient';

function resolveStepChainId(step: VtUserStep, fallbackKey?: string): number | undefined {
  const encodedChainId = step.transaction?.encoded?.chainId;
  if (encodedChainId) return encodedChainId;
  const key = step.chainKey || fallbackKey;
  return key ? keyToChainId(key) : undefined;
}

/**
 * Send a generic VT TRANSACTION step (typically the native deposit) using
 * viem's `sendTransaction`. Does NOT wait for the receipt — the caller decides
 * when to poll.
 */
export async function sendTransactionStep(params: {
  step: VtUserStep;
  walletClient: SwapWalletClient;
  userAddress: string;
  fallbackChainKey?: string;
}): Promise<Hash> {
  const { step, walletClient, userAddress, fallbackChainKey } = params;

  const encoded = step.transaction?.encoded;
  const to = encoded?.to ?? step.to;
  const data = encoded?.data ?? step.data;
  const value = encoded?.value ?? step.value;

  if (!to) throw new Error('Transaction step missing "to" address');

  const chainId = resolveStepChainId(step, fallbackChainKey);
  if (!chainId) {
    throw new Error(`Unknown chain for transaction step: ${step.chainKey ?? fallbackChainKey ?? 'unknown'}`);
  }

  return sendTransaction(walletClient as WalletClient, {
    account: userAddress as Address,
    chain: walletClient.chain ?? null,
    to: to as Address,
    data: (data || '0x') as `0x${string}`,
    value: BigInt(value || '0'),
  });
}

/**
 * Intercepts VT API approve steps. Detects approval from calldata, checks
 * current allowance, resets-to-0 for USDT-style tokens that require it, and
 * approves `maxUint256` so future trades never re-prompt.
 *
 * Returns:
 *  - `true` when the step was an approve call (approval was either skipped
 *    because allowance was already sufficient, or sent and confirmed).
 *  - `false` when the step is not an approve call and should be executed by
 *    `sendTransactionStep` instead.
 */
export async function handleApprovalStep(params: {
  step: VtUserStep;
  walletClient: SwapWalletClient;
  ownerAddress: string;
  quote: VtQuote;
  env: SdkEnvironment;
  onTxHash?: (hash: Hash, kind: 'approval-reset' | 'approval') => void;
}): Promise<boolean> {
  const { step, walletClient, ownerAddress, quote, env, onTxHash } = params;

  const encoded = step.transaction?.encoded;
  const tokenAddress = encoded?.to ?? step.to;
  const calldata = encoded?.data ?? step.data;
  if (!tokenAddress || !calldata) return false;

  let spender: Address;
  let requestedAmount: bigint;
  try {
    const { functionName, args } = decodeFunctionData({
      abi: erc20Abi,
      data: calldata as `0x${string}`,
    });
    if (functionName !== 'approve' || !args || args.length < 2) return false;
    spender = args[0] as Address;
    requestedAmount = args[1] as bigint;
  } catch {
    return false;
  }

  const chainId = resolveStepChainId(step, quote.srcChainKey);
  if (!chainId) return false;

  const publicClient = getPublicClient(env, chainId);

  const currentAllowance = (await publicClient.readContract({
    address: tokenAddress as Address,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [ownerAddress as Address, spender],
  })) as bigint;

  if (currentAllowance >= requestedAmount) return true;

  const baseTx = {
    account: ownerAddress as Address,
    chain: walletClient.chain ?? null,
    to: tokenAddress as Address,
    value: 0n,
  } as const;

  if (currentAllowance > 0n) {
    const resetData = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [spender, 0n],
    });
    const resetHash = await sendTransaction(walletClient as WalletClient, {
      ...baseTx,
      data: resetData,
    });
    onTxHash?.(resetHash, 'approval-reset');
    await publicClient.waitForTransactionReceipt({ hash: resetHash });
  }

  const approveData = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, maxUint256],
  });
  const approveHash = await sendTransaction(walletClient as WalletClient, {
    ...baseTx,
    data: approveData,
  });
  onTxHash?.(approveHash, 'approval');
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  return true;
}

export interface SignAndSubmitParams {
  quote: VtQuote;
  signatureStep: VtUserStep;
  userAddress: string;
  walletClient: SwapWalletClient;
  env: SdkEnvironment;
  /** Called immediately before POSTing the signature to the relayer. Throw to abort. */
  validateBeforeSubmit?: () => { canSubmit: boolean; reason?: string };
}

/**
 * Signs the EIP-712 typed-data step from the quote and POSTs the resulting
 * signature to `/submit-signature`. Caller is responsible for ensuring the
 * wallet is on the correct chain (via `ChainSwitch`).
 */
export async function signAndSubmit(
  params: SignAndSubmitParams,
): Promise<{ quoteId: string; signature: string }> {
  const { quote, signatureStep, userAddress, walletClient, env, validateBeforeSubmit } = params;

  if (!walletClient) throw new Error('Wallet client not available');
  if (signatureStep.type !== 'SIGNATURE' || !signatureStep.signature?.typedData) {
    throw new Error('Invalid signature step');
  }

  try {
    const typed = signatureStep.signature.typedData;

    const normalizedMessage: Record<string, unknown> = { ...typed.message };
    for (const key of ['inputAmount', 'outputAmount', 'startTime', 'endTime'] as const) {
      const v = normalizedMessage[key];
      if (v != null) normalizedMessage[key] = BigInt(v as string | number);
    }

    const signature = await signTypedData(walletClient as WalletClient, {
      account: userAddress as Address,
      domain: typed.domain as any,
      types: typed.types as any,
      primaryType: typed.primaryType,
      message: normalizedMessage,
    });

    if (validateBeforeSubmit) {
      const validation = validateBeforeSubmit();
      if (!validation.canSubmit) {
        throw new QuoteStaleError(validation.reason);
      }
    }

    await submitSignature({ quoteId: quote.id, signatures: [signature] }, env);
    return { quoteId: quote.id, signature };
  } catch (error) {
    if (error instanceof QuoteStaleError) throw error;
    if (isUserRejectionError(error)) {
      throw new Error('User rejected the signing request');
    }
    if (error instanceof Error && error.message.includes('chain')) {
      throw new Error('Chain switching failed. Please manually switch to the correct network.');
    }
    throw error;
  }
}
