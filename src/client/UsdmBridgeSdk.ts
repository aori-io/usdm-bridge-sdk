import type { Hash } from 'viem';
import { SdkEnvironment } from '../api/environment';
import {
  type RequestQuoteParams,
  requestQuote,
} from '../api/quotes';
import { submitSignature, type SubmitSignatureParams } from '../api/submit';
import {
  type PollOrderStatusOptions,
  pollOrderStatus,
} from '../api/status';
import type { UsdmBridgeConfig, TokenRef } from '../config/types';
import { UnsupportedPairError } from '../errors';
import {
  type ScreeningResult,
  screenWallet,
} from '../screening/walletScreening';
import {
  type BridgeParams,
  type BridgeResult,
  bridge,
} from '../swap/bridge';
import {
  type ExecuteSwapParams,
  type ExecuteSwapResult,
  executeSwap,
} from '../swap/execute';
import {
  type SignAndSubmitParams,
  handleApprovalStep,
  sendTransactionStep,
  signAndSubmit,
} from '../swap/steps';
import { type SwapWalletClient } from '../swap/walletClient';
import type { VtOrderStatus, VtQuote, VtUserStep } from '../types/vt';

const sameTokenRef = (a: TokenRef, b: { chainId: number; address: string }) =>
  a.chainId === b.chainId && a.address.toLowerCase() === b.address.toLowerCase();

export class UsdmBridgeSdk {
  readonly config: UsdmBridgeConfig;
  readonly env: SdkEnvironment;

  constructor(config: UsdmBridgeConfig = {}) {
    this.config = config;
    this.env = new SdkEnvironment({
      apiKey: config.apiKey,
      vtApiBaseUrl: config.vtApiBaseUrl,
      rpcOverrides: config.rpcOverrides,
    });
  }

  /**
   * Validates that the input/output pair satisfies the integrator's
   * `tokens.supported*` allow-lists. This is the primary mechanism for binding
   * one side of the pair to USDM (or any other asset) — set
   * `supportedOutputTokens: [{ chainId: 4326, address: USDM }]` and any quote
   * request that doesn't match will throw `UnsupportedPairError`.
   */
  isPairAllowed(
    input: { chainId: number; address: string },
    output: { chainId: number; address: string },
  ): boolean {
    const t = this.config.tokens;
    if (!t) return true;

    if (t.supportedInputChains?.length && !t.supportedInputChains.includes(input.chainId)) return false;
    if (t.supportedOutputChains?.length && !t.supportedOutputChains.includes(output.chainId)) return false;
    if (
      t.supportedInputTokens?.length &&
      !t.supportedInputTokens.some((ref) => sameTokenRef(ref, input))
    ) return false;
    if (
      t.supportedOutputTokens?.length &&
      !t.supportedOutputTokens.some((ref) => sameTokenRef(ref, output))
    ) return false;

    return true;
  }

  /**
   * Fetch a single quote from the LayerZero VT API. Enforces
   * `tokens.supported*` allow-lists before hitting the network.
   */
  async getQuote(params: RequestQuoteParams): Promise<VtQuote> {
    const input = { chainId: params.srcChainId, address: params.srcTokenAddress };
    const output = { chainId: params.dstChainId, address: params.dstTokenAddress };
    if (!this.isPairAllowed(input, output)) {
      throw new UnsupportedPairError(
        `Pair not allowed by SDK config: ${input.chainId}:${input.address} -> ${output.chainId}:${output.address}`,
      );
    }

    const defaultFeeTolerancePercent =
      this.config.settings?.defaultSlippage != null
        ? this.config.settings.defaultSlippage * 100
        : undefined;

    return requestQuote(params, {
      env: this.env,
      defaultFeeTolerancePercent,
      defaultTimeoutMs: this.config.settings?.quoteTimeoutMs,
    });
  }

  /**
   * High-level swap orchestration. See `executeSwap` in `swap/execute.ts` for
   * the per-step semantics.
   */
  executeSwap(params: ExecuteSwapParams): Promise<ExecuteSwapResult> {
    return executeSwap(params, this.env);
  }

  /**
   * One-shot end-to-end bridge: runs `executeSwap`, waits the deposit-chain
   * settle delay, polls until terminal status, and fires
   * `onSuccess`/`onFailure`/`onSettled` with a single `BridgeResult`. Use this
   * when you want a single call that resolves only after the destination-chain
   * tx is observable. See `bridge` in `swap/bridge.ts`.
   */
  bridge(params: BridgeParams): Promise<BridgeResult> {
    return bridge(params, this.env);
  }

  /**
   * Poll `/status/{quoteId}` until terminal status, deadline, or abort.
   * Defaults to `settings.pollingIntervalMs` and `settings.statusTimeoutMs`.
   */
  pollStatus(
    quoteId: string,
    opts: PollOrderStatusOptions = {},
  ): Promise<VtOrderStatus> {
    return pollOrderStatus(quoteId, this.env, {
      interval: this.config.settings?.pollingIntervalMs,
      timeout: this.config.settings?.statusTimeoutMs,
      ...opts,
    });
  }

  // ── Low-level primitives (also exported as standalone fns) ────────────────

  handleApprovalStep(params: {
    step: VtUserStep;
    walletClient: SwapWalletClient;
    ownerAddress: string;
    quote: VtQuote;
    onTxHash?: (hash: Hash, kind: 'approval-reset' | 'approval') => void;
  }): Promise<boolean> {
    return handleApprovalStep({ ...params, env: this.env });
  }

  sendTransactionStep(params: {
    step: VtUserStep;
    walletClient: SwapWalletClient;
    userAddress: string;
    fallbackChainKey?: string;
  }): Promise<Hash> {
    return sendTransactionStep(params);
  }

  signAndSubmit(params: Omit<SignAndSubmitParams, 'env'>): Promise<{ quoteId: string; signature: string }> {
    return signAndSubmit({ ...params, env: this.env });
  }

  submitSignature(params: SubmitSignatureParams): Promise<void> {
    return submitSignature(params, this.env);
  }

  screenWallet(address: string): Promise<ScreeningResult> {
    return screenWallet(address, this.config.walletScreening);
  }
}
