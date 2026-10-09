/**
 * Cloudflare Pages Function — secure reverse proxy for the PrimeHire backend.
 *
 * Route: /api/backend/*  →  BACKEND_URL/*
 *
 * Browser (any allowed domain) → this Function (same Cloudflare deployment)
 * → backend. The browser never contacts the backend directly, so backend
 * CORS restrictions don't apply, and the x-access-key / x-secret-key
 * credentials never leave the server runtime.
 *
 * Destination is fixed to BACKEND_URL (env) — never derived from user
 * input — so this cannot be abused as an open proxy (no SSRF).
 */

interface ProxyEnv {
  BACKEND_URL?: string;
  PRIMEHIRE_ACCESS_KEY?: string;
  PRIMEHIRE_SECRET_KEY?: string;
  ALLOWED_ORIGINS?: string;
  PROXY_ORIGIN?: string;
  [key: string]: string | undefined;
}

interface ProxyContext {
  request: Request;
  env: ProxyEnv;
  params: Record<string, string | string[] | undefined>;
}

const DEFAULT_BACKEND_URL = 'https://api.placement.vils.ai/primehire/api/v1';
const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD';
const ALLOWED_HEADERS = 'Content-Type, Authorization, X-Requested-With, Accept';
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface AllowedRoute {
  method: string;
  pattern: RegExp;
}

const PROXY_ROUTE_ALLOWLIST: AllowedRoute[] = [
  { method: 'POST', pattern: /^\/assessment\/?$/ },
  { method: 'GET', pattern: /^\/assessment\/[a-zA-Z0-9_\-]+\/?$/ },
  { method: 'POST', pattern: /^\/interview\/?$/ },
  { method: 'PUT', pattern: /^\/interview\/[a-zA-Z0-9_\-]+\/reschedule\/?$/ },
  { method: 'GET', pattern: /^\/interview\/[a-zA-Z0-9_\-]+\/status\/?$/ },
  { method: 'GET', pattern: /^\/interview\/[a-zA-Z0-9_\-]+\/report\/?$/ },
  { method: 'GET', pattern: /^\/response\/report-not-generated\/?$/ },
  { method: 'PUT', pattern: /^\/candidate\/[a-zA-Z0-9_\-]+\/password\/?$/ },
];

function isProxyRouteAllowed(method: string, path: string): boolean {
  const normPath = path.startsWith('/') ? path : `/${path}`;
  return PROXY_ROUTE_ALLOWLIST.some(
    r => r.method === method.toUpperCase() && r.pattern.test(normPath)
  );
}

const ipProxyRateLimits = new Map<string, { count: number; resetAt: number }>();

function checkProxyRateLimit(ip: string, maxReqs = 60, windowMs = 60000): boolean {
  const now = Date.now();
  const entry = ipProxyRateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    ipProxyRateLimits.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxReqs) return false;
  entry.count++;
  return true;
}

/**
 * Decide which Origin (if any) gets CORS headers.
 * - Same-origin requests are always allowed.
 * - Cross-origin requests are allowed only when listed in ALLOWED_ORIGINS
 *   (comma-separated) or when ALLOWED_ORIGINS contains "*".
 * Returns null when the origin must not receive CORS headers.
 */
function resolveAllowedOrigin(request: Request, env: ProxyEnv): string | null {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  if (origin === new URL(request.url).origin) return origin;
  const allowed = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.includes('*') || allowed.includes(origin)) return origin;
  return null;
}

function corsHeaders(origin: string | null): Headers {
  const headers = new Headers();
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
    headers.set('Access-Control-Allow-Credentials', 'true');
  }
  return headers;
}

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
  const headers = corsHeaders(origin);
  headers.set('Content-Type', 'application/json');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers });
}

