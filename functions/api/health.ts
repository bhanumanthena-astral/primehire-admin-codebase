/**
 * Cloudflare Pages Function — health check.
 *
 * Route: GET /api/health
 * Mirrors the Express route in server.ts.
 */

interface HealthContext {
  request: Request;
}

export async function onRequest(context: HealthContext): Promise<Response> {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Max-Age': '86400',
      },
    });
  }
  return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
}
