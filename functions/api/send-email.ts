// Legacy Pages Functions deployments use the same authenticated FastAPI route.
export async function onRequest({ request, env }: {
  request: Request; env: { BACKEND_ORIGIN?: string };
}): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  let origin: URL;
  try {
    origin = new URL(env.BACKEND_ORIGIN || '');
    if (origin.protocol !== 'https:' || origin.origin === new URL(request.url).origin ||
        origin.username || origin.password) throw new Error();
  } catch {
    return new Response('Backend unavailable', { status: 503 });
  }
  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.set('Authorization', request.headers.get('Authorization') || '');
  return fetch(new URL('/api/send-email', origin), {
    method: 'POST', headers, body: request.body, redirect: 'error',
  });
}
