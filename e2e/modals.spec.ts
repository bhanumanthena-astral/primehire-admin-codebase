import { test, expect, type Page, type Locator } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('Enter Email / Phone No').fill('admin@example.com');
  await page.getByPlaceholder('Passcode').fill('Browser-test-only-2026!');
  await page.getByRole('button', {name: 'Sign in', exact: true}).click();
  await page.getByRole('button', {name: /Jobs/}).first().click();
  await expect(page.getByRole('article', {name: 'Viewer Assigned Engineer'})).toBeVisible();
}

async function expectViewportModal(page: Page, dialog: Locator) {
  await expect(dialog).toBeVisible();
  await expect.poll(async () => dialog.evaluate(el => {
    const r = el.getBoundingClientRect();
    return Math.max(Math.abs(r.x + r.width / 2 - innerWidth / 2),
      Math.abs(r.y + r.height / 2 - innerHeight / 2));
  })).toBeLessThan(2);
  expect(await dialog.evaluate(el => Boolean(el.closest('#root, article')))).toBe(false);
  const backdrop = page.locator('[data-modal-backdrop]');
  await expect(backdrop).toBeVisible();
  expect(await backdrop.evaluate(el => {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return r.x === 0 && r.y === 0 && r.width === innerWidth && r.height === innerHeight
      && style.backdropFilter.includes('blur');
  })).toBe(true);
  await expect.poll(async () => dialog.evaluate(el => {
    const r = el.getBoundingClientRect();
    return r.top >= 16 && r.bottom <= innerHeight - 16 && r.left >= 16 && r.right <= innerWidth - 16;
  })).toBe(true);
}

test('card status dialog covers the viewport and remains stable through hover and scroll', async ({page}, testInfo) => {
  await signIn(page);
  const card = page.getByRole('article', {name: 'Viewer Assigned Engineer'});
  await page.screenshot({path: testInfo.outputPath('compact-jobs-desktop.png'), fullPage: true});
  await card.hover();
  const select = card.getByLabel('Change status for Viewer Assigned Engineer');
  await select.focus();
  await select.click();
  await page.getByRole('option', {name: 'On hold', exact: true}).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  const dialog = page.getByRole('dialog', {name: 'Change job status?'});
  await expectViewportModal(page, dialog);
  const original = await dialog.boundingBox();
  const scroll = await page.evaluate(() => window.scrollY);
  await page.mouse.move(5, 5);
  await page.mouse.wheel(0, 600);
  await expectViewportModal(page, dialog);
  await expect.poll(async () => JSON.stringify(await dialog.boundingBox())).toBe(JSON.stringify(original));
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
  await dialog.getByRole('button', {name: 'Cancel', exact: true}).focus();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  await page.screenshot({path: testInfo.outputPath('status-dialog-desktop.png')});
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(select).toBeFocused();
  await expect(select).toHaveAttribute('value', 'OPEN');

  await page.setViewportSize({width: 390, height: 844});
  await select.click();
  await page.getByRole('option', {name: 'On hold', exact: true}).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expectViewportModal(page, dialog);
  await page.screenshot({path: testInfo.outputPath('status-dialog-mobile.png')});
  await dialog.getByRole('button', {name: 'Cancel', exact: true}).click();
});

test('details access and long edit/invite dialogs are centered and scroll within the viewport', async ({page}, testInfo) => {
  await signIn(page);
  await page.getByRole('article', {name: 'Viewer Assigned Engineer'}).getByRole('button', {name: 'View job', exact: true}).click();
  const accessButton = page.getByRole('button', {name: 'Assignee access', exact: true});
  await accessButton.click();
  const access = page.getByRole('dialog', {name: 'Access for this job'});
  await expectViewportModal(page, access);
  await page.screenshot({path: testInfo.outputPath('job-access-desktop.png')});
  await page.keyboard.press('Escape');
  await expect(accessButton).toBeFocused();
  await page.getByRole('button', {name: 'Edit', exact: true}).click();
  const edit = page.getByRole('dialog', {name: /^Edit ·/});
  await page.setViewportSize({width: 390, height: 600});
  await expectViewportModal(page, edit);
  expect(await edit.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await edit.getByRole('button', {name: 'Cancel', exact: true}).scrollIntoViewIfNeeded();
  await expectViewportModal(page, edit);
  await page.screenshot({path: testInfo.outputPath('edit-dialog-mobile.png')});
  await edit.getByRole('button', {name: 'Cancel', exact: true}).click();
  await page.setViewportSize({width: 1280, height: 720});
  await page.getByRole('button', {name: /Team & Access/}).click();
  await page.getByRole('button', {name: 'Invite Member'}).click();
  const invite = page.getByRole('dialog', {name: 'Invite Team Member'});
  await expectViewportModal(page, invite);
  await page.setViewportSize({width: 390, height: 600});
  await expectViewportModal(page, invite);
  await invite.getByRole('button', {name: 'Cancel', exact: true}).scrollIntoViewIfNeeded();
  await page.screenshot({path: testInfo.outputPath('invite-dialog-mobile.png')});
  await invite.getByRole('button', {name: 'Cancel', exact: true}).click();
  await expect(invite).toHaveCount(0);
});
