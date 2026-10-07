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

const ipEmailRateLimits = new Map<string, { count: number; resetAt: number }>();

function checkEmailRateLimit(ip: string, maxReqs = 10, windowMs = 60000): boolean {
  const now = Date.now();
  const entry = ipEmailRateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    ipEmailRateLimits.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxReqs) return false;
  entry.count++;
  return true;
}

export async function onRequest(context: EmailContext): Promise<Response> {
  const { request, env } = context;
  const corsOrigin = resolveAllowedOrigin(request, env);

  if (request.method === 'OPTIONS') {
    const headers = corsHeaders(corsOrigin);
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cf-Access-Jwt-Assertion');
    headers.set('Access-Control-Max-Age', '86400');
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed', status: 405 }, 405, corsOrigin);
  }

  // Rate Limiting (10 req/min per IP)
  const clientIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'default';
  if (!checkEmailRateLimit(clientIp, 10, 60000)) {
    return jsonResponse({ error: 'Too many email dispatch requests. Please wait a minute before retrying.', status: 429 }, 429, corsOrigin);
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

  // Anti-open-relay protections:
  // 1. Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(toEmail)) {
    return jsonResponse({ error: 'Invalid recipient email address format', status: 400 }, 400, corsOrigin);
  }

  // 2. Validate subject matches legitimate candidate assessment communication
  const allowedSubjectPattern = /primehire|assessment|interview|invitation|reminder|evaluation|credentials/i;
  if (!allowedSubjectPattern.test(subject)) {
    return jsonResponse(
      { error: 'Subject does not match permitted recruiting communications template', status: 403 },
      403,
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
