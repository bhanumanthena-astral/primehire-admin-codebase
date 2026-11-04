export const GOOGLE_CONNECTION_TIMEOUT_MS=30_000;
export const GOOGLE_CONNECTION_TIMEOUT_MESSAGE='Google connection failed or was cancelled. Please try connecting again.';
const METHOD_KEY='elitehr.lastSignInMethod';
export const SIGN_IN_METHOD_EVENT='elitehr:signin-method';

/** The preference contains only a provider name, never an account or token. */
export function recentSignInMethod(){
  try{return window.localStorage.getItem(METHOD_KEY);}catch{return null;}
}
export function rememberSignInMethod(method:'google'|'password'){
  try{window.localStorage.setItem(METHOD_KEY,method);}catch{/* Storage may be disabled. */}
  window.dispatchEvent(new Event(SIGN_IN_METHOD_EVENT));
}

/** Race the whole operation (including body decoding), even if fetch ignores abort. */
export async function withGoogleTimeout<T>(operation:(signal:AbortSignal)=>Promise<T>,external?:AbortSignal):Promise<T>{
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  let cancel=()=>{};
  const failure=new Promise<never>((_,reject)=>{
    cancel=()=>{controller.abort();reject(new DOMException('Google request cancelled','AbortError'));};
    if(external?.aborted){cancel();return;}
    external?.addEventListener('abort',cancel,{once:true});
    timer=setTimeout(()=>{controller.abort();reject(new Error(GOOGLE_CONNECTION_TIMEOUT_MESSAGE));},GOOGLE_CONNECTION_TIMEOUT_MS);
  });
  try{
    if(external?.aborted)return await failure;
    return await Promise.race([operation(controller.signal),failure]);
  }finally{
    clearTimeout(timer);external?.removeEventListener('abort',cancel);
  }
}
