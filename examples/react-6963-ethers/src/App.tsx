import { useEffect, useState } from 'react';
import { BrowserProvider, formatUnits } from 'ethers';
import {
  ChainSwitch,
  UsdmBridgeSdk,
  type BridgeResult,
  type ExecutionStep,
  type SwapWalletClient,
  type VtOrderStatus,
  type VtQuote,
} from '@aori/usdm-bridge-sdk';
import { ethersSignerToWalletClient } from '@aori/usdm-bridge-sdk/ethers';
import {
  usdmBridgeConfig,
  INPUT_TOKENS,
  DEFAULT_INPUT,
  type InputTokenOption,
  USDM_MEGAETH,
  DST_CHAIN_ID,
  USDM_DECIMALS,
} from './aori.config';
import { useEip6963, type Eip6963ProviderDetail } from './useEip6963';

const sdk = new UsdmBridgeSdk(usdmBridgeConfig);

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

/**
 * Captured trace of the demo side-effect we run inside `onSuccess`. This is
 * just for the UI to prove the hook fired; in a real integrator app this is
 * where you'd POST to your backend, fire analytics, open a confetti modal,
 * grant the user something in your system, etc.
 */
interface SuccessHookTrace {
  firedAt: Date;
  endpoint: string;
  payload: Record<string, unknown>;
  mockResponse: { ok: true; creditedUserId: string };
}

export default function App() {
  const { providers, selected, account, connect, disconnect } = useEip6963();

  const [walletClient, setWalletClient] = useState<SwapWalletClient | null>(null);
  const [amount, setAmount]         = useState('1');
  const [recipient, setRecipient]   = useState('');
  const [selectedInput, setSelectedInput] = useState<InputTokenOption>(DEFAULT_INPUT);
  const [stage, setStage]           = useState<Stage>({ kind: 'input' });
  const [successHook, setSuccessHook] = useState<SuccessHookTrace | null>(null);

  // Build (and rebuild) the SDK-facing wallet client whenever the wallet or
  // the selected source chain changes.
  //
  // The flow is:
  //   EIP-6963 provider  →  ethers.BrowserProvider  →  JsonRpcSigner
  //                       →  ethersSignerToWalletClient  →  SwapWalletClient
  //
  // `ethersSignerToWalletClient` (from `@aori/usdm-bridge-sdk/ethers`) wraps
  // the ethers Signer in a tiny EIP-1193 shim and hands the SDK back a viem
  // WalletClient. The SDK's swap pipeline runs on viem internally regardless
  // of which adapter you use — see this example's README for the trade-off.
  // What the adapter buys you is that *your* application code never imports
  // viem.
  //
  // We pre-switch the wallet here so the user gets immediate visual feedback
  // that they're on the right network — the SDK would also switch on demand
  // inside `bridge()`, but pre-switching is friendlier UX. We reuse the SDK's
  // own `ChainSwitch` primitive to stay honest about its public surface.
  useEffect(() => {
    let cancelled = false;
    if (!selected || !account) { setWalletClient(null); return; }

    (async () => {
      try {
        // `'any'` as the network arg tells ethers not to lock the provider to
        // the network it sees on first connect. Without it, every
        // wallet_switchEthereumChain triggered by the bridge (or by the user)
        // would throw "network changed" inside ethers' internals.
        const browserProvider = new BrowserProvider(selected.provider, 'any');
        const signer = await browserProvider.getSigner();
        const client = await ethersSignerToWalletClient(signer, {
          address: account,
          chain: { id: selectedInput.chainId },
        });
        await ChainSwitch(client, selectedInput.chainId);
        if (cancelled) return;
        setWalletClient(client);
      } catch (e) {
        if (!cancelled) setError(e);
      }
    })();
    return () => { cancelled = true; };
  }, [selected, account, selectedInput.chainId]);

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
    setSuccessHook(null);
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
      // Identical call site to the viem flavor of this example — the SDK
      // doesn't know (or care) that the WalletClient came from an ethers
      // Signer wrapped by `ethersSignerToWalletClient` rather than from
      // viem's `createWalletClient` directly.
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
          // ▼ ─────────────────────────────────────────────────────────── ▼
          // INTEGRATOR EXTENSION POINT
          // This hook fires once the user's funds have actually settled on
          // MegaETH (i.e. the destination tx is observable). Anything you
          // want to run "when the bridge completes" lives here:
          //   - POST to your backend to credit an off-chain balance
          //   - fire analytics
          //   - ping a webhook
          //   - open a confetti modal
          //   - kick off the next step in your app's onboarding flow
          //   - etc.
          //
          // Below we simulate a backend POST so the example UI can render a
          // visible "✓ onSuccess fired" callout and prove arbitrary code ran.
          // Replace this with whatever your app actually needs to do.
          // ▲ ─────────────────────────────────────────────────────────── ▲

          const dstAmount = formatUnits(result.quote.dstAmount, USDM_DECIMALS);
          const trace: SuccessHookTrace = {
            firedAt: new Date(),
            endpoint: 'POST /api/credit-balance',
            payload: {
              userId: account,
              amountUsdm: dstAmount,
              quoteId: result.quoteId,
              dstTxHash: result.dstTxHash,
            },
            mockResponse: { ok: true, creditedUserId: account },
          };
          // Pretend we did a fetch(). In a real app this would be:
          //   await fetch('/api/credit-balance', { method: 'POST', body: JSON.stringify(payload) });
          // eslint-disable-next-line no-console
          console.log('[example onSuccess] would call', trace.endpoint, trace.payload);
          setSuccessHook(trace);

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

  const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  const busy = stage.kind === 'quoting' || stage.kind === 'executing' || stage.kind === 'polling';
  const connected = !!selected && !!account;

  // ── render ─────────────────────────────────────────────────────────────

  return (
    <div className="shell">

      {/* Header */}
      <div className="header">
        <span className="title">USDC → USDM</span>
        {connected && account && (
          <span className="wallet-badge">
            {selected?.info.icon && (
              <img src={selected.info.icon} alt="" width={14} height={14} />
            )}
            <span className="addr">{shortAddr(account)}</span>
            <button className="sign-out" onClick={disconnect}>disconnect</button>
          </span>
        )}
      </div>

      {/* Wallet picker */}
      {!connected && (
        <WalletPicker providers={providers} onConnect={connect} onError={setError} />
      )}

      {/* Input stage */}
      {connected && account && (stage.kind === 'input' || stage.kind === 'error') && (
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
        const dst = formatUnits(q.dstAmount, USDM_DECIMALS);
        const src = formatUnits(q.srcAmount, q.srcToken?.decimals ?? selectedInput.decimals);
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

            {successHook && <SuccessHookCallout trace={successHook} />}

            <hr className="divider" />
            <button className="btn" onClick={reset}>Bridge again</button>
          </div>
        );
      })()}

    </div>
  );
}

