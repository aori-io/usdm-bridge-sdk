import type { SdkEnvironment } from './environment';

export interface SubmitSignatureParams {
  quoteId: string;
  signatures: string[];
}

/**
 * POST /submit-signature — relays a signed quote to the LayerZero VT API for
 * settlement. Throws when the API returns a non-2xx response.
 */
export async function submitSignature(
  params: SubmitSignatureParams,
  env: SdkEnvironment,
): Promise<void> {
  const res = await fetch(`${env.getVtApiUrl()}/submit-signature`, {
    method: 'POST',
    headers: env.getVtHeaders(),
    body: JSON.stringify({
      quoteId: params.quoteId,
      signatures: params.signatures,
    }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({} as any));
    const msg = (errBody as { message?: string })?.message || `Submit failed: ${res.status}`;
    throw new Error(msg);
  }
}
