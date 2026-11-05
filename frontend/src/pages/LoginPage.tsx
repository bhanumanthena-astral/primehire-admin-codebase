import React, {useState} from 'react';
import {useNavigate, useLocation} from 'react-router-dom';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {useAuth} from '../lib/authContext';
import {Briefcase, KeyRound, Loader2, ArrowRight, Eye, EyeOff, ShieldCheck} from 'lucide-react';
import './EliteHrLogin.css';
import {rememberSignInMethod} from '../lib/googleConnection';

function validateIdentity(value: string): string | null {
  const v = value.trim();
  if (!v) return 'Please enter your email or phone number.';
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const digits = v.replace(/\D/g, '');
  const isPhone = digits.length >= 7 && digits.length <= 15;
  if (!isEmail && !isPhone) return 'Enter a valid email address or phone number.';
  return null;
}

export const LoginPage: React.FC = () => {
  const { login, verifyMfa } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } })?.from?.pathname || '/';

  const [identity, setIdentity] = useState('');
  const [passcode, setPasscode] = useState('');
  const [showPasscode, setShowPasscode] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [passcodeError, setPasscodeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [mfaToken, setMfaToken] = useState<string | null>((location.state as {googleMfaToken?:string}|null)?.googleMfaToken||null);
  const [mfaMethod,setMfaMethod]=useState<'google'|'password'>((location.state as {googleMfaToken?:string}|null)?.googleMfaToken?'google':'password');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const idErr = validateIdentity(identity);
    const pcErr = passcode ? null : 'Please enter your passcode.';
    setIdentityError(idErr);
    setPasscodeError(pcErr);
    setFormError(null);
    if (idErr || pcErr) return;

    setLoading(true);
    try {
      const result = await login(identity.trim(), passcode);
      if (result.mfaRequired && result.mfaToken) {
        setMfaMethod('password');
        setMfaToken(result.mfaToken);
      } else {
        navigate(from, { replace: true });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login failed. Please check your credentials.';
      setFormError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaToken) return;
    if (!mfaCode.trim()) {
      setMfaError('Please enter your verification code.');
      return;
    }
    setMfaError(null);
    setFormError(null);
    setLoading(true);
    try {
      await verifyMfa(mfaToken, mfaCode.trim());
      rememberSignInMethod(mfaMethod);
      navigate(from, { replace: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid verification code. Please try again.';
      setMfaError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="elite-page flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-5 sm:px-8">
        <a href="/login" className="flex items-center gap-2.5 font-semibold tracking-tight text-foreground" aria-label="Elite HR home">
          <span className="flex size-9 items-center justify-center rounded-[.625rem] bg-primary text-primary-foreground"><Briefcase className="size-5" aria-hidden="true"/></span>
          <span className="text-lg">Elite HR</span>
        </a>
        <span className="login-header-note"><ShieldCheck size={15}/> Your secure hiring workspace</span>
      </header>
      <main className="login-stage">
        <aside className="login-editorial" aria-hidden="true"><div className="editorial-squiggle"/><div className="editorial-message"><i/><i/></div><div className="editorial-dot"/><div className="editorial-pillar"/><div className="editorial-outline">&#8599;</div></aside>
        <section aria-labelledby="elite-login-heading" className="elite-card w-full max-w-[420px] p-7 sm:p-10">
          <div className="mb-7">
            <div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              {mfaToken?<KeyRound className="size-6" aria-hidden="true"/>:<Briefcase className="size-6" aria-hidden="true"/>}
            </div>
            <h1 id="elite-login-heading" className="text-[1.75rem] font-semibold leading-tight tracking-tight">{mfaToken?'Two-Factor Authentication':'Welcome back.'}</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{mfaToken?'Enter the code from your authenticator app or use a recovery code.':'Enter your details to sign in to your workspace.'}</p>
          </div>
          {formError&&<p role="alert" className="mb-5 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{formError}</p>}
          {!mfaToken?<form onSubmit={handleCredentialsSubmit} noValidate className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="elite-identity" className="block text-sm font-medium">Email or phone number</label>
              <Input id="elite-identity" name="identity" type="text" autoComplete="username" placeholder="Enter Email / Phone No" value={identity}
                onChange={event=>{setIdentity(event.target.value);setIdentityError(null);}} aria-invalid={!!identityError} aria-describedby={identityError?'elite-identity-error':undefined} className="h-11"/>
              {identityError&&<p id="elite-identity-error" role="alert" className="text-xs text-destructive">{identityError}</p>}
            </div>
            <div className="space-y-2">
              <label htmlFor="elite-passcode" className="block text-sm font-medium">Passcode</label>
              <div className="relative">
                <Input id="elite-passcode" name="password" type={showPasscode?'text':'password'} autoComplete="current-password" placeholder="Passcode" value={passcode}
                  onChange={event=>{setPasscode(event.target.value);setPasscodeError(null);}} aria-invalid={!!passcodeError} aria-describedby={passcodeError?'elite-passcode-error':undefined} className="h-11 pr-12"/>
                <Button type="button" variant="ghost" size="icon" aria-label={showPasscode?'Hide passcode':'Show passcode'} aria-pressed={showPasscode} onClick={()=>setShowPasscode(value=>!value)} className="absolute right-1 top-1/2 -translate-y-1/2">
                  {showPasscode?<EyeOff className="size-4"/>:<Eye className="size-4"/>}
                </Button>
              </div>
              {passcodeError&&<p id="elite-passcode-error" role="alert" className="text-xs text-destructive">{passcodeError}</p>}
            </div>
            <Button type="submit" disabled={loading} className="h-11 w-full">{loading?<><Loader2 className="size-4 animate-spin" aria-hidden="true"/>Signing in…</>:<>Sign in<ArrowRight className="size-4" aria-hidden="true"/></>}</Button>
            <p className="border-t border-border pt-5 text-center text-xs leading-relaxed text-muted-foreground">New to this workspace? Ask your administrator for an invitation.</p>
          </form>:<form onSubmit={handleMfaSubmit} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="elite-mfa" className="block text-sm font-medium">Verification code</label>
              <Input id="elite-mfa" autoFocus autoComplete="one-time-code" value={mfaCode} onChange={event=>setMfaCode(event.target.value)} placeholder="123456 or XXXX-XXXX" aria-invalid={!!mfaError} aria-describedby={mfaError?'elite-mfa-error':undefined} className="h-11 text-center font-mono tracking-widest"/>
              {mfaError&&<p id="elite-mfa-error" role="alert" className="text-xs text-destructive">{mfaError}</p>}
            </div>
            <Button type="submit" disabled={loading} className="h-11 w-full">{loading?<><Loader2 className="size-4 animate-spin"/>Verifying…</>:'Confirm & Sign In'}</Button>
            <Button type="button" variant="ghost" disabled={loading} className="w-full" onClick={()=>{setMfaToken(null);setMfaCode('');setMfaError(null);}}>Back to login</Button>
          </form>}
        </section>
        <aside className="login-character" aria-label="Hiring professional illustration"><img className="login-hero-image" src="/images/team/hero-static.png" alt="HR professional seated with a blue laptop" decoding="async"/><div className="editorial-pillar editorial-pillar-right" aria-hidden="true"/></aside>
      </main>
      <footer className="flex items-center justify-center gap-2 px-5 pb-7 text-xs text-muted-foreground"><ShieldCheck className="size-3.5" aria-hidden="true"/>Elite HR · Secure team workspace</footer>
    </div>
  );
};
