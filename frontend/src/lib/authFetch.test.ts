import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {authFetch,getAccessToken,setAccessToken,setAuthFailureHandler} from './authFetch';
const failed=vi.fn();
beforeEach(()=>{setAccessToken('existing-token');failed.mockClear();setAuthFailureHandler(failed);});
afterEach(()=>{vi.unstubAllGlobals();setAccessToken(null);});
it('preserves the login and propagates refresh outages without replaying writes',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(new Response('{}',{status:401})).mockResolvedValueOnce(new Response(JSON.stringify({detail:'Authorization service unavailable'}),{status:503}));vi.stubGlobal('fetch',fetch);
 const result=await authFetch('/api/action',{method:'POST',body:'example'});
 expect(result.status).toBe(503);expect(getAccessToken()).toBe('existing-token');expect(failed).not.toHaveBeenCalled();expect(fetch).toHaveBeenCalledTimes(2);
});
it('retains the login when refresh has a network failure',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response('{}',{status:401})).mockRejectedValueOnce(new TypeError('network unavailable')));
 expect((await authFetch('/api/example')).status).toBe(503);expect(getAccessToken()).toBe('existing-token');expect(failed).not.toHaveBeenCalled();
});
it('still clears a revoked login when refresh returns 401',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response('{}',{status:401})).mockResolvedValueOnce(new Response('{}',{status:401})));
 expect((await authFetch('/api/example')).status).toBe(401);expect(getAccessToken()).toBe(null);expect(failed).toHaveBeenCalledOnce();
});
it('can recover and retry after a successful token refresh',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(new Response('{}',{status:401})).mockResolvedValueOnce(new Response(JSON.stringify({accessToken:'new-token'}),{status:200})).mockResolvedValueOnce(new Response('{}',{status:200}));vi.stubGlobal('fetch',fetch);
 expect((await authFetch('/api/example')).status).toBe(200);expect(getAccessToken()).toBe('new-token');expect(fetch).toHaveBeenCalledTimes(3);expect(failed).not.toHaveBeenCalled();
});
