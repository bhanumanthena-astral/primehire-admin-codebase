import {test, expect, Page} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';

const fixture = (kind:string) => execFileSync(existsSync('backend/.venv-v2/Scripts/python.exe')?'backend/.venv-v2/Scripts/python.exe':'backend/.venv/Scripts/python.exe',['backend/tests/intake_browser_fixtures.py',kind]);
async function login(page:Page,email='admin@example.com') {
  await page.goto('/login');
  await page.getByPlaceholder('Enter Email / Phone No').fill(email);
  await page.getByPlaceholder('Passcode').fill('Browser-test-only-2026!');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('button',{name:/^Resume Upload/}).click();
  await expect(page.getByLabel('Resume intake workspace')).toBeVisible();
}
async function upload(page:Page,name:string,kind:string,mime:string) {
  await page.getByLabel('Resume files',{exact:true}).setInputFiles({name,mimeType:mime,buffer:fixture(kind)});
  await page.getByRole('checkbox',{name:'Candidate consent confirmed'}).check();
  await page.getByRole('button',{name:'Upload resumes',exact:true}).click();
  await expect(page.getByRole('tab',{name:'Processing & review'})).toHaveAttribute('aria-selected','true');
}
async function centered(page:Page) {
  const dialog=page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const rect=(await dialog.boundingBox())!;
  const viewport=page.viewportSize()!;
  expect(Math.abs(rect.x+rect.width/2-viewport.width/2)).toBeLessThan(3);
  expect(Math.abs(rect.y+rect.height/2-viewport.height/2)).toBeLessThan(3);
  expect(rect.height).toBeLessThan(viewport.height);
}

