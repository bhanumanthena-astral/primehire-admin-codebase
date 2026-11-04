import {test, expect} from '@playwright/test';

test('resume drop zone supports selection, review, retry and processing on desktop and mobile', async ({page}, testInfo) => {
  await page.goto('/login');
  await page.getByPlaceholder('Enter Email / Phone No').fill('admin@example.com');
  await page.getByPlaceholder('Passcode').fill('Browser-test-only-2026!');
  await page.getByRole('button', {name: 'Sign in', exact: true}).click();
  await page.getByRole('button', {name: /^Resume Upload/}).click();
  const job = page.getByLabel('Job profile');
  await job.click();
  const option = page.getByRole('option').filter({hasText: 'Viewer Assigned Engineer'});
  await expect(option).toHaveCount(1);
  const jobKey = (await option.getAttribute('data-value'))!;
  await option.click();
  const submit = page.getByRole('button', {name: 'Upload resumes', exact: true});
  await expect(submit).toBeDisabled();
  const picker = page.getByRole('group', {name: /resumes here/});
  await expect(picker).toBeVisible();
  await expect(page.getByRole('button', {name: 'Browse files'})).toBeEnabled();

  const dropped = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(['Example resume for browser UI test'], 'first.pdf', {type: 'application/pdf', lastModified: 1}));
    data.items.add(new File(['Example word resume for browser UI test'], 'second.docx', {lastModified: 1}));
    return data;
  });
  await picker.dispatchEvent('dragenter', {dataTransfer: dropped});
  await expect(page.getByRole('heading', {name: 'Drop your resumes here'})).toBeVisible();
  await picker.dispatchEvent('drop', {dataTransfer: dropped});
  await dropped.dispose();
  await expect(page.getByRole('button', {name: 'Remove first.pdf'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Remove second.docx'})).toBeVisible();
  await page.getByRole('button', {name: 'Remove first.pdf'}).click();
  await page.getByLabel('Resume files').setInputFiles({name: 'third.pdf', mimeType: 'application/pdf', buffer: Buffer.from('Example resume three')});
  await expect(page.getByRole('button', {name: 'Remove third.pdf'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Remove first.pdf'})).toHaveCount(0);
  await expect(submit).toBeDisabled();
  await page.getByRole('checkbox', {name: /Candidate consent confirmed/}).check();
  await expect(submit).toBeEnabled();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({path: testInfo.outputPath('resume-upload-desktop.png'), fullPage: true});
  await page.setViewportSize({width: 390, height: 844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({path: testInfo.outputPath('resume-upload-mobile.png'), fullPage: true});
  await page.setViewportSize({width: 1280, height: 720});

  let attempts = 0;
  let releaseUpload!: () => void;
  const gate = new Promise<void>(resolve => {releaseUpload = resolve;});
  const batch = {batchId: 'browser-upload-ui', jobKey, status: 'processing', counts: {total: 2, parsed: 0, failed: 0, quarantined: 0}};
  const files = ['second.docx', 'third.pdf'].map((fileName, i) => ({fileId: `browser-file-${i}`, fileName, sizeBytes: 30, status: 'uploaded', parsedJson: {}}));
  await page.route('**/api/resumes/upload', async route => {
    attempts++;
    const body = route.request().postData() || '';
    expect(body).toContain(`name="jobKey"\r\n\r\n${jobKey}`);
    expect(body).toContain('name="consent"\r\n\r\ntrue');
    expect(body).toContain('filename="second.docx"');
    expect(body).toContain('filename="third.pdf"');
    if (attempts === 1) {
      await gate;
      await route.fulfill({status: 503, json: {detail: 'Upload unavailable. Please retry.'}});
    } else {
      await route.fulfill({json: {batch, files}});
    }
  });
  await page.route('**/api/resumes/batches/browser-upload-ui', route => route.fulfill({json: {
    batch: {...batch, status: 'done', counts: {...batch.counts, parsed: 2}},
    files: files.map(file => ({...file, status: 'parsed'})),
  }}));
  await submit.click();
  await expect(page.getByRole('progressbar', {name: 'Uploading resumes'})).toBeVisible();
  await expect(job).toBeDisabled();
  await expect(page.getByRole('button', {name: 'Remove third.pdf'})).toBeDisabled();
  releaseUpload();
  await expect(page.getByRole('form', {name: 'Upload resumes'}).getByRole('alert')).toHaveText('Upload unavailable. Please retry.');
  await expect(page.getByRole('button', {name: 'Remove third.pdf'})).toBeEnabled();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByLabel('Selected resumes')).toHaveCount(0);
  const progress = page.getByRole('progressbar', {name: 'Resume processing progress'});
  await expect(progress).toHaveAttribute('aria-valuenow', '2');
  await expect(progress).toHaveAttribute('aria-valuemax', '2');
  expect(attempts).toBe(2);
});

