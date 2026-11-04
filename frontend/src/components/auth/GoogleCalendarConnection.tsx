import {useEffect,useState} from 'react';
import {CalendarDays,Loader2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Modal} from '../ui/Modal';
import {useAuth} from '../../lib/authContext';
import {GoogleConnection,googleRequest} from '../../lib/googleApi';
import {useGoogleRedirect} from './useGoogleRedirect';
import {GoogleMfaSetup} from './GoogleMfaSetup';

export function GoogleCalendarConnection(){
  const {impersonatingUser}=useAuth();
  const [open,setOpen]=useState(false),[connection,setConnection]=useState<GoogleConnection|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [retry,setRetry]=useState(0);
  const redirect=useGoogleRedirect(setError);
  useEffect(()=>{if(!open)return;const controller=new AbortController();setError('');setConnection(null);
    void googleRequest<GoogleConnection>('',undefined,'GET',controller.signal).then(setConnection).catch(cause=>{if(!controller.signal.aborted)setError(cause.message);});
    return()=>controller.abort();
  },[open,retry]);
  async function connect(){setError('');setNotice('');await redirect.start(async signal=>{
    const result=await googleRequest<{authorizationUrl:string}>('/connect',{returnTo:window.location.pathname+window.location.search},'POST',signal);
    return result.authorizationUrl;
  });}
  async function disconnect(){setBusy(true);setError('');try{
    const result=await googleRequest<{message:string}>('',undefined,'DELETE');
    setNotice(result.message);setConnection(previous=>previous?{...previous,connected:false,status:'not_connected'}:previous);
  }catch(cause){setError(cause instanceof Error?cause.message:'Disconnect failed');}finally{setBusy(false);}}
  return <>
    <Button aria-label="Google Calendar" variant="outline" size="sm" onClick={()=>setOpen(true)}><CalendarDays className="size-4"/><span className="hidden sm:inline">Google Calendar</span></Button>
    {open&&<Modal label="Google Calendar connection" onClose={()=>setOpen(false)} dismissible={!busy&&!redirect.busy} className="max-w-lg p-6">
      <h2 className="text-xl font-semibold">Google Calendar</h2>
      <p className="mt-3 text-sm text-muted-foreground">Connect the Google account you use for Elite HR. When you are the assigned interviewer, we check for overlapping meetings on your primary calendar and add the interview with a reminder.</p>
      <p className="mt-3 text-xs text-muted-foreground">Calendar access requires your consent. Your team sees availability, without the titles or details of your other meetings.</p>
      {!connection&&!error&&<p role="status" className="mt-5 text-sm">Loading connection…</p>}
      {error&&<p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
      {!connection&&error&&<Button variant="outline" className="mt-3" onClick={()=>setRetry(value=>value+1)}>Retry connection</Button>}
      {notice&&<p role="status" className="mt-4 text-sm">{notice}</p>}
      {connection&&<div className="mt-5 space-y-4">
        <p className="rounded-lg bg-muted p-3 text-sm">{!connection.enabled?'Google OAuth needs administrator setup.':connection.connected?`Connected: ${connection.email}`:connection.status==='reconnect_required'?'Access expired. Reconnect your Google account.':'No Google Calendar connected.'}</p>
        {connection.connected&&<p className="text-xs text-muted-foreground">Disconnecting leaves existing Google events in place. Reconnect to update or remove them from Elite HR.</p>}
        <div className="flex flex-wrap gap-2"><Button disabled={busy||redirect.busy||!connection.enabled||!!impersonatingUser} onClick={()=>void connect()}>{(busy||redirect.busy)&&<Loader2 className="size-4 animate-spin"/>}{redirect.busy?'Connecting…':connection.connected?'Reconnect':'Connect Google Calendar'}</Button>
          {connection.connected&&<Button variant="outline" disabled={busy||redirect.busy||!!impersonatingUser} onClick={()=>void disconnect()}>Disconnect</Button>}
        </div>
      </div>}
      <GoogleMfaSetup/>
    </Modal>}
  </>;
}