test('DOCX review, correction, confirmation, ATS and responsive candidate dialog',async({page})=>{
  await login(page);
  await expect(page.getByRole('button',{name:'Upload resumes',exact:true})).toBeDisabled();
  await upload(page,'browser.docx','docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  const row=page.getByRole('table',{name:'Resume and ATS review'}).getByRole('row').filter({hasText:'browser.docx'});
  await expect(row.getByText('Review required',{exact:true})).toBeVisible();
  await page.getByLabel('Minimum ATS percentage').fill('0');
  await page.getByRole('button',{name:'Save range & score resumes'}).click();
  await expect(row.getByText('Within ATS range',{exact:true})).toBeVisible();
  await row.getByRole('button',{name:'Review profile'}).click();
  await centered(page);
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByLabel('Email',{exact:true})).toHaveValue('browser.candidate@example.com');
  await dialog.getByLabel('Candidate name',{exact:true}).fill('Corrected Browser Candidate');
  await dialog.getByRole('button',{name:'Save corrections'}).click();
  await expect(dialog.getByText('Reviewed profile saved.')).toBeVisible();
  await dialog.getByRole('button',{name:'Confirm candidate & application'}).click();
  await expect(dialog.getByRole('region',{name:'Application ATS score'})).toBeVisible();
  await expect(dialog.getByText('Completed',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Recalculate ATS'}).click();
  await expect(dialog.getByText('ATS recalculated for this application.')).toBeVisible();
  const download=page.waitForEvent('download');
  await dialog.getByRole('button',{name:'Download original'}).click();
  expect((await download).suggestedFilename()).toBe('browser.docx');
  await dialog.getByRole('button',{name:'Close dialog'}).click();
  await page.getByRole('tab',{name:'Candidate database'}).click();
  await expect(page.getByText('Corrected Browser Candidate',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'View candidate profile'}).click();
  await page.setViewportSize({width:390,height:844});
  await centered(page);
  await page.screenshot({path:'test-results/intake/mobile-review.png',fullPage:true});
});

test('ZIP keeps valid resumes, identifies unsafe entries and downloads its error report',async({page})=>{
  await login(page);
  await page.getByRole('radio',{name:'ZIP archive',exact:true}).check();
  await upload(page,'batch.zip','zip','application/zip');
  await expect(page.getByRole('table',{name:'Resume and ATS review'}).getByRole('row').filter({hasText:'valid.docx'}).getByRole('button',{name:'Review profile'})).toBeVisible();
  await expect(page.getByRole('table',{name:'Resume and ATS review'}).getByRole('row').filter({hasText:'../unsafe.docx'}).getByText('Rejected',{exact:true})).toBeVisible();
  await expect(page.getByRole('table',{name:'Resume and ATS review'}).getByRole('row').filter({hasText:'invalid.png'}).getByText('Unsupported format',{exact:true})).toBeVisible();
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Error report',exact:true}).click();
  expect((await download).suggestedFilename()).toBe('resume-errors.csv');
  await page.screenshot({path:'test-results/intake/zip-results.png',fullPage:true});
});

test('Excel template, partial validation and ATS-range profile creation',async({page})=>{
  await login(page);
  await page.getByRole('radio',{name:'Excel import',exact:true}).check();
  const template=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download Excel template'}).click();
  expect((await template).suggestedFilename()).toBe('primehire-candidate-template.xlsx');
  await upload(page,'profiles.xlsx','excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  await expect(page.getByRole('table',{name:'Resume and ATS review'}).getByRole('row').filter({hasText:'Excel row 2'}).getByText('Review required',{exact:true})).toBeVisible();
  await expect(page.getByRole('table',{name:'Resume and ATS review'}).getByRole('row').filter({hasText:'Excel row 3'}).getByText('Rejected',{exact:true})).toBeVisible();
  await page.getByLabel('Minimum ATS percentage').fill('0');
  await page.getByRole('button',{name:'Save range & score resumes'}).click();
  await expect(page.getByRole('button',{name:'Create profiles in ATS range',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Create profiles in ATS range',exact:true}).click();
  await centered(page);
  const dialog=page.getByRole('dialog',{name:'Candidate creation progress'});
  await expect(dialog.getByRole('heading',{name:'Candidate profile creation'})).toBeVisible();
  await expect(dialog.getByText('Processing finished. Profiles that need attention remain available for review.',{exact:true})).toBeVisible();
  await page.screenshot({path:'test-results/intake/profile-creation-progress.png',fullPage:true});
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await expect(page.getByRole('table',{name:'Resume and ATS review'}).getByRole('row').filter({hasText:'Excel row 2'}).getByText('Completed',{exact:true})).toBeVisible();
});

test('viewer gets a read-only workspace and cannot upload',async({page})=>{
  await login(page,'viewer@example.com');
  await expect(page.getByRole('tab',{name:'Processing results'})).toBeVisible();
  await expect(page.getByRole('tab',{name:'Upload resumes'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Settings',exact:true})).toHaveCount(0);
  await page.getByRole('tab',{name:'Candidate database'}).click();
  await expect(page.getByLabel('Job profile')).toContainText('Viewer Assigned Engineer');
});


test('ATS range keeps excluded resumes visible and lowering to 50 changes eligibility on desktop and mobile',async({page})=>{
  await login(page);
  await page.getByRole('radio',{name:'Excel import',exact:true}).check();
  await upload(page,'ats-range.xlsx','ats-range','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const row45=page.getByRole('table',{name:'Resume and ATS review'}).getByRole('row').filter({hasText:'Excel row 2'});
  const row55=page.getByRole('table',{name:'Resume and ATS review'}).getByRole('row').filter({hasText:'Excel row 3'});
  const row85=page.getByRole('table',{name:'Resume and ATS review'}).getByRole('row').filter({hasText:'Excel row 4'});
  await expect(row55.getByText('Review required',{exact:true})).toBeVisible();
  const panel=page.getByRole('region',{name:'ATS score range'});
  await expect(panel.getByRole('slider')).toHaveCount(2);
  await panel.getByRole('button',{name:'Save range & score resumes'}).click();
  await expect(row55.getByText('Below minimum · retained',{exact:true})).toBeVisible();
  await expect(row85.getByText('Within ATS range',{exact:true})).toBeVisible();
  await expect(row45).toBeVisible();
  const minimum=panel.getByRole('slider',{name:'Minimum ATS score'});
  await minimum.focus();
  for(let i=0;i<10;i++)await minimum.press('ArrowLeft');
  await expect(minimum).toHaveAttribute('aria-valuenow','50');
  await panel.getByRole('button',{name:'Apply ATS range'}).click();
  await expect(row55.getByText('Within ATS range',{exact:true})).toBeVisible();
  await expect(row45.getByText('Below minimum · retained',{exact:true})).toBeVisible();
  await panel.getByLabel('Maximum ATS percentage').fill('80');
  await panel.getByRole('button',{name:'Apply ATS range'}).click();
  await expect(row85.getByText('Above maximum · retained',{exact:true})).toBeVisible();
  await expect(row55.getByText('Within ATS range',{exact:true})).toBeVisible();
  await page.screenshot({path:'test-results/intake/ats-range-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/intake/ats-range-mobile.png',fullPage:true});
});
