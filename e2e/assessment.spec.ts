import { test, expect, Page } from '@playwright/test';

async function login(page:Page,email='admin@example.com'){
  await page.goto('/login');await page.getByPlaceholder('Enter Email / Phone No').fill(email);
  await page.getByPlaceholder('Passcode').fill('Browser-test-only-2026!');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('button',{name:/^Assessments & Profiles/}).click();
  await expect(page.getByRole('heading',{name:'All assessments',exact:true})).toBeVisible();
}

test('existing form creates a draft only after preview and confirmation, supports edits and explicit publication',async({page})=>{
  await login(page);
  await page.getByRole('button',{name:'New assessment',exact:true}).click();
  await page.getByLabel('Assessment job title',{exact:true}).fill('Browser Manual Assessment');
  await page.getByLabel('Assessment job description',{exact:true}).fill('Build well tested Python services with a collaborative team.');
  await page.getByLabel('Assessment start date',{exact:true}).fill('2027-01-01T10:00');
  await page.getByLabel('Assessment end date',{exact:true}).fill('2027-01-31T10:00');
  await page.getByLabel('Question 1 prompt',{exact:true}).fill('Explain a dictionary');
  await page.getByLabel('Question 1 reference answer',{exact:true}).fill('Maps unique keys to values');
  await page.getByLabel('Question 1 weightage',{exact:true}).fill('100');
  await page.getByRole('button',{name:'Preview assessment draft',exact:true}).click();
  const preview=page.getByRole('dialog',{name:'Preview assessment draft',exact:true});
  await expect(preview).toContainText('Maps unique keys to values');
  await preview.getByRole('button',{name:'Confirm and save draft',exact:true}).click();
  await expect(preview).not.toBeVisible();
  await page.getByLabel('Search assessment ID or job description').fill('Browser Manual Assessment');
  let row=page.getByRole('row').filter({hasText:'Browser Manual Assessment'});
  await expect(row).toContainText('Draft');
  await row.getByRole('button',{name:'Edit',exact:true}).click();
  await expect(page.getByLabel('Assessment ID',{exact:true})).toHaveAttribute('readonly','');
  await expect(page.getByLabel('Question 1 prompt',{exact:true})).toHaveValue('Explain a dictionary');
  await page.getByLabel('Question 1 prompt',{exact:true}).fill('Explain dictionary key uniqueness');
  await page.getByRole('button',{name:'Preview assessment draft',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Confirm and save draft',exact:true}).click();
  await page.getByLabel('Search assessment ID or job description').fill('Browser Manual Assessment');
  row=page.getByRole('row').filter({hasText:'Browser Manual Assessment'});
  await row.getByRole('button',{name:'View',exact:true}).click();
  await expect(page.getByText('Explain dictionary key uniqueness',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Preview publication',exact:true}).click();
  const publish=page.getByRole('dialog',{name:'Confirm assessment publication',exact:true});
  await expect(publish).toContainText('Its questions will be locked');
  await publish.getByRole('button',{name:'Confirm and publish',exact:true}).click();
  await expect(publish).not.toBeVisible();
  await expect(page.getByRole('button',{name:'Edit draft',exact:true})).toHaveCount(0);
  await expect(page.getByText('Published questions are locked to protect candidate attempts. Create a new draft for a different configuration.',{exact:true})).toBeVisible();
  await page.screenshot({path:'test-results/assessment/published-details.png',fullPage:true});
});

test('CSV groups validate, preview and confirm; duplicates do not recreate drafts',async({page})=>{
  await login(page);
  await expect(page.getByRole('button',{name:'Next assessments',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Next assessments',exact:true}).click();
  await expect(page.getByText(/Page 2 of/)).toBeVisible();
  await page.getByRole('button',{name:'Import assessment CSV',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Import assessment CSV',exact:true});
  const download=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download CSV template'}).click();
  expect((await download).suggestedFilename()).toBe('assessment_upload_template.csv');
  const headers=['Assessment Group ID','Job Description','Language Selection','Round Type','Start Date','End Date','Question Type','Max Duration (Seconds)','Max Score','Weightage (%)','Question Prompt / Text','Expected Reference Answer'];
  const rows=[headers,['browser-csv','CSV Python engineering','English','TECHNICAL','2027-01-01','2027-01-31','SPEAK_TO_ANSWER','120','10','50','Explain Python lists','An ordered mutable sequence'],
    ['browser-csv','CSV Python engineering','English','TECHNICAL','2027-01-01','2027-01-31','SPEAK_TO_ANSWER','120','10','50','Explain Python tuples','An immutable sequence'],
    ['invalid-csv','Invalid assessment','French','TECHNICAL','2027-01-01','2027-01-31','SPEAK_TO_ANSWER','120','10','100','Explain Python sets','Unique values']];
  const csv=rows.map(row=>row.join(',')).join('\r\n');
  await dialog.getByLabel('Assessment CSV file').setInputFiles({name:'assessment.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await expect(dialog.getByText(/1 valid assessments · 1 invalid groups/)).toBeVisible();
  await dialog.getByRole('button',{name:'Preview browser-csv (2 questions)',exact:true}).click();
  await expect(dialog.getByText('Explain Python tuples',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Review import confirmation',exact:true}).click();
  await dialog.getByRole('button',{name:'Confirm import',exact:true}).click();
  await expect(dialog.getByRole('region',{name:'Assessment import summary'})).toContainText('1 drafts created');
  await dialog.getByLabel('Assessment CSV file').setInputFiles({name:'assessment.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await expect(dialog.getByText(/0 valid assessments · 1 invalid groups · 1 duplicates/)).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Review import confirmation',exact:true})).toHaveCount(0);
  await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  await page.getByLabel('Search assessment ID or job description').fill('CSV Python engineering');
  const row=page.getByRole('row').filter({hasText:'CSV Python engineering'});
  await row.getByRole('button',{name:'View',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Questions (2)',exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/assessment/draft-details-mobile.png',fullPage:true});
});

test('read-only login sees only explicitly shared assessments and cannot create or edit',async({page})=>{
  await login(page,'viewer@example.com');
  await expect(page.getByRole('button',{name:'New assessment',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Import assessment CSV',exact:true})).toHaveCount(0);
  await expect(page.getByRole('row').filter({hasText:'Seeded Assessment 00'})).toBeVisible();
  await expect(page.getByRole('row').filter({hasText:'Seeded Assessment 01'})).toHaveCount(0);
  await page.getByRole('button',{name:'View',exact:true}).click();
  await expect(page.getByRole('button',{name:'Edit draft',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Candidate assignments',exact:true})).toHaveCount(0);
});

test('Dutch BASIC CSV drafts retain their rubric when edited through the existing form',async({page})=>{
  await login(page);
  await page.getByRole('button',{name:'Import assessment CSV',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Import assessment CSV',exact:true});
  const csv='Assessment Group ID,Job Description,Language Selection,Round Type,Start Date,End Date,Question Type,Max Duration (Seconds),Max Score,Weightage (%),Question Prompt / Text,Expected Reference Answer\r\n'+
    'dutch-basic,Dutch Basic Assessment,Dutch,BASIC,2027-01-01,2027-01-31,SPEAK_TO_ANSWER,120,10,100,Describe teamwork,Original grading rubric\r\n';
  await dialog.getByLabel('Assessment CSV file').setInputFiles({name:'dutch.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await dialog.getByRole('button',{name:'Review import confirmation',exact:true}).click();
  await dialog.getByRole('button',{name:'Confirm import',exact:true}).click();
  await expect(dialog.getByRole('region',{name:'Assessment import summary'})).toContainText('1 drafts created');
  await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.getByLabel('Search assessment ID or job description').fill('Dutch Basic Assessment');
  const row=page.getByRole('row').filter({hasText:'Dutch Basic Assessment'});
  await expect(row).toContainText('DUTCH');
  await row.getByRole('button',{name:'Edit',exact:true}).click();
  await expect(page.getByLabel('Question 1 grading criteria',{exact:true})).toHaveValue('Original grading rubric');
  await page.getByLabel('Question 1 grading criteria',{exact:true}).fill('Updated grading rubric');
  await page.getByRole('button',{name:'Preview assessment draft',exact:true}).click();
  const preview=page.getByRole('dialog',{name:'Preview assessment draft',exact:true});
  await expect(preview).toContainText('Updated grading rubric');
  await preview.getByRole('button',{name:'Confirm and save draft',exact:true}).click();
  await page.getByLabel('Search assessment ID or job description').fill('Dutch Basic Assessment');
  await page.getByRole('row').filter({hasText:'Dutch Basic Assessment'}).getByRole('button',{name:'View',exact:true}).click();
  await expect(page.getByText(/Expected reference answer: Updated grading rubric/)).toBeVisible();
});


test('job assessment actions own invitations while candidate reports open real reports and scheduling',async({page})=>{
  await login(page);
  await page.getByRole('button',{name:/^Jobs/}).click();
  await page.getByRole('article',{name:'Workspace Report Engineer'}).getByRole('button',{name:'Open workspace',exact:true}).click();
  await page.getByRole('button',{name:'3. Assessments',exact:true}).click();
  const linker=page.getByRole('region',{name:'Job assessment assignment'});
  await expect(linker.getByRole('combobox',{name:'Published assessment'})).toBeVisible();
  await expect(linker.getByRole('table')).toHaveCount(0);
  await expect(linker.getByLabel('Assignment starts')).toHaveCount(0);
  await page.getByRole('button',{name:'View table',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Candidates, results & invitations'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Generate links',exact:true})).toBeVisible();
  await expect(page.getByRole('row').filter({hasText:'Workspace Candidate 0'})).toContainText('84');
  const candidateSearch=page.getByRole('searchbox',{name:'Search candidates by name or email'});
  await candidateSearch.fill('WORKSPACE0@example.test');
  await expect(page.getByRole('row').filter({hasText:'Workspace Candidate 0'})).toBeVisible();
  await expect(page.getByRole('row').filter({hasText:'Workspace Candidate 1'})).toHaveCount(0);
  await candidateSearch.fill('Workspace Candidate 1');
  await expect(page.getByRole('row').filter({hasText:'Workspace Candidate 1'})).toBeVisible();
  await expect(page.getByRole('row').filter({hasText:'Workspace Candidate 0'})).toHaveCount(0);
  await page.getByRole('button',{name:'Clear search',exact:true}).click();
  await expect(page.getByRole('row').filter({hasText:'Workspace Candidate 0'})).toBeVisible();
  await page.screenshot({path:'test-results/assessment/job-invitations.png',fullPage:true});
  await page.getByRole('button',{name:'4. Candidate reports',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Candidate reports',exact:true})).toBeVisible();
  const columns=await page.getByRole('columnheader').allTextContents();
  expect(columns).toEqual(['Candidate name','ATS score','Pipeline stage','Assessment score','Actions']);
  await expect(page.getByRole('button',{name:'Generate links',exact:true})).toHaveCount(0);
  const row=page.getByRole('row').filter({hasText:'Workspace Candidate 0'});
  await row.getByRole('button',{name:'View report',exact:true}).click();
  const report=page.getByRole('dialog',{name:'Assessment report for Workspace Candidate 0'});
  await expect(report.getByRole('heading',{name:'Overview',exact:true})).toBeVisible();
  await expect(report.getByRole('button',{name:'Open preserved report & version history'})).toBeVisible();
  await page.screenshot({path:'test-results/assessment/job-candidate-report.png',fullPage:true});
  await report.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/assessment/job-candidate-reports-mobile.png',fullPage:true});
  await row.getByRole('button',{name:'Schedule interview',exact:true}).click();
  await expect(page.getByRole('button',{name:'5. Interview scheduling',exact:true})).toHaveAttribute('aria-current','step');
  const schedule=page.getByRole('dialog',{name:'Schedule interview'});
  await expect(schedule).toContainText('Workspace Candidate 0');
  await expect(schedule.getByRole('heading',{name:'Schedule an interview',exact:true})).toBeVisible();
  await page.screenshot({path:'test-results/assessment/job-candidate-scheduling-mobile.png',fullPage:true});
});
