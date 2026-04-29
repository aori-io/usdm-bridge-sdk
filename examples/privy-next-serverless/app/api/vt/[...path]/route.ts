import { NextResponse, type NextRequest } from 'next/server';

/**
 * Catch-all proxy for the LayerZero Value Transfer (VT) API.
 *
 * Why this exists:
 *
 *   The browser-side SDK in this example is configured with
 *   `vtApiBaseUrl: '/api/vt'` instead of a direct API key. Every call the SDK
 *   makes (`POST /quotes`, `POST /submit-signature`, `GET /status/{id}`)
 *   lands here, and this route forwards it to the real LayerZero API with
 *   `x-api-key` injected from a *server-only* env var (`VT_API_KEY`, no
 *   `NEXT_PUBLIC_` prefix). The key is never sent to the browser.
 *
 *   To keep this example self-contained the proxy is intentionally minimal:
 *   it forwards method, path, query string, body, and any client headers
 *   that aren't auth-related. Add rate limiting / per-user gating / request
 *   logging here as your deployment requires.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPSTREAM_BASE = process.env.VT_API_UPSTREAM ?? 'https://transfer.layerzero-api.com/v1';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  // We replace these ourselves:
  'host',
  'content-length',
  'x-api-key',
  'authorization',
  'cookie',
]);

function buildUpstreamUrl(req: NextRequest, path: string[]): string {
  const search = req.nextUrl.search ?? '';
  return `${UPSTREAM_BASE}/${path.join('/')}${search}`;
}

function pickForwardedHeaders(req: NextRequest): Headers {
  const out = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) out.set(key, value);
  });
  return out;
}

async function proxy(req: NextRequest, path: string[]): Promise<Response> {
  const apiKey = process.env.VT_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'VT_API_KEY is not configured on the server.' },
      { status: 500 },
    );
  }

  const headers = pickForwardedHeaders(req);
  headers.set('x-api-key', apiKey);
  headers.set('accept', 'application/json');

  const init: RequestInit = {
    method: req.method,
    headers,
    // GET/HEAD must not have a body. Everything else streams the request body
    // straight through (Next.js gives us a ReadableStream).
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
    // Required by undici when streaming a body in Node 18+.
    // @ts-expect-error - duplex is not yet in lib.dom.d.ts
    duplex: 'half',
    redirect: 'manual',
  };

  let upstream: Response;
  try {
    upstream = await fetch(buildUpstreamUrl(req, path), init);
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to reach LayerZero VT API', detail: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  // Strip headers that should not be forwarded back to the browser as-is.
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('content-length');
  responseHeaders.delete('transfer-encoding');

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

interface RouteContext {
  params: Promise<{ path?: string[] }>;
}

async function handler(req: NextRequest, ctx: RouteContext): Promise<Response> {
  const { path = [] } = await ctx.params;
  return proxy(req, path);
}

export const GET     = handler;
export const POST    = handler;
export const PUT     = handler;
export const PATCH   = handler;
export const DELETE  = handler;
export const OPTIONS = handler;
