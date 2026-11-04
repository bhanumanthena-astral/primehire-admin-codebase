import { test, expect } from '@playwright/test';

test('invited HR creates a password and sees no other HR jobs', async ({page}) => {
  await page.goto('/accept-invite#token=browser-fixture-invitation-not-a-real-token');
  await expect(page.getByRole('heading',{name:'Create your password'})).toBeVisible();
  await expect(page).toHaveURL(/\/accept-invite$/);
  await page.getByLabel('New password').fill('Browser-invitation-test-2026!');
  await page.getByLabel('Confirm password').fill('Browser-invitation-test-2026!');
  await page.getByRole('button',{name:'Create password',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your account is ready'})).toBeVisible();
  await page.getByRole('link',{name:'Go to sign in'}).click();
  await page.getByPlaceholder('Enter Email / Phone No').fill('invited@example.com');
  await page.getByPlaceholder('Passcode').fill('Browser-invitation-test-2026!');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Jobs',exact:true})).toBeVisible();
  await expect(page.getByRole('article',{name:'Seeded Demo Engineer'})).toHaveCount(0);
  const denied = await page.evaluate(async () => {
    const r = await fetch('/api/auth/accept-invite',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({token:'browser-fixture-invitation-not-a-real-token',newPassword:'Replacement-test-password!'})});
    return r.status;
  });
  expect(denied).toBe(400);
});

test('Admin imports JD locally, reviews, saves, publishes, holds and resumes', async ({ page }) => {
  let modelCalls = 0;
  page.on('request', r => { if (/openrouter\.ai/.test(r.url())) modelCalls++; });
  await page.goto('/login');
  await page.getByPlaceholder('Enter Email / Phone No').fill('admin@example.com');
  await page.getByPlaceholder('Passcode').fill('Browser-test-only-2026!');
  await page.getByRole('button', {name:'Sign in',exact:true}).click();
  await page.getByRole('button', {name:/Jobs/}).first().click();
  await page.getByRole('button', {name:/Create Job/i}).click();
  await page.getByRole('radio', {name:/JD Document/}).click();
  await page.getByLabel('Upload JD file').setInputFiles('e2e/fixtures/job.docx');
  await expect(page.getByText(/Local extraction complete/)).toBeVisible();
  await expect(page.getByLabel('Job Title', {exact:true})).toHaveValue('Browser Demo Engineer');
  await page.getByRole('button',{name:'Create job',exact:true}).click();
  await expect(page.getByText('Job created successfully.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:/Back to Jobs/}).click();
  await page.getByRole('article',{name:'Browser Demo Engineer'}).getByRole('button',{name:'View job',exact:true}).click();
  await page.getByRole('button',{name:'Publish',exact:true}).click();
  await expect(page.getByRole('button',{name:'Put on hold',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Put on hold',exact:true}).click();
  await expect(page.getByRole('button',{name:'Resume',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Resume',exact:true}).click();
  await expect(page.getByRole('button',{name:'Put on hold',exact:true})).toBeVisible();
  expect(modelCalls).toBe(0);
});

test('viewer can read jobs but cannot manage them', async ({page}) => {
  await page.goto('/login');
  await page.getByPlaceholder('Enter Email / Phone No').fill('viewer@example.com');
  await page.getByPlaceholder('Passcode').fill('Browser-test-only-2026!');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Jobs',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/Create Job/i})).toHaveCount(0);
  await expect(page.getByRole('article',{name:'Seeded Demo Engineer'})).toHaveCount(0);
  await page.getByRole('article',{name:'Viewer Assigned Engineer'}).getByRole('button',{name:'View job',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Viewer Assigned Engineer',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Edit',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Put on hold',exact:true})).toHaveCount(0);
});

test('recruiter can open job creation', async ({page}) => {
  await page.goto('/login');
  await page.getByPlaceholder('Enter Email / Phone No').fill('recruiter@example.com');
  await page.getByPlaceholder('Passcode').fill('Browser-test-only-2026!');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Jobs',exact:true})).toBeVisible();
  await page.getByRole('button',{name:/Create Job/i}).click();
  await expect(page.getByRole('heading',{name:'Create Job',exact:true})).toBeVisible();
});

test('admin invites with upload-only access and job restrictions follow status', async ({page,browser},testInfo) => {
  await page.goto('/login');
  await page.getByPlaceholder('Enter Email / Phone No').fill('admin@example.com');
  await page.getByPlaceholder('Passcode').fill('Browser-test-only-2026!');
  const loginResponse=page.waitForResponse(r=>r.url().endsWith('/api/auth/login')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  const {accessToken}=await (await loginResponse).json();
  const headers={Authorization:`Bearer ${accessToken}`};
  await page.getByRole('button',{name:/Team & Access/}).click();
  await page.getByRole('button',{name:'Invite Member'}).click();
  await page.getByPlaceholder('Jane Doe').fill('Upload Recruiter');
  await page.getByPlaceholder('jane@company.com').fill('upload-only@example.com');
  await page.locator('form').getByRole('combobox').click();
  await page.getByRole('option', {name: 'Recruiter', exact: true}).click();
  await expect(page.getByRole('checkbox',{name:/Edit job details/})).not.toBeChecked();
  await expect(page.getByRole('checkbox',{name:/Upload resumes/})).toBeChecked();
  const inviteResponse=page.waitForResponse(r=>r.url().endsWith('/api/users')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Generate Invitation'}).click();
  const invitation=await (await inviteResponse).json();
  expect(invitation.user.jobAccess.sort()).toEqual(['upload','view']);
  const jobs=await (await page.request.get('/api/jobs',{headers})).json();
  const job=jobs.find((j:{title:string})=>j.title==='Seeded Demo Engineer');
  expect((await page.request.post(`/api/jobs/${job.jobId}/assign`,{headers,data:{email:'upload-only@example.com'}})).status()).toBe(200);
  const context=await browser.newContext();const staff=await context.newPage();
  try {
    await staff.goto(`http://127.0.0.1:4173${invitation.inviteUrl}`);
    await staff.getByLabel('New password').fill('Upload-browser-test-2026!');
    await staff.getByLabel('Confirm password').fill('Upload-browser-test-2026!');
    await staff.getByRole('button',{name:'Create password',exact:true}).click();
    await staff.getByRole('link',{name:'Go to sign in'}).click();
    await staff.getByPlaceholder('Enter Email / Phone No').fill('upload-only@example.com');
    await staff.getByPlaceholder('Passcode').fill('Upload-browser-test-2026!');
    await staff.getByRole('button',{name:'Sign in',exact:true}).click();
    const card=staff.getByRole('article',{name:'Seeded Demo Engineer'});
    await expect(card).toBeVisible();
    await expect(staff.getByRole('button',{name:/Create Job/})).toHaveCount(0);
    await expect(card.getByLabel('Edit Seeded Demo Engineer')).toHaveCount(0);
    await expect(card.getByLabel('Change status for Seeded Demo Engineer')).toHaveCount(0);
    await expect(card.getByText('Upload Recruiter')).toBeVisible();
    await staff.screenshot({path:testInfo.outputPath('staff-jobs-cards.png'),fullPage:true});
    await staff.setViewportSize({width:390,height:844});
    expect(await staff.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await staff.screenshot({path:testInfo.outputPath('staff-jobs-mobile.png'),fullPage:true});
    await staff.setViewportSize({width:1280,height:720});
    await card.getByRole('button',{name:'Upload resumes'}).click();
    await expect(staff.getByLabel('Job profile')).toHaveAttribute('value', job.jobKey);
    expect((await page.request.post(`/api/jobs/${job.jobId}/lifecycle`,{headers,data:{status:'ON_HOLD'}})).status()).toBe(200);
    await staff.getByRole('button',{name:/Jobs/}).first().click();
    await expect(card.getByRole('button',{name:'Upload resumes'})).toHaveCount(0);
    await expect(card.getByRole('button',{name:'View job'})).toHaveCount(0);
    await expect(card.getByText(/Hiring is paused/)).toBeVisible();
  } finally {await context.close();}
});
