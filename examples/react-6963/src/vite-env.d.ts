/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Direct LayerZero VT API key. Visible in client bundle — only use for
   * local development. For production, switch to the proxy pattern shown in
   * the sibling `privy-next-serverless` example.
   */
  readonly VITE_VT_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
