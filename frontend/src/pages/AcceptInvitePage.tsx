import {Input} from '@/components/ui/input';
import React, {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import {PAButton} from '../components/ui/primitives';

export function AcceptInvitePage() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') || new URLSearchParams(window.location.search).get('token') || '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => { window.history.replaceState(null,'','/accept-invite'); }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const response = await fetch('/api/auth/accept-invite', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({token,newPassword:password}),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Use at least 12 characters and avoid common passwords.');
      setPassword(''); setConfirm(''); setDone(true);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create your password.'); }
    finally { setBusy(false); }
  }
  return <main className="min-h-screen flex items-center justify-center bg-background p-6">
    <section className="w-full max-w-md rounded-2xl border border-border bg-card p-6 space-y-4">
      <h1 className="text-2xl font-bold">{done ? 'Your account is ready' : 'Create your password'}</h1>
      {done ? <><p>Your password has been created. Sign in with your invited email address.</p><Link to="/login">Go to sign in</Link></> : !token ? <><p>This invitation is missing. Ask your administrator for a new invitation link.</p><Link to="/login">Go to sign in</Link></> : <form onSubmit={submit} className="space-y-4">
        <p>Your invitation identifies your account. Choose your own password to activate it.</p>
        <label className="block">New password<Input aria-label="New password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} className="ehr-input w-full p-3" /></label>
        <label className="block">Confirm password<Input aria-label="Confirm password" type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} className="ehr-input w-full p-3" /></label>
        <p className="text-sm text-muted-foreground">At least 12 characters. Avoid common passwords; a unique passphrase works well.</p>
        {error && <p role="alert">{error}</p>}
        <PAButton type="submit" disabled={busy}>{busy ? 'Creating password…' : 'Create password'}</PAButton>
        <p><Link to="/login">Already set your password? Sign in</Link></p>
      </form>}
    </section>
  </main>;
}
