import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {useAuth} from '../../lib/authContext';
import {authFetch} from '../../lib/authFetch';

/** Uses the existing self-service MFA endpoints; secrets remain in component memory. */
export function GoogleMfaSetup(){
  const {user,refreshUser,impersonatingUser}=useAuth();
  const [secret,setSecret]=useState(''),[code,setCode]=useState(''),[recovery,setRecovery]=useState<string[]>([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [enabledHere,setEnabledHere]=useState(false);
  if(!user||!['super_admin','admin'].includes(user.role))return null;
  async function request(path:string,body?:unknown){
    const response=await authFetch(`/api/auth/mfa/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const result=await response.json();if(!response.ok)throw new Error(result.detail||'Two-factor setup failed');return result;
  }
  async function begin(){setBusy(true);setError('');try{setSecret((await request('enroll')).secret);}catch(cause){setError(cause instanceof Error?cause.message:'Setup failed');}finally{setBusy(false);}}
  async function confirm(){setBusy(true);setError('');try{
    const result=await request('confirm',{secret,code});setRecovery(result.recoveryCodes);setEnabledHere(true);setSecret('');setCode('');
  }catch(cause){setError(cause instanceof Error?cause.message:'Verification failed');}finally{setBusy(false);}}
  return <section className="mt-5 space-y-3 border-t border-border pt-4 text-sm">
    <h3 className="font-medium">Two-factor authentication</h3>
    {recovery.length?<>
      <p>Two-factor authentication enabled. Save these recovery codes privately before closing. Each code works once.</p>
      <div aria-label="Recovery codes" className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-3 font-mono text-xs">{recovery.map(value=><code key={value}>{value}</code>)}</div>
      <Button variant="outline" disabled={busy} onClick={()=>{setBusy(true);void refreshUser().finally(()=>{setRecovery([]);setBusy(false);});}}>I saved my recovery codes</Button>
    </>:user.mfaEnabled||enabledHere?<p className="text-muted-foreground">Enabled. Google sign-in will also ask for your verification code.</p>:<>
      <p className="text-xs text-muted-foreground">Administrator Google sign-in requires two-factor authentication. Set it up here while signed in with your existing account.</p>
      {!secret?<Button variant="outline" disabled={busy||!!impersonatingUser} onClick={()=>void begin()}>{busy?'Preparing…':'Set up two-factor authentication'}</Button>:<>
        <p className="text-xs">In your authenticator app, add a time-based account using this setup key. Keep it private.</p>
        <Input aria-label="Authenticator setup key" readOnly value={secret} className="font-mono"/>
        <Input aria-label="Authenticator verification code" value={code} onChange={event=>setCode(event.target.value)} autoComplete="one-time-code" inputMode="numeric" placeholder="6-digit code" maxLength={6}/>
        <Button disabled={busy||code.length!==6} onClick={()=>void confirm()}>{busy?'Verifying…':'Verify and enable'}</Button>
      </>}
    </>}
    {error&&<p role="alert" className="text-destructive">{error}</p>}
  </section>;
}
