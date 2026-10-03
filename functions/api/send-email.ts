/**
 * Cloudflare Pages Function — ZeptoMail email dispatch.
 *
 * Route: POST /api/send-email
 * Mirrors the Express route in server.ts so the deployed Pages app keeps
 * working without the Node server. The API key stays in the Pages
 * environment (ZEPTOMAIL_API_KEY) and is never sent to the browser.
 */

interface EmailEnv {
  ZEPTOMAIL_API_KEY?: string;
  ALLOWED_ORIGINS?: string;
  JWT_SECRET?: string;
  [key: string]: string | undefined;
}

interface EmailContext {
  request: Request;
  env: EmailEnv;
}

interface SendEmailBody {
  toEmail?: string;
  toName?: string;
  subject?: string;
  htmlBody?: string;
}

async function verifyJwt(token: string, secret: string): Promise<boolean> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [headerB64, payloadB64, signatureB64] = parts;

    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return false;
    if (payload.iss && payload.iss !== 'primehire') return false;
    if (payload.aud && payload.aud !== 'primehire') return false;

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const sigStr = atob(signatureB64.replace(/-/g, '+').replace(/_/g, '/'));
    const sigBytes = new Uint8Array(sigStr.length);
    for (let i = 0; i < sigStr.length; i++) {
      sigBytes[i] = sigStr.charCodeAt(i);
    }

    const data = enc.encode(`${headerB64}.${payloadB64}`);
    return await crypto.subtle.verify('HMAC', key, sigBytes, data);
  } catch {
    return false;
  }
}

function resolveAllowedOrigin(request: Request, env: EmailEnv): string | null {
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

export async function onRequest(context: EmailContext): Promise<Response> {
  const { request, env } = context;
  const corsOrigin = resolveAllowedOrigin(request, env);

  if (request.method === 'OPTIONS') {
    const headers = corsHeaders(corsOrigin);
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    headers.set('Access-Control-Max-Age', '86400');
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed', status: 405 }, 405, corsOrigin);
  }

  // Auth guard
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing or invalid authorization header', status: 401 }, 401, corsOrigin);
  }
  const token = authHeader.substring(7);
  if (env.JWT_SECRET) {
    const valid = await verifyJwt(token, env.JWT_SECRET);
    if (!valid) {
      return jsonResponse({ error: 'Unauthorized: Invalid or expired token', status: 401 }, 401, corsOrigin);
    }
  }

  const apiKey = (env.ZEPTOMAIL_API_KEY || '').trim();
  if (!apiKey) {
    console.error('[Email Proxy Error] ZeptoMail API key is missing in environment variables.');
    return jsonResponse({ error: 'ZeptoMail API key is missing on the server.' }, 500, corsOrigin);
  }

  let payload: SendEmailBody;
  try {
    payload = (await request.json()) as SendEmailBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body', status: 400 }, 400, corsOrigin);
  }

  const { toEmail, toName, subject, htmlBody } = payload;
  if (!toEmail || !subject || !htmlBody) {
    return jsonResponse(
      { error: 'Missing required fields: toEmail, subject, htmlBody', status: 400 },
      400,
      corsOrigin
    );
  }

  try {
    const response = await fetch('https://api.zeptomail.in/v1.1/email', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: apiKey,
      },
      body: JSON.stringify({
        from: { address: 'noreply@nxtagent.ai', name: 'PrimeHire Careers' },
        to: [{ email_address: { address: toEmail, name: toName || '' } }],
        subject,
        htmlbody: htmlBody,
      }),
    });

    const bodyText = await response.text();
    if (response.ok) {
      return jsonResponse({ success: true, details: bodyText }, 200, corsOrigin);
    }
    return jsonResponse({ success: false, error: bodyText }, response.status, corsOrigin);
  } catch (err) {
    console.error('[Email Proxy Error] Failed to transmit email:', err instanceof Error ? err.message : err);
    return jsonResponse({ success: false, error: 'Failed to transmit email' }, 500, corsOrigin);
  }
}
