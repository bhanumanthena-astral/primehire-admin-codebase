import {authFetch} from './authFetch';
import {withGoogleTimeout} from './googleConnection';

export type GoogleConnection = {enabled:boolean; connected:boolean; status:string; email?:string; calendar:'primary'};
export type CalendarAvailability = {status:string; available:boolean|null; message:string};

export async function googleRequest<T>(path:string, body?:unknown, method=body===undefined?'GET':'POST', signal?:AbortSignal):Promise<T> {
  return withGoogleTimeout(async requestSignal=>{
  const response=await authFetch(`/api/google/calendar${path}`, {
    method, signal:requestSignal, credentials:'include', headers:{'Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  });
  const data=await response.json().catch(()=>({detail:'Google Calendar request failed'}));
  if(!response.ok) throw new Error(typeof data.detail==='string'?data.detail:'Google Calendar request failed');
  return data;
  },signal);
}

export function followGoogle(url:string) {
  const target=new URL(url);
  if(target.origin!=='https://accounts.google.com'||target.pathname!=='/o/oauth2/v2/auth') throw new Error('Invalid Google authorization address');
  window.location.assign(target.href);
}
