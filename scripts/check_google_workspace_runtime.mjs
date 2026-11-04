/** Google browser regressions with synthetic auth/provider routes only. */
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';

const vite=await createServer({configFile:path.resolve('frontend/vite.config.ts'),server:{port:0,host:'127.0.0.1'}});
await vite.listen();
const origin=`http://127.0.0.1:${vite.httpServer.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true});
const user={userId:'synthetic-reviewer',orgId:'default',name:'Synthetic Interviewer',email:'synthetic@example.test',
  role:'technical_interviewer',isActive:true,mfaEnabled:false};
try{
  await mkdir('.tmp',{recursive:true});
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  let signedIn=false,completionCalls=0;
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());let body={},status=200;
    if(url.pathname==='/api/auth/refresh'){
      if(signedIn)body={accessToken:'synthetic-browser-token',user};else{status=401;body={detail:'No synthetic session'};}
    }else if(url.pathname==='/api/auth/google/config')body={enabled:false};
    else if(url.pathname==='/api/auth/google/complete'){completionCalls++;body={mfaRequired:true,mfaToken:'synthetic-mfa',returnTo:'/reports'};}
    else if(url.pathname==='/api/recruitment/capabilities')body={enabled:true,canManage:false,canReview:true,workerReady:true,emailDryRun:true};
    else if(url.pathname==='/api/google/calendar')body={enabled:true,connected:false,status:'not_connected',calendar:'primary'};
    else if(url.pathname==='/api/google/calendar/connect')body={authorizationUrl:'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic'};
    else if(url.pathname.endsWith('/capabilities'))body={enabled:true};
    else if(url.pathname==='/api/auth/me')body=user;
    else body={items:[],total:0};
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto(origin+'/login');
  await page.getByText('Google sign-in needs administrator setup.').waitFor();
  assert.equal(await page.getByRole('button',{name:'Sign in with Google',exact:true}).isDisabled(),true);
  await page.screenshot({path:'.tmp/google-login.png',fullPage:true});
  await page.goto(origin+'/auth/google/complete');
  await page.getByRole('heading',{name:'Two-Factor Authentication'}).waitFor();
  assert.equal(completionCalls,1);
  assert.equal(new URL(page.url()).pathname,'/login');
  assert.equal(new URL(page.url()).search,'');
  signedIn=true;
  await page.goto(origin);
  await page.getByRole('button',{name:'Google Calendar',exact:true}).waitFor();
  await page.getByRole('button',{name:'Google Calendar',exact:true}).click();
  await page.getByText('No Google Calendar connected.').waitFor();
  await page.screenshot({path:'.tmp/google-calendar-connection.png',fullPage:true,animations:'disabled'});
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Connect Google Calendar',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.screenshot({path:'.tmp/google-calendar-mobile.png',fullPage:true,animations:'disabled'});
  assert.deepEqual(errors,[]);
  console.log('Google login setup state, one-use completion/MFA handoff, reviewer Calendar consent dialog and mobile layout passed. No Google API called.');
}finally{
  await browser.close();await vite.close();
}
