// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {handleRequest} from './worker.js';

const base = 'https://elitehr.pages.dev';
function bindings(origin:string|undefined='https://oracle.example.com') {
  return {BACKEND_ORIGIN:origin,ASSETS:{fetch:vi.fn(async()=>new Response('<html>app</html>',{headers:{'Content-Type':'text/html'}}))}};
}

describe('Cloudflare frontend API gateway',()=>{
  it('serves SPA routes and assets without a backend',async()=>{
    const env=bindings(undefined);delete env.BACKEND_ORIGIN;
    const response=await handleRequest(new Request(base+'/accept-invite?token=synthetic'),env);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<html>app');
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
  });
  it('returns an explicit 503 without defaulting to V1',async()=>{
    const env=bindings('');const send=vi.fn();
    const response=await handleRequest(new Request(base+'/api/auth/refresh',{method:'POST'}),env,send);
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('BACKEND_NOT_CONFIGURED');
    expect(send).not.toHaveBeenCalled();expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });
  it.each(['http://oracle.example.com','https://user:pass@oracle.example.com',
    'https://oracle.example.com/api','https://oracle.example.com?target=x','https://localhost',
    'https://127.0.0.1','https://[::1]','https://elitehr.pages.dev','not-a-url'])('refuses unsafe target %s',async origin=>{
      const send=vi.fn();const response=await handleRequest(new Request(base+'/api/jobs'),bindings(origin),send);
      expect(response.status).toBe(503);expect(send).not.toHaveBeenCalled();
    });
  it('preserves API query, bearer token and idempotency while stripping injected provider/proxy headers',async()=>{
    const send=vi.fn(async()=>new Response('{"items":[]}',{headers:{'Content-Type':'application/json'}}));
    const response=await handleRequest(new Request(base+'/api/jobs?status=OPEN&limit=20',{
      headers:{Authorization:'Bearer synthetic',Cookie:'ph_refresh=synthetic',Origin:base,
        'Idempotency-Key':'synthetic-key','x-access-key':'forged','x-secret-key':'forged',
        'X-Forwarded-For':'forged','Host':'attacker.invalid'}}),bindings(),send);
    const [url,options]=send.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toBe('https://oracle.example.com/api/jobs?status=OPEN&limit=20');
    const headers=new Headers(options.headers);
    expect(headers.get('Authorization')).toBe('Bearer synthetic');
    expect(headers.get('Cookie')).toBe('ph_refresh=synthetic');
    expect(headers.get('Idempotency-Key')).toBe('synthetic-key');
    for(const key of ['x-access-key','x-secret-key','X-Forwarded-For','Host'])expect(headers.has(key)).toBe(false);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(options.redirect).toBe('manual');
  });
  it.each(['/api/auth/login','/api/auth/accept-invite','/api/resume-intake/batches',
    '/api/candidate-management/people','/api/assessment-management/assessments',
    '/api/recruitment/tracker','/api/users','/api/diagnostics'])('forwards API namespace %s',async path=>{
    const send=vi.fn(async(_url:string,_init?:RequestInit)=>new Response('{}',{status:401}));
    const response=await handleRequest(new Request(base+path),bindings(),send);
    expect(send.mock.calls[0][0]).toBe('https://oracle.example.com'+path);
    expect(response.status).toBe(401);
  });
  it('streams multipart without parsing or altering file bytes',async()=>{
    const multipart='--synthetic\r\nContent-Disposition: form-data; name="file"; filename="synthetic.pdf"\r\n\r\n%PDF-synthetic\r\n--synthetic--\r\n';
    const request=new Request(base+'/api/resume-intake/upload',{method:'POST',
      headers:{'Content-Type':'multipart/form-data; boundary=synthetic',Origin:base},body:multipart});
    const send=vi.fn(async(_url:string,init:RequestInit)=>{
      expect(await new Response(init.body).text()).toBe(multipart);
      expect(new Headers(init.headers).get('Content-Type')).toContain('boundary=synthetic');
      return new Response('{}',{status:202});
    });
    expect((await handleRequest(request,bindings(),send)).status).toBe(202);
  });
  it('keeps downloads and retry metadata intact',async()=>{
    const bytes=new Uint8Array([0,255,1,2]);
    const send=vi.fn(async()=>new Response(bytes,{status:206,headers:{
      'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="synthetic.pdf"',
      'Content-Range':'bytes 0-3/10','Retry-After':'5','X-Total-Count':'10'}}));
    const response=await handleRequest(new Request(base+'/api/resumes/files/synthetic/download'),bindings(),send);
    expect(response.status).toBe(206);expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get('Content-Disposition')).toContain('attachment');
    expect(response.headers.get('Retry-After')).toBe('5');expect(response.headers.get('Content-Range')).toBe('bytes 0-3/10');
  });
  it('preserves multiple independent cookies and Expires commas on the Pages hostname',async()=>{
    const headers=new Headers();
    headers.append('Set-Cookie','refresh=synthetic; Path=/api/auth; HttpOnly; SameSite=Lax; Domain=oracle.example.com; Expires=Wed, 21 Oct 2026 07:28:00 GMT');
    headers.append('Set-Cookie','second=synthetic; Path=/; HttpOnly; Secure');
    const response=await handleRequest(new Request(base+'/api/auth/login',{method:'POST'}),bindings(),vi.fn(async()=>new Response('{}',{headers})));
    const result=response.headers.getSetCookie();
    expect(result).toHaveLength(2);expect(result[0]).toContain('Expires=Wed, 21 Oct');
    expect(result[0]).toContain('HttpOnly');expect(result[0]).toContain('SameSite=Lax');
    for(const cookie of result){expect(cookie).not.toMatch(/Domain=/i);expect(cookie).toContain('; Secure');}
  });
  it.each(['/api/migration/import','/api/docs','/api/%6digration/import'])('blocks internal route %s',async path=>{
    const send=vi.fn();expect((await handleRequest(new Request(base+path),bindings(),send)).status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });
  it.each(['/api/%2fprivate','/api/%255cprivate','/api/%zz'])('blocks ambiguous path %s',async path=>{
    expect((await handleRequest(new Request(base+path),bindings(),vi.fn())).status).toBe(400);
  });
  it('rejects cross-origin cookie requests before contacting Oracle',async()=>{
    const send=vi.fn();const response=await handleRequest(new Request(base+'/api/auth/logout',{
      method:'POST',headers:{Origin:'https://attacker.invalid',Cookie:'refresh=synthetic'}}),bindings(),send);
    expect(response.status).toBe(403);expect(send).not.toHaveBeenCalled();
  });
  it('allows the browser Google callback and relays its safe completion redirect and cookie',async()=>{
    const response=await handleRequest(new Request(base+'/api/auth/google/callback?state=synthetic&code=synthetic',{
      headers:{'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate'}}),bindings(),vi.fn(async()=>new Response(null,{status:303,
      headers:{Location:'/auth/google/complete','Set-Cookie':'elite_google_complete=synthetic; Path=/api/auth/google; HttpOnly; SameSite=Lax'}})));
    expect(response.status).toBe(303);expect(response.headers.get('Location')).toBe(base+'/auth/google/complete');
    expect(response.headers.get('Set-Cookie')).toContain('HttpOnly');
  });
  it('rewrites only same-backend API redirects and never follows external redirects',async()=>{
    const response=await handleRequest(new Request(base+'/api/jobs'),bindings(),vi.fn(async()=>new Response(null,
      {status:307,headers:{Location:'https://oracle.example.com/api/jobs/'}})));
    expect(response.headers.get('Location')).toBe(base+'/api/jobs/');
    const blocked=await handleRequest(new Request(base+'/api/jobs'),bindings(),vi.fn(async()=>new Response(null,
      {status:307,headers:{Location:'https://attacker.invalid/capture'}})));
    expect(blocked.status).toBe(502);
  });
  it('sanitizes upstream connection errors without logging credentials or URLs',async()=>{
    const response=await handleRequest(new Request(base+'/api/jobs'),bindings(),vi.fn(async()=>{throw new Error('sensitive-provider-value');}));
    expect(response.status).toBe(502);expect(await response.text()).not.toContain('sensitive-provider-value');
  });
  it('handles malformed redirects without an uncaught worker error',async()=>{
    const response=await handleRequest(new Request(base+'/api/jobs'),bindings(),vi.fn(async()=>new Response(null,
      {status:307,headers:{Location:'http://['}})));
    expect(response.status).toBe(502);
  });
});
