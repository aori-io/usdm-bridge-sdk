export class QuoteStaleError extends Error {
  constructor(reason?: string) {
    super(reason || 'Quote expired before submission');
    this.name = 'QuoteStaleError';
  }
}

export class UnsupportedPairError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedPairError';
  }
}

export class ChainSwitchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChainSwitchError';
  }
}

export class WalletBlockedError extends Error {
  source?: 'blacklist' | 'chainalysis-oracle' | 'screening-url';
  constructor(message: string, source?: 'blacklist' | 'chainalysis-oracle' | 'screening-url') {
    super(message);
    this.name = 'WalletBlockedError';
    this.source = source;
  }
}

export class QuoteRequestError extends Error {
  /** HTTP status code, if available. */
  status?: number;
  /** True when the API returned 200 with an empty `quotes` array. */
  emptyQuotes?: boolean;
  constructor(message: string, opts: { status?: number; emptyQuotes?: boolean } = {}) {
    super(message);
    this.name = 'QuoteRequestError';
    this.status = opts.status;
    this.emptyQuotes = opts.emptyQuotes;
  }
}

export function isUserRejectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'UserRejectedRequestError' ||
    error.message.includes('User rejected') ||
    error.message.includes('rejected') ||
    error.message.includes('denied') ||
    error.message.includes('cancelled') ||
    error.message.includes('canceled')
  );
}
