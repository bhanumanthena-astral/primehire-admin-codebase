// Local browser regression check. Every application API request is mocked.
// Usage: node smoke.cjs [path-to-playwright] [local-preview-url]
const { chromium } = require(process.argv[2] || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  const base = process.argv[3] || 'http://127.0.0.1:3100';
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Kolkata' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let saved = null;
  const createRequests = [];
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) {
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      let body = { items: [], total: 0 };
      if (url.pathname === '/api/health') body = { status: 'ok', mongo: 'ok', database: 'mock-browser-test', counts: {} };
      if (url.pathname === '/api/assessments' && request.method() === 'POST') {
        createRequests.push({ body: request.postDataJSON(), headers: request.headers() });
        const now = await page.evaluate(() => Date.now());
        saved = { ...request.postDataJSON(), id: 'mock-object-id', version: 1, isActive: true,
          createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
          syncState: { state: 'synced', syncedAt: new Date(now).toISOString() },
          candidateCreationAvailableAt: new Date(now + 300_000).toISOString() };
        body = saved;
      } else if (url.pathname.startsWith('/api/assessments')) body = { items: saved ? [saved] : [], total: saved ? 1 : 0 };
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
    }
    if (request.url().startsWith(base)) return route.continue();
    return route.abort(); // No external network, invitations or provider records.
  });
  try {
    // Fixed Date values keep assertions independent of test execution speed;
    // regular timers still run, exercising the UI's real countdown interval.
    await page.clock.setFixedTime(new Date('2026-10-13T06:30:00Z'));
    await page.goto(base);
    await page.getByRole('tab', { name: 'Assessments', exact: true }).click();
    await page.getByRole('button', { name: 'New Assessment' }).click();
    await page.getByPlaceholder('e.g. Technical Project Lead').fill('Review flow browser test');
    await page.getByPlaceholder('Outline responsibilities, daily operations, and technical stack parameters...').fill('Review before submitting a spoken technical assessment.');
    const question = page.getByPlaceholder('e.g. Write a React hook to manage debounce input schedules...');
    await question.fill('Explain a React effect.');
    await page.getByPlaceholder('Provide details on correct concepts, structures, or terminology the candidate speech must address...').fill('Effects synchronize components with external systems.');
    await page.getByRole('button', { name: 'Review assessment', exact: true }).click();
    await page.getByRole('heading', { name: 'Preview your assessment' }).waitFor();
    assert.equal(createRequests.length, 0, 'Opening preview must not create an assessment');
    assert.equal(await page.getByRole('button', { name: 'Confirm and create assessment' }).isDisabled(), true);
    assert.equal(await page.getByText('Effects synchronize components with external systems.', { exact: true }).isVisible(), true);
    const output = path.dirname(__filename);
    await page.screenshot({ path: path.join(output, 'preview-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 360, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Preview should fit a mobile viewport');
    await page.screenshot({ path: path.join(output, 'preview-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('button', { name: 'Back to form' }).click();
    assert.equal(await question.inputValue(), 'Explain a React effect.', 'Back must preserve the draft');
    await question.fill('Explain a React effect and its cleanup.');
    await page.getByRole('button', { name: 'Review assessment', exact: true }).click();
    await page.getByText('Explain a React effect and its cleanup.', { exact: true }).waitFor();
    assert.equal(createRequests.length, 0);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Confirm and create assessment' }).click();
    await page.getByText(/Preparing assessment.*remaining/).first().waitFor();
    assert.equal(createRequests.length, 1);
    assert.equal(createRequests[0].body.questions[0].text, 'Explain a React effect and its cleanup.');
    assert.ok(createRequests[0].headers['idempotency-key']);
    assert.equal(await page.getByRole('button', { name: 'Create Assignment (CSV Upload)' }).isDisabled(), true);
    const deadline = saved.candidateCreationAvailableAt;
    await page.clock.setFixedTime(new Date('2026-10-13T06:32:00Z'));
    await page.getByText(/Preparing assessment.*3:00 remaining/).waitFor();
    assert.equal(await page.getByText(/Preparing assessment.*3:00 remaining/).isVisible(), true);
    await page.reload();
    await page.getByRole('tab', { name: 'Assessments', exact: true }).click();
    await page.getByText(/Preparing assessment.*3:00 remaining/).waitFor();
    assert.equal(saved.candidateCreationAvailableAt, deadline);
    assert.equal(await page.getByRole('button', { name: 'Assignments', exact: true }).isDisabled(), true);
    assert.equal(await page.getByTitle('Edit Assessment', { exact: true }).count(), 0);
    await page.clock.setFixedTime(new Date('2026-10-13T06:35:00Z'));
    await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === 'Assignments' && !button.disabled));
    await page.getByRole('button', { name: 'Assignments', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Assignments', exact: true }).isEnabled(), true);
    await page.reload();
    await page.getByRole('tab', { name: 'Assessments', exact: true }).click();
    const assignments = page.getByRole('button', { name: 'Assignments', exact: true });
    await assignments.waitFor();
    assert.equal(await assignments.isEnabled(), true, 'Refresh after expiry must not restart the buffer');
    await assignments.click();
    await page.getByRole('heading', { name: 'CSV Candidate Importer' }).waitFor();
    assert.equal(createRequests.length, 1);
    assert.deepEqual(errors, []);
    const result = { previewBeforeRequest: true, acknowledgementRequired: true, draftPreservedOnBack: true,
      submittedReviewedQuestion: true, mobileWidth: 360, candidateCreationBlockedDuringBuffer: true,
      refreshRetainsRemainingWait: true, unlockAtFiveMinutes: true, refreshAfterExpiryStaysUnlocked: true,
      noEditButton: true, providerRequests: 0, assessmentRequests: createRequests.length, consoleErrors: errors };
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally {
    await context.close();
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