// ── onSuccess demo callout ─────────────────────────────────────────────────
//
// Renders the trace captured inside `sdk.bridge`'s `onSuccess` hook so the
// example can prove at runtime that arbitrary integrator code ran when the
// destination transaction settled. In a real app you would replace the body
// of `onSuccess` with whatever your application actually needs to do (POST
// to your backend, fire analytics, etc.); this UI just visualizes the fact
// that the hook fired.

function SuccessHookCallout({ trace }: { trace: SuccessHookTrace }) {
  return (
    <div className="success-hook-card">
      <div className="success-hook-headline">
        <span className="success-hook-pill">onSuccess fired</span>
        <span className="success-hook-time">
          {trace.firedAt.toLocaleTimeString()}
        </span>
      </div>
      <div className="success-hook-line">{trace.endpoint}</div>
      <pre className="success-hook-payload">
        {JSON.stringify(trace.payload, null, 2)}
      </pre>
      <div className="success-hook-line success-hook-response">
        ↳ {JSON.stringify(trace.mockResponse)}
      </div>
      <div className="success-hook-footer">
        Replace this hook in <code>src/App.tsx</code> to wire real side effects.
      </div>
    </div>
  );
}

// ── Wallet picker ──────────────────────────────────────────────────────────
//
// One button per wallet that announced itself via EIP-6963. If no wallet has
// announced (empty array), prompt the user to install one.

function WalletPicker(props: {
  providers: Eip6963ProviderDetail[];
  onConnect: (detail: Eip6963ProviderDetail) => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const { providers, onConnect, onError } = props;

  if (providers.length === 0) {
    return (
      <div className="card signin-card">
        <p>
          No EIP-6963 wallet detected.<br />
          Install MetaMask, Rabby, Phantom, Coinbase Wallet, or any
          modern browser wallet to continue.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="field">
        <label>Connect a wallet</label>
        <div className="wallet-list">
          {providers.map((p) => (
            <button
              key={p.info.uuid}
              className="wallet-option"
              onClick={() => onConnect(p).catch(onError)}
            >
              <img src={p.info.icon} alt="" width={20} height={20} />
              <span>{p.info.name}</span>
            </button>
          ))}
        </div>
      </div>
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
