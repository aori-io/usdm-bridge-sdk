/**
 * Types mirroring the LayerZero Value Transfer (VT) API responses.
 * Sourced from the widget's RfqProvider and pollOrderStatus.
 */

export interface VtTypedData {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  primaryType: string;
  message: Record<string, unknown>;
}

export interface VtEncodedTransaction {
  chainId?: number;
  to?: string;
  data?: string;
  value?: string;
  from?: string;
}

export interface VtUserStep {
  type: 'TRANSACTION' | 'SIGNATURE';
  chainKey?: string;
  chainType?: string;
  description?: string;
  signerAddress?: string;
  transaction?: {
    encoded?: VtEncodedTransaction;
  };
  to?: string;
  data?: string;
  value?: string;
  signature?: {
    type: string;
    typedData: VtTypedData;
  };
}

export interface VtRouteStep {
  type: string;
  srcChainKey?: string;
}

export interface VtTokenInfo {
  address: string;
  decimals: number;
  symbol: string;
  name?: string;
}

export interface VtQuote {
  id: string;
  srcChainKey: string;
  dstChainKey: string;
  srcToken: VtTokenInfo;
  dstToken: VtTokenInfo;
  srcAmount: string;
  dstAmount: string;
  srcAmountUsd?: string;
  dstAmountUsd?: string;
  feeUsd?: string;
  feePercent?: string;
  routeSteps?: VtRouteStep[];
  userSteps: VtUserStep[];
  duration?: { estimated?: string };
  /** Synthetic timestamp set by the SDK when the quote is received. */
  _receivedAt: number;
}

export interface VtQuotesResponse {
  quotes: VtQuote[];
}

export interface VtOrderStatus {
  status: string;
  srcTxHash?: string;
  dstTxHash?: string;
  explorerUrl?: string;
}
