'use client';

import { useEffect, useMemo, useState } from 'react';
import { createWalletClient, custom, formatUnits, type Chain, type WalletClient } from 'viem';
import { arbitrum, base, mainnet, optimism } from 'viem/chains';
import { usePrivy, useWallets, type ConnectedWallet } from '@privy-io/react-auth';
import {
  UsdmBridgeSdk,
  type BridgeResult,
  type ExecutionStep,
  type VtOrderStatus,
  type VtQuote,
} from '@aori/usdm-bridge-sdk';
import {
  usdmBridgeConfig,
  INPUT_TOKENS,
  DEFAULT_INPUT,
  type InputTokenOption,
  USDM_MEGAETH,
  DST_CHAIN_ID,
  USDM_DECIMALS,
} from './aori.config';

const sdk = new UsdmBridgeSdk(usdmBridgeConfig);

// Lookup the viem Chain object for a given source chain id. Add new chains
// here when you extend INPUT_TOKENS in aori.config.ts.
const VIEM_CHAINS_BY_ID: Record<number, Chain> = {
  [base.id]:     base,
  [mainnet.id]:  mainnet,
  [arbitrum.id]: arbitrum,
  [optimism.id]: optimism,
};

// ── UX state machine ───────────────────────────────────────────────────────
//
//   input → quoting → confirm → executing → polling → done
//                                         ↘ error

type Stage =
  | { kind: 'input' }
  | { kind: 'quoting' }
  | { kind: 'confirm'; quote: VtQuote }
  | { kind: 'executing'; quote: VtQuote; step: string }
  | { kind: 'polling'; quoteId: string; status: VtOrderStatus | null }
  | { kind: 'done'; quoteId: string; finalStatus: VtOrderStatus }
  | { kind: 'error'; message: string; prev: Stage };