export async function onRequest(context: ProxyContext): Promise<Response> {
  const { request, env } = context;
  const corsOrigin = resolveAllowedOrigin(request, env);

  // CORS preflight — never touches the backend.
  if (request.method === 'OPTIONS') {
    const headers = corsHeaders(corsOrigin);
    headers.set('Access-Control-Allow-Methods', ALLOWED_METHODS);
    headers.set('Access-Control-Allow-Headers', ALLOWED_HEADERS);
    headers.set('Access-Control-Max-Age', '86400');
    return new Response(null, { status: 204, headers });
  }

  // ---- Client Rate Limiting (60 req/min per IP) ----
  const clientIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'default';
  if (!checkProxyRateLimit(clientIp, 60, 60000)) {
    return jsonResponse({ error: 'Too many requests to backend proxy. Rate limit exceeded.', status: 429 }, 429, corsOrigin);
  }

  // ---- Resolve the fixed destination (SSRF-safe: base is env-controlled) ----
  const rawParam = context.params.path;
  const segments = rawParam === undefined ? [] : Array.isArray(rawParam) ? rawParam : [rawParam];
  for (const seg of segments) {
    let decoded = seg;
    try {
      decoded = decodeURIComponent(seg);
    } catch {
      return jsonResponse({ error: 'Invalid path encoding', status: 400 }, 400, corsOrigin);
    }
    if (decoded === '.' || decoded === '..' || decoded.includes('://') || decoded.includes('\\')) {
      return jsonResponse({ error: 'Invalid path', status: 400 }, 400, corsOrigin);
    }
  }

  const suffix = segments.join('/');
  const normalizedPath = `/${suffix.replace(/^\/+/, '')}`;

  // ---- Strict Route & Method Allowlist ----
  if (!isProxyRouteAllowed(request.method, normalizedPath)) {
    console.warn(`[Proxy Guard] Blocked unauthorized route/method: ${request.method} ${normalizedPath}`);
    return jsonResponse(
      {
        error: 'Forbidden: Endpoint or HTTP method not permitted on PrimeHire proxy allowlist',
        status: 403,
        path: normalizedPath,
        method: request.method,
      },
      403,
      corsOrigin
    );
  }

  const base = (env.BACKEND_URL || DEFAULT_BACKEND_URL).replace(/\/+$/, '');
  const query = new URL(request.url).search;
  const targetUrl = suffix ? `${base}/${suffix}${query}` : `${base}${query}`;

  // ---- Server-side credentials (never exposed to the browser) ----
  const accessKey = (env.PRIMEHIRE_ACCESS_KEY || '').trim();
  const secretKey = (env.PRIMEHIRE_SECRET_KEY || '').trim();
  if (!accessKey || !secretKey) {
    console.error('[Proxy] PRIMEHIRE_ACCESS_KEY / PRIMEHIRE_SECRET_KEY are missing.');
    return jsonResponse(
      {
        status: 'ERROR',
        type: 'CONFIGURATION_ERROR',
        message:
          'PrimeHire credentials are not configured on the server (missing PRIMEHIRE_ACCESS_KEY / PRIMEHIRE_SECRET_KEY). Add them to the Pages environment variables and retry.',
      },
      500,
      corsOrigin
    );
  }

  // ---- Build the server-to-server request (allowlist of safe headers) ----
  // Allowlist only — hop-by-hop headers (Host, Connection, Content-Length,
  // Transfer-Encoding, etc.) are never forwarded. Credentials are injected
  // server-side below and never come from the browser.
  const outgoing = new Headers();
  const contentType = request.headers.get('content-type');
  if (contentType) outgoing.set('Content-Type', contentType);
  const accept = request.headers.get('accept');
  if (accept) outgoing.set('Accept', accept);
  const authorization = request.headers.get('authorization');
  if (authorization) outgoing.set('Authorization', authorization);
  const cookie = request.headers.get('cookie');
  if (cookie) outgoing.set('Cookie', cookie);
  const userAgent = request.headers.get('user-agent');
  if (userAgent) outgoing.set('User-Agent', userAgent);
  const requestedWith = request.headers.get('x-requested-with');
  if (requestedWith) outgoing.set('X-Requested-With', requestedWith);
  outgoing.set('x-access-key', accessKey);
  outgoing.set('x-secret-key', secretKey);
  if (env.PROXY_ORIGIN) outgoing.set('Origin', env.PROXY_ORIGIN);

  const init: RequestInit = { method: request.method, headers: outgoing };
  if (BODY_METHODS.has(request.method)) {
    const body = await request.arrayBuffer();
    if (body.byteLength > 0) {
      init.body = body;
      if (!outgoing.has('Content-Type')) outgoing.set('Content-Type', 'application/json');

      // Assessment question duration validation (Bug #7)
      if ((request.method === 'POST' || request.method === 'PUT') && /^\/assessment\/?$/.test(normalizedPath)) {
        try {
          const text = new TextDecoder().decode(body);
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed?.questions)) {
            for (let i = 0; i < parsed.questions.length; i++) {
              const q = parsed.questions[i];
              const dur = Number(q.max_duration ?? q.maxDuration);
              if (!Number.isFinite(dur) || dur < 1 || dur > 120) {
                return jsonResponse(
                  {
                    code: 'INVALID_MAX_DURATION',
                    message: `Question #${i + 1} max_duration must be between 1 and 120 seconds`,
                  },
                  422,
                  corsOrigin
                );
              }
            }
          }
        } catch {
          // Fall through to upstream if parsing fails
        }
      }
    }
  }

  // ---- Forward and relay the backend response verbatim ----
  try {
    const upstream = await fetch(targetUrl, init);
    const body = await upstream.arrayBuffer();
    const headers = corsHeaders(corsOrigin);
    headers.set('Cache-Control', 'no-store');
    const upstreamContentType = upstream.headers.get('content-type');
    if (upstreamContentType) headers.set('Content-Type', upstreamContentType);
    // Preserve download metadata (e.g. Content-Disposition for exports).
    const contentDisposition = upstream.headers.get('content-disposition');
    if (contentDisposition) headers.set('Content-Disposition', contentDisposition);
    // Relay cookies (cookie-based auth). getSetCookie() preserves multiple
    // Set-Cookie values where supported; fall back to a single header.
    const getSetCookie = (upstream.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    if (typeof getSetCookie === 'function') {
      for (const value of getSetCookie.call(upstream.headers)) {
        headers.append('Set-Cookie', value);
      }
    } else {
      const singleCookie = upstream.headers.get('set-cookie');
      if (singleCookie) headers.set('Set-Cookie', singleCookie);
    }
    return new Response(upstream.status === 204 || upstream.status === 304 ? null : body, {
      status: upstream.status,
      headers,
    });
  } catch (err) {
    console.error('[Proxy] Backend request failed:', err instanceof Error ? err.message : err);
    return jsonResponse({ error: 'Backend request failed', status: 502 }, 502, corsOrigin);
  }
}
