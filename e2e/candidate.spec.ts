import {test,expect,Page} from '@playwright/test';

async function login(page:Page,email='admin@example.com'){
  await page.goto('/login');await page.getByPlaceholder('Enter Email / Phone No').fill(email);
  await page.getByPlaceholder('Passcode').fill('Browser-test-only-2026!');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('button',{name:/^Candidates/}).first().click();
  await expect(page.getByRole('heading',{name:'Candidates',exact:true})).toBeVisible();
}

test('candidate list paginates and clears search; profile saves and rejects an invalid edit without losing data',async({page})=>{
  await login(page);
  await expect(page.getByRole('table')).toContainText('Synthetic Candidate A');
  await page.getByRole('button',{name:'Next',exact:true}).click();await expect(page.getByText('21–23 of 23',{exact:true})).toBeVisible();
  await page.getByLabel('Search name, email or Candidate ID').fill('absent candidate');
  await expect(page.getByText('No candidates match your filters.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Clear candidate filters',exact:true}).click();
  await page.getByRole('row').filter({hasText:'Synthetic Candidate A'}).getByRole('button',{name:'View details'}).click();
  await expect(page.getByRole('heading',{name:'Synthetic Candidate A',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Edit candidate',exact:true}).click();
  await expect(page.getByLabel('Email ID',{exact:true})).toHaveValue('fixture0@example.test');
  await page.getByLabel('Candidate name *',{exact:true}).fill("Élodie O'Neill");
  await page.getByLabel('Current designation',{exact:true}).fill('Platform Engineer');
  await page.getByLabel('Key skills (comma separated)',{exact:true}).fill('Python, SQL, python');
  await page.getByRole('button',{name:'Save candidate details',exact:true}).click();
  await expect(page.getByText('Candidate details updated successfully.',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:"Élodie O'Neill",exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Edit candidate',exact:true}).click();await page.getByLabel('Phone number',{exact:true}).fill('123');
  await page.getByRole('button',{name:'Save candidate details',exact:true}).click();await expect(page.getByRole('alert')).toContainText('7–15 digits');
  await expect(page.getByLabel('Phone number',{exact:true})).toHaveValue('123');
  await page.getByRole('button',{name:'Cancel editing',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'test-results/candidate/profile-mobile.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('assessment selection, date confirmation, separate link generation and blocked early candidate access',async({page})=>{
  await login(page);
  await page.getByLabel('Search name, email or Candidate ID').fill('browser-person-01');
  await expect(page.getByRole('button',{name:'View details'})).toHaveCount(1);
  await page.getByRole('button',{name:'View details'}).click();
  await page.getByRole('button',{name:'Assign assessment',exact:true}).first().click();
  const dialog=page.getByRole('dialog',{name:'Assign assessment',exact:true});
  await dialog.getByLabel('Available assessment').click();
  await page.getByRole('option').filter({hasText:'Browser Technical Assessment'}).click();
  await dialog.getByLabel('Associated application').click();
  await page.getByRole('option').filter({hasText:'browser-app-01'}).click();
  await dialog.getByRole('button',{name:'Review assignment',exact:true}).click();
  await expect(dialog).toContainText('This saves the assignment only');
  await dialog.getByRole('button',{name:'Confirm assignment',exact:true}).click();await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Assessment assigned successfully.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Configure dates',exact:true}).click();
  const dates=page.getByRole('dialog',{name:'Configure assessment dates'});
  await dates.getByRole('button',{name:'Review assignment',exact:true}).click();
  await dates.getByRole('button',{name:'Confirm dates',exact:true}).click();await expect(dates).not.toBeVisible();
  await page.getByRole('button',{name:'Generate assessment link',exact:true}).click();
  const generated=page.getByRole('dialog',{name:'Assessment link generated'});
  await expect(generated.getByLabel('Provider access code')).toHaveValue('Fixture-code-only');
  const url=await generated.getByLabel('Generated invite link').inputValue();expect(url).not.toContain('browser-person');
  await generated.getByRole('button',{name:'Done',exact:true}).click();
  await expect(page.getByRole('button',{name:'Generate assessment link',exact:true})).toHaveCount(0);
  await page.screenshot({path:'test-results/candidate/assigned-profile.png',fullPage:true});
  await page.goto(url);await page.getByRole('button',{name:'Continue to assessment',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveText('This assessment is not open yet');
});

test('read-only user sees shared candidate without edit, assignment or contact reveal controls',async({page})=>{
  await login(page,'viewer@example.com');
  await expect(page.getByRole('table')).toContainText('browser-person-00');
  await expect(page.getByText('0 records',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'View details'}).click();
  await expect(page.getByRole('button',{name:'Edit candidate',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Assign assessment',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Reveal contact details',exact:true})).toHaveCount(0);
  await expect(page.getByText('fixture0@example.test',{exact:true})).toHaveCount(0);
});
