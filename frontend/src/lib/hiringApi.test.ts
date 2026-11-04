import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./authFetch', () => ({
  authFetch: vi.fn(),
}));

import { authFetch } from './authFetch';
import { fetchJobs, fetchJobDetail, createJob, parseJd, JdParseError } from './hiringApi';

const mockAuthFetch = authFetch as unknown as ReturnType<typeof vi.fn>;

describe('hiringApi network failure classification', () => {
  it('maps a fetch TypeError to a clear network message', async () => {
    mockAuthFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchJobs()).rejects.toThrow(
      'Network unavailable. Check your connection and try again.',
    );
  });

  it('does not misclassify HTTP error statuses as network failures', async () => {
    mockAuthFetch.mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Job not found' }), { status: 404 }),
    );
    await expect(fetchJobDetail('nope')).rejects.toThrow('Job not found');
  });

  it.each([
    [401, 'Authentication required'],
    [403, 'Forbidden'],
    [422, 'Validation failed'],
    [500, 'Internal server error'],
  ])('surfaces server detail for HTTP %i', async (status, detail) => {
    mockAuthFetch.mockResolvedValue(
      new Response(JSON.stringify({ detail }), { status }),
    );
    await expect(fetchJobs()).rejects.toThrow(detail);
  });

  it('rethrows non-TypeError auth errors unchanged', async () => {
    const err = new Error('Session expired');
    mockAuthFetch.mockRejectedValue(err);
    await expect(createJob({} as never)).rejects.toBe(err);
  });
});

describe('parseJd single-read body handling', () => {
  const pdf = new File(['%PDF-fake'], 'jd.pdf', { type: 'application/pdf' });

  it('preserves structured fieldErrors from a dict detail (regression: double-res.json dropped them)', async () => {
    mockAuthFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: {
            message: 'Please complete all mandatory fields before uploading the JD.',
            errors: [{ field: 'closesAt', message: 'field required' }],
          },
        }),
        { status: 422 },
      ),
    );
    let err!: JdParseError;
    try {
      await parseJd(pdf);
      expect.unreachable('parseJd should throw');
    } catch (e) {
      err = e as JdParseError;
    }
    expect(err).toBeInstanceOf(JdParseError);
    expect(err.message).toContain('Please complete all mandatory fields');
    expect(err.fieldErrors).toEqual([{ field: 'closesAt', message: 'field required' }]);
  });

  it('maps FastAPI array details (loc/msg) to fieldErrors', async () => {
    mockAuthFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ detail: [{ loc: ['body', 'file'], msg: 'Field required' }] }),
        { status: 422 },
      ),
    );
    let err!: JdParseError;
    try {
      await parseJd(pdf);
      expect.unreachable('parseJd should throw');
    } catch (e) {
      err = e as JdParseError;
    }
    expect(err.fieldErrors).toEqual([{ field: 'file', message: 'Field required' }]);
    expect(err.message).toContain('file');
  });

  it('surfaces plain-string details without fieldErrors', async () => {
    mockAuthFetch.mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Empty file.' }), { status: 400 }),
    );
    let err!: JdParseError;
    try {
      await parseJd(pdf);
      expect.unreachable('parseJd should throw');
    } catch (e) {
      err = e as JdParseError;
    }
    expect(err.message).toBe('Empty file.');
    expect(err.fieldErrors).toEqual([]);
  });

  it('returns the payload on success', async () => {
    const payload = {
      filename: 'jd.pdf',
      kind: 'pdf',
      templateVersion: 'doc-v1',
      text: 'Product Manager',
      mapped: {},
      warnings: [],
    };
    mockAuthFetch.mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    await expect(parseJd(pdf)).resolves.toEqual(payload);
  });
});
