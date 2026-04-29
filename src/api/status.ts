import type { SdkEnvironment } from './environment';
import type { VtOrderStatus } from '../types/vt';

export interface PollOrderStatusOptions {
  onStatusChange?: (status: VtOrderStatus) => void;
  /**
   * Fires once for any terminal state (success **or** failure). Equivalent to
   * `onSettled`. Kept for backward compatibility — prefer the semantic
   * `onSuccess` / `onFailure` / `onSettled` hooks for new code.
   */
  onComplete?: (status: VtOrderStatus) => void | Promise<void>;
  /** Fires once when the order reaches `SUCCEEDED` or `COMPLETED`. Awaited before the promise resolves. */
  onSuccess?: (status: VtOrderStatus) => void | Promise<void>;
  /** Fires once when the order reaches `FAILED` or `CANCELLED`. Awaited before the promise resolves. */
  onFailure?: (status: VtOrderStatus) => void | Promise<void>;
  /** Fires once on any terminal state. Awaited before the promise resolves. */
  onSettled?: (status: VtOrderStatus) => void | Promise<void>;
  onError?: (error: Error) => void;
  /** Poll interval (ms). Default 4000. */
  interval?: number;
  /** Total polling deadline (ms). Default 300000. */
  timeout?: number;
  /** Optional source-chain tx hash, forwarded to the status endpoint as `?txHash=`. */
  txHash?: string;
  /** Abort the poll loop early. */
  signal?: AbortSignal;
}

const SUCCESS_STATUSES = ['SUCCEEDED', 'COMPLETED'] as const;
const FAILURE_STATUSES = ['FAILED', 'CANCELLED'] as const;
const TERMINAL_STATUSES: readonly string[] = [...SUCCESS_STATUSES, ...FAILURE_STATUSES];

/** True when the status string represents a terminal state (any outcome). */
export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.includes(status.toUpperCase());
}

/** True when the status string represents a successful settlement. */
export function isSuccessStatus(status: string): boolean {
  return (SUCCESS_STATUSES as readonly string[]).includes(status.toUpperCase());
}

/** True when the status string represents a failed/cancelled settlement. */
export function isFailureStatus(status: string): boolean {
  return (FAILURE_STATUSES as readonly string[]).includes(status.toUpperCase());
}

/**
 * Polls GET /status/{quoteId} until a terminal status is reached, the
 * deadline elapses, or the abort signal fires. Mirrors the resilience tactics
 * from the widget's `pollOrderStatus`: 404s and "not found" 400s during the
 * settlement warm-up window keep retrying up to per-class limits.
 */
export async function pollOrderStatus(
  quoteId: string,
  env: SdkEnvironment,
  options: PollOrderStatusOptions = {},
): Promise<VtOrderStatus> {
  const {
    onStatusChange,
    onComplete,
    onSuccess,
    onFailure,
    onSettled,
    onError,
    interval = 4_000,
    timeout = 300_000,
    txHash,
    signal,
  } = options;

  const baseUrl = env.getVtApiUrl();

  let lastStatus: string | null = null;
  const startTime = Date.now();
  let consecutiveErrorCount = 0;
  const MAX_CONSECUTIVE_ERRORS = 8;
  let consecutive400Count = 0;
  const MAX_CONSECUTIVE_400 = 10;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const queryString = txHash ? `?txHash=${txHash}` : '';

  return new Promise<VtOrderStatus>((resolve, reject) => {
    const checkStatus = async (): Promise<void> => {
      try {
        if (signal?.aborted) {
          if (timeoutId) clearTimeout(timeoutId);
          reject(new DOMException('Polling aborted', 'AbortError'));
          return;
        }

        if (Date.now() - startTime > timeout) {
          if (timeoutId) clearTimeout(timeoutId);
          const error = new Error('Order status polling timed out');
          onError?.(error);
          reject(error);
          return;
        }

        const response = await fetch(`${baseUrl}/status/${quoteId}${queryString}`, {
          headers: env.getVtHeaders(),
          signal,
        });

        if (response.status === 404) {
          timeoutId = setTimeout(checkStatus, interval);
          return;
        }

        if (response.status === 400) {
          const body = await response.text();
          if (body.includes('not found') || body.includes('expired')) {
            if (++consecutive400Count >= MAX_CONSECUTIVE_400) {
              if (timeoutId) clearTimeout(timeoutId);
              const err = new Error('Order expired or not found');
              onError?.(err);
              reject(err);
              return;
            }
            timeoutId = setTimeout(checkStatus, interval);
            return;
          }
          throw new Error(`Failed to fetch order status: ${body}`);
        }

        if (!response.ok) {
          throw new Error(`Failed to fetch order status: ${await response.text()}`);
        }

        const status = (await response.json()) as VtOrderStatus;

        if (!status || typeof status !== 'object' || !status.status) {
          throw new Error(`Invalid status response format: ${JSON.stringify(status)}`);
        }

        consecutiveErrorCount = 0;
        consecutive400Count = 0;

        const normalized = status.status.toUpperCase();

        if (normalized !== lastStatus) {
          lastStatus = normalized;
          onStatusChange?.(status);
        }

        if (TERMINAL_STATUSES.includes(normalized)) {
          if (timeoutId) clearTimeout(timeoutId);
          try {
            if (isSuccessStatus(normalized)) {
              await onSuccess?.(status);
            } else {
              await onFailure?.(status);
            }
            await onSettled?.(status);
            await onComplete?.(status);
          } catch (hookError) {
            const err = hookError instanceof Error ? hookError : new Error(String(hookError));
            onError?.(err);
            reject(err);
            return;
          }
          resolve(status);
          return;
        }

        timeoutId = setTimeout(checkStatus, interval);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          if (timeoutId) clearTimeout(timeoutId);
          reject(error);
          return;
        }

        if (++consecutiveErrorCount >= MAX_CONSECUTIVE_ERRORS) {
          if (timeoutId) clearTimeout(timeoutId);
          const err = error instanceof Error ? error : new Error(String(error));
          onError?.(err);
          reject(err);
          return;
        }

        timeoutId = setTimeout(checkStatus, interval);
      }
    };

    void checkStatus();
  });
}
