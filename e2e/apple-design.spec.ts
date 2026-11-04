import {test,expect} from '@playwright/test';

test('Apple-inspired surfaces adapt across modules, appearances and compact navigation',async({page})=>{
  await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
  await page.goto('/login');
  await expect(page.getByRole('heading',{name:'Sign in to Elite HR'})).toBeVisible();
  expect(await page.locator('body').evaluate(element=>getComputedStyle(element).fontFamily)).toContain('system');
  await page.screenshot({path:'test-results/assessment/apple-login-light.png',fullPage:true});
  await page.getByRole('button',{name:'Switch to dark mode'}).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.screenshot({path:'test-results/assessment/apple-login-dark.png',fullPage:true});
  await page.getByRole('button',{name:'Switch to light mode'}).click();
  await page.getByPlaceholder('Enter Email / Phone No').fill('admin@example.com');
  await page.getByPlaceholder('Passcode',{exact:true}).fill('Browser-test-only-2026!');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('navigation',{name:'Primary'})).toBeVisible();
  for(const [button,heading,file] of [
    [/^Jobs/,'Jobs','jobs'],[/^Candidates$/,'Candidates','candidates'],
    [/^Assessments & Profiles/,'All assessments','assessments'],[/^Reports$/,'Reports','reports'],
    [/^Team & Access$/,'Team & User Management','team'],
  ] as const){
    await page.getByRole('navigation',{name:'Primary'}).getByRole('button',{name:button}).click();
    await expect(page.getByRole('heading',{name:heading,exact:true})).toBeVisible();
    if(file==='jobs'){
      await expect(page.getByRole('article',{name:'Workspace Report Engineer'})).toBeVisible();
      const active=page.getByRole('navigation',{name:'Primary'}).locator('[aria-current="page"]');
      await active.hover();
      expect(await active.evaluate(element=>getComputedStyle(element).backgroundColor)).toBe('rgb(0, 102, 204)');
      expect(await active.evaluate(element=>getComputedStyle(element).color)).toBe('rgb(255, 255, 255)');
    }
    if(file==='reports')await expect(page.getByText('Loading reports…',{exact:true})).toHaveCount(0);
    if(file==='candidates')await expect(page.getByRole('table')).toBeVisible();
    if(file==='assessments')await expect(page.getByRole('table')).toBeVisible();
    await page.screenshot({path:`test-results/assessment/apple-${file}-light.png`,fullPage:true});
  }
  await page.getByRole('navigation',{name:'Primary'}).getByRole('button',{name:/^Jobs/}).click();
  await expect(page.getByRole('article',{name:'Workspace Report Engineer'})).toBeVisible();
  await page.getByRole('button',{name:'Switch to dark mode'}).click();
  await page.screenshot({path:'test-results/assessment/apple-jobs-dark.png',fullPage:true});
  const darkColors=await page.getByRole('article',{name:'Workspace Report Engineer'}).evaluate(element=>({background:getComputedStyle(element).backgroundColor,color:getComputedStyle(element).color}));
  expect(darkColors.background).toBe('rgb(28, 28, 30)');
  expect(darkColors.color).toBe('rgb(245, 245, 247)');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const menu=page.getByRole('button',{name:'Open navigation'});
  expect((await menu.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await menu.click();
  await expect(page.getByRole('dialog',{name:'Navigation'})).toBeVisible();
  await page.screenshot({path:'test-results/assessment/apple-navigation-mobile-dark.png',fullPage:true});
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog',{name:'Navigation'})).toHaveCount(0);
  await expect(menu).toBeFocused();
  await page.screenshot({path:'test-results/assessment/apple-jobs-mobile-dark.png',fullPage:true});
  await page.setViewportSize({width:800,height:1000});
  await page.getByRole('button',{name:'Switch to light mode'}).click();
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await page.getByRole('textbox',{name:'Search jobs',exact:true}).boundingBox())!.width).toBeGreaterThan(200);
  expect((await page.getByRole('article',{name:'Workspace Report Engineer'}).boundingBox())!.width).toBeGreaterThan(600);
  await page.screenshot({path:'test-results/assessment/apple-jobs-large-text.png',fullPage:true});
});
