import React from 'react';
import {render, screen, fireEvent, cleanup} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {AcceptInvitePage} from './AcceptInvitePage';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });
function show(token = 'fictional-invite-token-for-test') {
  window.history.replaceState(null, '', `/accept-invite#token=${token}`);
  render(<MemoryRouter><AcceptInvitePage /></MemoryRouter>);
}
function passwords(confirm = 'Fictional-Password-2026!') {
  fireEvent.change(screen.getByLabelText('New password'), {target:{value:'Fictional-Password-2026!'}});
  fireEvent.change(screen.getByLabelText('Confirm password'), {target:{value:confirm}});
}
describe('invitation setup', () => {
  it('removes the token from the address and sends it only to password setup', async () => {
    const request = vi.fn().mockResolvedValue(new Response('{"ok":true}', {status:200}));
    vi.stubGlobal('fetch', request);
    show();
    expect(window.location.hash).toBe('');
    passwords();
    fireEvent.click(screen.getByRole('button', {name:'Create password'}));
    await screen.findByText('Your account is ready');
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({token:'fictional-invite-token-for-test',newPassword:'Fictional-Password-2026!'});
    expect(request.mock.calls[0][0]).toBe('/api/auth/accept-invite');
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });
  it('prevents mismatched passwords without making a request', async () => {
    const request = vi.fn(); vi.stubGlobal('fetch', request); show(); passwords('Different-Password-2026!');
    fireEvent.click(screen.getByRole('button', {name:'Create password'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match');
    expect(request).not.toHaveBeenCalled();
  });
  it('shows expiration errors and a missing-token recovery message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"detail":"Invalid or expired invitation"}', {status:400})));
    show(); passwords(); fireEvent.click(screen.getByRole('button', {name:'Create password'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid or expired invitation');
    cleanup(); show('');
    expect(screen.getByText(/Ask your administrator/)).toBeInTheDocument();
    expect(screen.queryByRole('button', {name:'Create password'})).not.toBeInTheDocument();
  });
});
