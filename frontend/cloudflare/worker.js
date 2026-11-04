/** Same-origin Pages gateway. Business logic, authentication and secrets stay in Oracle. */
const METHODS = new Set(['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']);
const REQUEST_HEADERS = ['accept','accept-language','authorization','cookie','content-type',
  'idempotency-key','if-match','if-none-match','range','if-range','origin'];
const RESPONSE_HEADERS = ['content-type','content-disposition','content-length','content-range',
  'content-encoding','accept-ranges','retry-after','etag','last-modified','x-total-count','x-request-id','www-authenticate'];

function problem(status, code, detail) {
  return new Response(JSON.stringify({code,detail}),{status,headers:{
    'Content-Type':'application/json','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  }});
}

function backendOrigin(raw, frontendOrigin) {
  if (!raw?.trim()) return null;
  try {
    const target = new URL(raw.trim());
    const host = target.hostname.toLowerCase();
    if (target.protocol !== 'https:' || target.username || target.password ||
        target.search || target.hash || target.pathname !== '/' || target.origin === frontendOrigin ||
        host === 'localhost' || host.endsWith('.localhost') || host.includes(':') ||
        /^\d+\.\d+\.\d+\.\d+$/.test(host)) throw new Error();
    return target.origin;
  } catch {
    throw new Error('Invalid gateway configuration');
  }
}

function safeApiPath(path) {
  try {
    const decoded = decodeURIComponent(path);
    // Disallow ambiguous encoded separators/dot traversal and double-encoding.
    if (decoded.includes('\\') || decoded.includes('\0') || /%[0-9a-f]{2}/i.test(decoded) ||
        /%2f|%5c/i.test(path) || decoded.split('/').some(part=>part === '.' || part === '..')) return false;
    return decoded === '/api' || decoded.startsWith('/api/');
  } catch { return false; }
}

function cookies(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  // Cloudflare's older Headers implementation exposes getAll for Set-Cookie.
  if (typeof headers.getAll === 'function') return headers.getAll('Set-Cookie');
  const value = headers.get('set-cookie');
  // An Expires date contains commas; never split cookie headers on commas.
  return value ? [value] : [];
}

/**
 * @param {Request} request
 * @param {{ASSETS:{fetch:(request:Request)=>Promise<Response>},BACKEND_ORIGIN?:string}} env
 * @param {typeof fetch} [fetcher]
 */
export async function handleRequest(request, env, fetcher = fetch) {
  const incoming = new URL(request.url);
  if (incoming.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(incoming.hostname)) {
    incoming.protocol = 'https:';
    return Response.redirect(incoming.toString(),308);
  }
  const isApi = incoming.pathname === '/api' || incoming.pathname.startsWith('/api/');
  if (!isApi) {
    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body,asset);
    response.headers.set('X-Content-Type-Options','nosniff');
    response.headers.set('Referrer-Policy','no-referrer');
    response.headers.set('Content-Security-Policy',"frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
    if (response.headers.get('content-type')?.includes('text/html')) response.headers.set('Cache-Control','no-cache');
    return response;
  }
  if (!METHODS.has(request.method)) return problem(405,'METHOD_NOT_ALLOWED','Method not allowed.');
  if (!safeApiPath(incoming.pathname)) return problem(400,'INVALID_API_PATH','Invalid API path.');
  const decoded = decodeURIComponent(incoming.pathname);
  if (/^\/api\/(migration|docs|redoc|openapi\.json)(\/|$)/.test(decoded)) {
    return problem(404,'NOT_FOUND','Not found.');
  }
  const origin = request.headers.get('origin');
  // Google's browser redirect is an unauthenticated top-level GET. The backend
  // verifies its one-use state and HttpOnly browser binding before exchanging it.
  const googleCallback = request.method === 'GET' && incoming.pathname === '/api/auth/google/callback';
  if (!googleCallback && ((origin && origin !== incoming.origin) || request.headers.get('sec-fetch-site') === 'cross-site')) {
    return problem(403,'ORIGIN_NOT_ALLOWED','Use this application from its own domain.');
  }
  let base;
  try { base = backendOrigin(env.BACKEND_ORIGIN,incoming.origin); }
  catch { return problem(503,'BACKEND_CONFIGURATION_ERROR','The backend connection is not configured correctly.'); }
  if (!base) return problem(503,'BACKEND_NOT_CONFIGURED','The application is deployed. Its backend has not been connected yet.');
  const target = new URL(base);
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  const headers = new Headers();
  headers.set('Accept-Encoding','identity');
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name,value);
  }
  // Do not forward caller-controlled proxy identities or provider credentials.
  const options = {method:request.method,headers,redirect:/** @type {RequestRedirect} */('manual'),
    signal:AbortSignal.any([request.signal,AbortSignal.timeout(120000)])};
  if (!['GET','HEAD'].includes(request.method)) {
    // Stream multipart/binary bodies; never JSON-parse uploads or buffer ZIPs in the edge.
    options['body'] = request.body;
    options['duplex'] = 'half';
  }
  let upstream;
  try { upstream = await fetcher(target.toString(),options); }
  catch { return problem(502,'BACKEND_UNAVAILABLE','The backend is currently unavailable. Please retry shortly.'); }
  const outgoing = new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer'});
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) outgoing.set(name,value);
  }
  for (const cookie of cookies(upstream.headers)) {
    // The browser owns a cookie on Pages, not on Oracle's hostname. Preserve expiry/path/HttpOnly/SameSite.
    outgoing.append('Set-Cookie',cookie.replace(/;\s*Domain=[^;]*/ig,'').replace(/;\s*Secure(?=;|$)/ig,'')+'; Secure');
  }
  const location = upstream.headers.get('location');
  if (location) {
    let redirect;
    try { redirect = new URL(location,base); }
    catch {
      await upstream.body?.cancel();
      return problem(502,'INVALID_BACKEND_REDIRECT','The backend returned an unsupported redirect.');
    }
    const googleCompletion = googleCallback && (
      (redirect.pathname === '/auth/google/complete' && !redirect.search && !redirect.hash) ||
      (redirect.pathname === '/login' && redirect.search === '?google=unavailable' && !redirect.hash));
    if (redirect.origin !== base || (!safeApiPath(redirect.pathname) && !googleCompletion)) {
      await upstream.body?.cancel();
      return problem(502,'INVALID_BACKEND_REDIRECT','The backend returned an unsupported redirect.');
    }
    redirect.host = incoming.host;
    redirect.protocol = incoming.protocol;
    outgoing.set('Location',redirect.toString());
  }
  return new Response(request.method === 'HEAD' ? null : upstream.body,
    {status:upstream.status,statusText:upstream.statusText,headers:outgoing});
}

export default {fetch(request,env) { return handleRequest(request,env); }};
