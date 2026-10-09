import { afterEach, describe, expect, test, vi } from 'vitest';
import type { MailTemplate } from '../types';
import { createMailTemplateStore } from '../lib/mailTemplateStore';

afterEach(() => vi.unstubAllGlobals());
const template = (id: string): MailTemplate => ({ id, name: id, type: 'CUSTOM', subject: 'Subject', body: 'Body' });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

function browser(initial: MailTemplate[]) {
  let cached = JSON.stringify(initial);
  const changed = vi.fn((items: MailTemplate[]) => { cached = JSON.stringify(items); });
  return { store: createMailTemplateStore(initial, changed), changed, cache: () => JSON.parse(cached) as MailTemplate[] };
}

describe('mail templates remain deleted across browsers (bug 55)', () => {
  test('a stale Edge cache cannot re-upload the template deleted in Chrome', async () => {
    const deleted = template('tpl-deleted');
    const retained = template('tpl-retained');
    let server = [deleted, retained];
    const fetchMock = vi.fn(async (url: string, options: RequestInit) => {
      if (options.method === 'DELETE') {
        server = server.filter(t => !url.endsWith(t.id));
        return json({ deleted: deleted.id });
      }
      return json({ items: server });
    });
    vi.stubGlobal('fetch', fetchMock);
    const chrome = browser(server);
    const edge = browser(server);
    await chrome.store.remove(deleted.id);
    await edge.store.load();
    await chrome.store.load();
    expect(chrome.cache()).toEqual([retained]);
    expect(edge.cache()).toEqual([retained]);
    expect(fetchMock.mock.calls.filter(([, opts]) => opts.method === 'POST')).toHaveLength(0);
    expect(fetchMock.mock.calls[1][1].cache).toBe('no-store');
  });

  test('deleting the last template clears stale caches on reload', async () => {
    const stale = template('tpl-last');
    const fetchMock = vi.fn().mockResolvedValue(json({ items: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const reloaded = browser([stale]);
    await reloaded.store.load();
    expect(reloaded.cache()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined();
  });

  test('a list response captured before deletion cannot put the template back', async () => {
    const stale = template('tpl-delayed');
    let resolveRead!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn((_: string, options: RequestInit) => options.method === 'DELETE'
      ? Promise.resolve(json({ deleted: stale.id }))
      : new Promise<Response>(resolve => { resolveRead = resolve; })));
    const chrome = browser([stale]);
    const loading = chrome.store.load();
    await chrome.store.remove(stale.id);
    resolveRead(json({ items: [stale] }));
    await loading;
    expect(chrome.cache()).toEqual([]);
  });

  test('older cross-browser refresh responses cannot overwrite a newer list', async () => {
    const responses: Array<(response: Response) => void> = [];
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => responses.push(resolve))));
    const chrome = browser([template('tpl-old')]);
    const old = chrome.store.load();
    const current = chrome.store.load();
    responses[1](json({ items: [] }));
    await current;
    responses[0](json({ items: [template('tpl-old')] }));
    await old;
    expect(chrome.cache()).toEqual([]);
  });

  test('editing a template deleted by another user never falls back to POST', async () => {
    const stale = template('tpl-edit');
    const fetchMock = vi.fn().mockImplementation(async () => json({ detail: 'Template not found' }, 404));
    vi.stubGlobal('fetch', fetchMock);
    const chrome = browser([stale]);
    await expect(chrome.store.save({ ...stale, subject: 'Edited' }, false)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].method).toBe('PUT');
    expect(chrome.changed).not.toHaveBeenCalled();
  });

  test('failed deletes keep the template and failed saves never create local-only records', async () => {
    const original = template('tpl-server');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => json({ detail: 'Unavailable' }, 503)));
    const chrome = browser([original]);
    await expect(chrome.store.remove(original.id)).rejects.toThrow();
    await expect(chrome.store.save(template('tpl-new'), true)).rejects.toThrow();
    expect(chrome.cache()).toEqual([original]);
    expect(chrome.changed).not.toHaveBeenCalled();
  });

  test('a template already deleted by another browser is removed from this cache', async () => {
    const stale = template('tpl-missing');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ detail: 'Not found' }, 404)));
    const chrome = browser([stale]);
    await chrome.store.remove(stale.id);
    expect(chrome.cache()).toEqual([]);
  });

  test('only an explicit new-template save issues POST, and successful edits issue PUT', async () => {
    const fresh = template('tpl-new');
    const fetchMock = vi.fn(async (_: string, options: RequestInit) => json({ ...fresh, ...JSON.parse(options.body as string) }));
    vi.stubGlobal('fetch', fetchMock);
    const chrome = browser([]);
    await chrome.store.save(fresh, true);
    await chrome.store.save({ ...fresh, subject: 'Updated' }, false);
    expect(fetchMock.mock.calls.map(([, opts]) => opts.method)).toEqual(['POST', 'PUT']);
    expect(chrome.cache()).toEqual([{ ...fresh, subject: 'Updated' }]);
  });
});
