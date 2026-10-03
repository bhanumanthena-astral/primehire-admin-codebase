/**
 * Authenticated Fetch wrapper.
 * Injects memory-held Bearer access token and automatically handles 401 token rotation.
 */

let _accessToken: string | null = null;
let _refreshPromise: Promise<string | null> | null = null;
let _onAuthFailure: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  _accessToken = token;
}

export function getAccessToken(): string | null {
  return _accessToken;
}

export function setAuthFailureHandler(handler: () => void) {
  _onAuthFailure = handler;
}

async function refreshAccessToken(): Promise<string | null> {
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        setAccessToken(null);
        if (_onAuthFailure) _onAuthFailure();
        return null;
      }
      const data = await res.json();
      setAccessToken(data.accessToken);
      return data.accessToken as string;
    } catch {
      setAccessToken(null);
      if (_onAuthFailure) _onAuthFailure();
      return null;
    } finally {
      _refreshPromise = null;
    }
  })();

  return _refreshPromise;
}

export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers || {});
  
  if (_accessToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${_accessToken}`);
  }

  // Ensure cookies are included for refresh / auth endpoints
  const opts: RequestInit = {
    ...init,
    headers,
    credentials: init.credentials || 'include',
  };

  let response = await fetch(input, opts);

  // If 401 and we had a token, attempt auto-refresh and retry once
  if (response.status === 401 && _accessToken) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      const retryHeaders = new Headers(init.headers || {});
      retryHeaders.set('Authorization', `Bearer ${newToken}`);
      response = await fetch(input, {
        ...init,
        headers: retryHeaders,
        credentials: init.credentials || 'include',
      });
    }
  }

  return response;
}