export default function Page() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();

  const activeWallet: ConnectedWallet | undefined = wallets[0];
  const account = activeWallet?.address as `0x${string}` | undefined;

  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
  const [amount, setAmount]         = useState('1');
  const [recipient, setRecipient]   = useState('');
  const [selectedInput, setSelectedInput] = useState<InputTokenOption>(DEFAULT_INPUT);
  const [stage, setStage]           = useState<Stage>({ kind: 'input' });

  const selectedChain = useMemo<Chain>(
    () => VIEM_CHAINS_BY_ID[selectedInput.chainId] ?? base,
    [selectedInput.chainId],
  );

  // Build (and rebuild) the viem WalletClient whenever the wallet or the
  // selected source chain changes. We pre-switch the wallet here so the user
  // gets immediate visual feedback that they're on the right network — the
  // SDK would also switch on demand inside `bridge()`, but pre-switching is
  // friendlier UX.
  useEffect(() => {
    let cancelled = false;
    if (!activeWallet) { setWalletClient(null); return; }
    (async () => {
      try {
        await activeWallet.switchChain(selectedInput.chainId);
        const provider = await activeWallet.getEthereumProvider();
        if (cancelled) return;
        setWalletClient(
          createWalletClient({
            account: activeWallet.address as `0x${string}`,
            chain: selectedChain,
            transport: custom(provider),
          }),
        );
      } catch (e) {
        if (!cancelled) setError(e);
      }
    })();
    return () => { cancelled = true; };
  }, [activeWallet, selectedInput.chainId, selectedChain]);

  // Default recipient to connected address.
  useEffect(() => {
    if (account && !recipient) setRecipient(account);
  }, [account, recipient]);

  // ── helpers ────────────────────────────────────────────────────────────

  function setError(e: unknown, prev?: Stage) {
    const msg = e instanceof Error ? e.message : String(e);
    setStage({ kind: 'error', message: msg, prev: prev ?? { kind: 'input' } });
  }

  function reset() {
    setStage({ kind: 'input' });
  }

  // ── stage transitions ──────────────────────────────────────────────────

  async function handleQuote() {
    if (!account) return;
    setStage({ kind: 'quoting' });
    try {
      const q = await sdk.getQuote({
        srcChainId:       selectedInput.chainId,
        dstChainId:       DST_CHAIN_ID,
        srcTokenAddress:  selectedInput.address,
        dstTokenAddress:  USDM_MEGAETH,
        amount,
        srcTokenDecimals: selectedInput.decimals,
        srcWalletAddress: account,
        dstWalletAddress: (recipient as `0x${string}`) || account,
      });
      setStage({ kind: 'confirm', quote: q });
    } catch (e) {
      setError(e, { kind: 'input' });
    }
  }

  async function handleExecute(quote: VtQuote) {
    if (!walletClient || !account) return;
    setStage({ kind: 'executing', quote, step: 'Starting...' });
    try {
      // Single end-to-end call: executeSwap → settle delay → pollStatus → hooks.
      // The same UI transitions still happen via onStep / onStatusChange, but
      // success/failure side effects live in onSuccess / onFailure.
      await sdk.bridge({
        quote,
        walletClient,
        userAddress: account,

        onStep: (step: ExecutionStep) =>
          setStage((s) =>
            s.kind === 'executing'
              ? { ...s, step: describeStep(step) }
              : { kind: 'executing', quote, step: describeStep(step) },
          ),

        onStatusChange: (status) =>
          setStage((prev) =>
            prev.kind === 'polling'
              ? { ...prev, status }
              : { kind: 'polling', quoteId: quote.id, status },
          ),

        onSuccess: async (result: BridgeResult) => {
          // Demo "embedding application" hook: anything you want to run when
          // the user's funds have actually settled on MegaETH. Could be a
          // backend POST to credit a balance, fire analytics, ping a webhook,
          // open a confetti modal, etc.
          // eslint-disable-next-line no-console
          console.log('[example] bridge succeeded', {
            quoteId: result.quoteId,
            dstTxHash: result.dstTxHash,
            dstAmount: result.quote.dstAmount,
            recipient,
          });
          setStage({ kind: 'done', quoteId: result.quoteId, finalStatus: result.status });
        },

        onFailure: (result: BridgeResult) => {
          setError(`Bridge ${result.status.status.toLowerCase()}`);
        },
      });
    } catch (e) {
      setError(e, { kind: 'input' });
    }
  }

  // ── wallet not ready yet ───────────────────────────────────────────────

  if (!ready) {
    return (
      <div className="shell">
        <div className="header"><span className="title">USDC → USDM</span></div>
        <div className="card signin-card"><p>Loading…</p></div>
      </div>
    );
  }

  const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  const busy = stage.kind === 'quoting' || stage.kind === 'executing' || stage.kind === 'polling';

  // ── render ─────────────────────────────────────────────────────────────

  return (
    <div className="shell">

      {/* Header */}
      <div className="header">
        <span className="title">USDC → USDM</span>
        {authenticated && account && (
          <span className="wallet-badge">
            <span className="addr">{shortAddr(account)}</span>
            <button className="sign-out" onClick={logout}>sign out</button>
          </span>
        )}
      </div>

      {/* Not connected */}
      {(!authenticated || !account) && (
        <div className="card signin-card">
          <p>Sign in to bridge USDC on Base<br />to USDM on MegaETH.</p>
          <button className="btn" onClick={login}>Sign in with Privy</button>
        </div>
      )}

      {/* Input stage */}
      {authenticated && account && (stage.kind === 'input' || stage.kind === 'error') && (
        <div className="card">
          {/* Token + amount */}
          <div className="field">
            <label>You send</label>
            <div className="amount-row">
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                disabled={busy}
              />
              <select
                className="token-select"
                value={`${selectedInput.chainId}:${selectedInput.address}`}
                onChange={(e) => {
                  const [chainIdStr, address] = e.target.value.split(':');
                  const next = INPUT_TOKENS.find(
                    (t) => t.chainId === Number(chainIdStr) && t.address.toLowerCase() === address?.toLowerCase(),
                  );
                  if (next) setSelectedInput(next);
                }}
                disabled={busy}
              >
                {INPUT_TOKENS.map((t) => (
                  <option key={`${t.chainId}:${t.address}`} value={`${t.chainId}:${t.address}`}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Recipient */}
          <div className="field">
            <label>Recipient on MegaETH</label>
            <input
              className="recipient-input"
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="0x..."
              disabled={busy}
            />
          </div>

          {stage.kind === 'error' && (
            <div className="error">{stage.message}</div>
          )}

          <button
            className="btn"
            onClick={handleQuote}
            disabled={!account || !walletClient || !amount || !recipient || busy}
          >
            Review bridge
          </button>
        </div>
      )}

      {/* Quoting spinner */}
      {stage.kind === 'quoting' && (
        <div className="card">
          <div className="field">
            <label>You send</label>
            <div className="amount-row">
              <input type="text" value={amount} disabled placeholder="0.00" />
              <span className="token-tag">{selectedInput.label}</span>
            </div>
          </div>
          <button className="btn" disabled>Fetching quote…</button>
        </div>
      )}

      {/* Confirm stage */}
      {stage.kind === 'confirm' && (() => {
        const q = stage.quote;
        const dst = formatUnits(BigInt(q.dstAmount), USDM_DECIMALS);
        const src = formatUnits(BigInt(q.srcAmount), q.srcToken?.decimals ?? selectedInput.decimals);
        const srcSymbol = q.srcToken?.symbol ?? selectedInput.symbol;
        // "USDC · Base" → ["USDC", "Base"] → "Base"
        const srcChainLabel = selectedInput.label.split('·').slice(1).join('·').trim() || '';
        const isCustomRecipient = recipient.toLowerCase() !== account?.toLowerCase();
        return (
          <div className="card">
            <div className="preview">
              <div className="preview-row">
                <span className="pk">You send</span>
                <span className="pv">
                  {src} {srcSymbol}
                  {srcChainLabel && <span style={{color:'#525252'}}> on {srcChainLabel}</span>}
                </span>
              </div>
              <hr className="divider" />
              <div>
                <div className="receive-big">{Number(dst).toLocaleString(undefined, { maximumFractionDigits: 4 })} USDM</div>
                <div className="receive-unit">on MegaETH</div>
              </div>
              {isCustomRecipient && (
                <div className="preview-row">
                  <span className="pk">To</span>
                  <span className="pv" style={{fontSize:'0.7rem',color:'#737373'}}>{shortAddr(recipient)}</span>
                </div>
              )}
              {q.feeUsd && (
                <div className="preview-row">
                  <span className="pk">Fee</span>
                  <span className="pv">${q.feeUsd}</span>
                </div>
              )}
              {q.duration?.estimated && (
                <div className="preview-row">
                  <span className="pk">Est. time</span>
                  <span className="pv">{q.duration.estimated}</span>
                </div>
              )}
            </div>
            <hr className="divider" />
            <div className="confirm-row">
              <button className="btn ghost" onClick={reset}>Edit</button>
              <button className="btn" onClick={() => handleExecute(stage.quote)}>
                Confirm & Bridge
              </button>
            </div>
          </div>
        );
      })()}

      {/* Executing */}
      {stage.kind === 'executing' && (
        <div className="card">
          <div className="status-card">
            <div className="status-headline">
              <span className="status-pill pending">In progress</span>
              <span className="step-label">{stage.step}</span>
            </div>
          </div>
        </div>
      )}

      {/* Polling */}
      {stage.kind === 'polling' && (
        <div className="card">
          <div className="status-card">
            <div className="status-headline">
              <span className="status-pill pending">
                {stage.status?.status ?? 'Submitted'}
              </span>
              <span className="step-label">Waiting for settlement…</span>
            </div>
          </div>
        </div>
      )}

      {/* Done */}
      {stage.kind === 'done' && (() => {
        const s = stage.finalStatus;
        const succeeded = ['SUCCEEDED', 'COMPLETED'].includes(s.status.toUpperCase());
        return (
          <div className="card">
            <div className="status-card">
              <div className="status-headline">
                <span className={`status-pill${succeeded ? '' : ' failed'}`}>
                  {succeeded ? 'Bridged' : s.status}
                </span>
              </div>
              {s.srcTxHash && (
                <div className="preview-row">
                  <span className="pk">Source tx</span>
                  <span className="pv" style={{fontSize:'0.68rem',color:'#525252'}}>{shortAddr(s.srcTxHash)}</span>
                </div>
              )}
              {s.dstTxHash && (
                <div className="preview-row">
                  <span className="pk">Dest tx</span>
                  <span className="pv" style={{fontSize:'0.68rem',color:'#525252'}}>{shortAddr(s.dstTxHash)}</span>
                </div>
              )}
              {s.explorerUrl && (
                <a className="tx-link" href={s.explorerUrl} target="_blank" rel="noreferrer">
                  View on explorer ↗
                </a>
              )}
            </div>
            <hr className="divider" />
            <button className="btn" onClick={reset}>Bridge again</button>
          </div>
        );
      })()}

    </div>
  );
}

function describeStep(step: ExecutionStep): string {
  switch (step.kind) {
    case 'chain-switch':        return `Switching to chain ${step.chainId}…`;
    case 'approval-skipped':    return 'Allowance sufficient, skipping approval.';
    case 'approval-reset-sent': return 'Resetting allowance…';
    case 'approval-sent':       return 'Approving USDC…';
    case 'deposit-sent':        return 'Sending deposit…';
    case 'signing':             return 'Sign in your wallet…';
    case 'submitted':           return 'Transaction submitted.';
    case 'done':                return 'Done.';
  }
}
