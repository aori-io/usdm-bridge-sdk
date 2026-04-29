// ===========================
// Class facade — primary entry point
// ===========================
export { UsdmBridgeSdk } from './client/UsdmBridgeSdk';

// ===========================
// Config + error types
// ===========================
export type { UsdmBridgeConfig, TokenRef } from './config/types';
export {
  ChainSwitchError,
  QuoteRequestError,
  QuoteStaleError,
  UnsupportedPairError,
  WalletBlockedError,
  isUserRejectionError,
} from './errors';

// ===========================
// VT API types (mirrors LayerZero VT response shapes)
// ===========================
export type {
  VtEncodedTransaction,
  VtOrderStatus,
  VtQuote,
  VtQuotesResponse,
  VtRouteStep,
  VtTokenInfo,
  VtTypedData,
  VtUserStep,
} from './types/vt';

// ===========================
// Environment
// ===========================
export { DEFAULT_VT_API_URL, SdkEnvironment } from './api/environment';
export type { SdkEnvironmentInit } from './api/environment';

// ===========================
// Standalone API functions (tree-shakable; the class wraps these)
// ===========================
export { requestQuote } from './api/quotes';
export type { RequestQuoteParams, RequestQuoteContext } from './api/quotes';

export { submitSignature } from './api/submit';
export type { SubmitSignatureParams } from './api/submit';

export {
  isFailureStatus,
  isSuccessStatus,
  isTerminalStatus,
  pollOrderStatus,
} from './api/status';
export type { PollOrderStatusOptions } from './api/status';

// ===========================
// Swap primitives
// ===========================
export { ChainSwitch } from './swap/chainSwitch';
export {
  handleApprovalStep,
  sendTransactionStep,
  signAndSubmit,
} from './swap/steps';
export type { SignAndSubmitParams } from './swap/steps';
export { executeSwap } from './swap/execute';
export type {
  ExecuteSwapParams,
  ExecuteSwapResult,
  ExecutionStep,
} from './swap/execute';

export { bridge } from './swap/bridge';
export type { BridgeParams, BridgeResult } from './swap/bridge';

export type { SwapWalletClient } from './swap/walletClient';

// ===========================
// Screening
// ===========================
export { screenWallet } from './screening/walletScreening';
export type {
  ScreeningResult,
  WalletScreeningConfig,
} from './screening/walletScreening';

// ===========================
// Chain registry
// ===========================
export {
  CHAINS,
  SUPPORTED_CHAIN_IDS,
  chainIdToKey,
  getChainConfig,
  keyToChainId,
} from './chains/chainKeys';
export type { SdkChainConfig } from './chains/chainKeys';
