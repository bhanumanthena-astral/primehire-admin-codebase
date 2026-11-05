import {describe, expect, it} from 'vitest';
import {teamInvitationUrl} from './teamInvitation';

describe('public team invitation links', () => {
  it.each([
    '/accept-invite#token=synthetic-token',
    'http://localhost:3000/accept-invite#token=synthetic-token',
    'http://127.0.0.1:5173/accept-invite#token=synthetic-token',
    'https://elite-hr-v2.pages.dev/accept-invite#token=synthetic-token',
    'https://elitehr.vils.ai/accept-invite#token=synthetic-token',
  ])('uses the canonical HTTPS domain for %s', value => {
    expect(teamInvitationUrl(value)).toBe('https://elitehr.vils.ai/accept-invite#token=synthetic-token');
  });

  it('preserves encoded token data without moving a fragment token into the query', () => {
    const url = new URL(teamInvitationUrl('/accept-invite#token=synthetic%2Btoken%2Fvalue%3D'));
    expect(url.search).toBe('');
    expect(url.hash).toBe('#token=synthetic%2Btoken%2Fvalue%3D');
  });

  it('preserves legacy query-token links on the public domain', () => {
    expect(teamInvitationUrl('http://localhost:3000/accept-invite?token=synthetic-token')).toBe('https://elitehr.vils.ai/accept-invite?token=synthetic-token');
  });

  it('rejects unrelated paths rather than sharing a broken invitation', () => {
    expect(() => teamInvitationUrl('/login#token=synthetic-token')).toThrow('Invalid invitation link');
  });
});
