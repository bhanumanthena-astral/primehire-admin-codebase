import { afterEach, describe, expect, test, vi } from 'vitest';
import { onRequest } from '../../functions/api/backend/[[path]]';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function context(method: string, path: string) {
  return {
    request: new Request(`https://admin.example/api/backend/${path}`, { method }),
    params: { path: path.split('/') },
    env: {
      BACKEND_URL: 'https://provider.example/primehire/api/v1',
      PRIMEHIRE_ACCESS_KEY: 'test-access',
      PRIMEHIRE_SECRET_KEY: 'test-secret',
    },
  };
}

describe('report proxy access', () => {
  test.each(['response/response-real/generate-report', 'response/response-real/generate-report/'])(
    'blocks removed report mutation route %s without contacting the provider', async path => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const result = await onRequest(context('POST', path));
      expect(result.status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  test('continues to retrieve existing reports', async () => {
    const report = { status: 'SUCCESS', data: { report: { overall_score: 82 } } };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(report), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await onRequest(context('GET', 'interview/interview-real/report'));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(report);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('https://provider.example/primehire/api/v1/interview/interview-real/report');
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
  });
});
