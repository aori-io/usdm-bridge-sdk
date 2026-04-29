/**
 * Per-instance environment for the SDK. Unlike the widget's module-scoped
 * setters, this is held on each `UsdmBridgeSdk` instance so multiple SDKs can
 * coexist (e.g. one with a proxy, one with a direct API key).
 */

export const DEFAULT_VT_API_URL = 'https://transfer.layerzero-api.com/v1';

export interface SdkEnvironmentInit {
  apiKey?: string;
  vtApiBaseUrl?: string;
  rpcOverrides?: Partial<Record<number, string | string[]>>;
}

export class SdkEnvironment {
  apiKey?: string;
  vtApiBaseUrl?: string;
  rpcOverrides: Partial<Record<number, string | string[]>>;

  constructor(init: SdkEnvironmentInit = {}) {
    this.apiKey = init.apiKey;
    this.vtApiBaseUrl = init.vtApiBaseUrl;
    this.rpcOverrides = init.rpcOverrides ?? {};
  }

  getVtApiUrl(): string {
    return this.vtApiBaseUrl || DEFAULT_VT_API_URL;
  }

  /**
   * Build outgoing headers for the VT API.
   *
   * Mirrors the widget: when `vtApiBaseUrl` is set we assume an integrator
   * proxy is injecting the key server-side and we omit `x-api-key` from the
   * client. The key is only sent over the wire when hitting the API directly.
   */
  getVtHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!this.vtApiBaseUrl && this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }
    return headers;
  }

  /**
   * Resolve RPC URLs for a chain: integrator overrides first, then the
   * `defaultUrls` (from the chain registry) as fallback.
   */
  getRpcUrlsForChain(chainId: number, defaultUrls: string[] = []): string[] {
    const override = this.rpcOverrides[chainId];
    if (!override) return defaultUrls;
    const overrideUrls = Array.isArray(override) ? override : [override];
    return [...overrideUrls, ...defaultUrls];
  }
}
