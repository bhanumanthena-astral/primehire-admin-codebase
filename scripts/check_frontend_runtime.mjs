/** Browser startup regression: root middleware, standalone and e2e share React. */
import assert from 'node:assert/strict';
import {createServer as createHttpServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({channel: 'msedge', headless: true});
try {
  for (const mode of ['middleware', 'standalone', 'e2e']) {
    const middleware = mode === 'middleware';
    const configFile = path.join(root, mode === 'e2e' ? 'e2e/vite.config.ts' : 'frontend/vite.config.ts');
    let vite;
    let http = middleware ? createHttpServer((req, res) => vite.middlewares(req, res)) : undefined;
    vite = await createServer({configFile, server: {middlewareMode: middleware, hmr: middleware ? {server: http} : true, host: '127.0.0.1', port: 0}});
    const page = await browser.newPage();
    try {
      if (middleware) {
        await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
      } else {
        await vite.listen();
        http = vite.httpServer;
      }
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => {if (message.text().includes('Invalid hook call')) errors.push(message.text());});
      // No backend, provider, credentials or live data are used by this check.
      await page.route('**/api/**', route => route.fulfill({status: 401, contentType: 'application/json', body: '{"detail":"Not authenticated"}'}));
      const origin = `http://127.0.0.1:${http.address().port}`;
      await page.goto(`${origin}/login`);
      await page.getByPlaceholder('Enter Email / Phone No').waitFor({state: 'visible'});
      await page.getByRole('button', {name: 'Sign in', exact: true}).waitFor({state: 'visible'});
      await page.reload();
      await page.getByPlaceholder('Enter Email / Phone No').waitFor({state: 'visible'});
      await page.setViewportSize({width: 390, height: 844});
      await page.goto(origin);
      await page.waitForURL('**/login');
      await page.getByPlaceholder('Enter Email / Phone No').waitFor({state: 'visible'});
      assert.deepEqual(errors, [], `${mode}: React startup errors`);
      console.log(`${mode}: login, reload and protected-route redirect passed without hook errors`);
    } finally {
      await page.close();
      if (middleware && http) await new Promise(resolve => http.close(resolve));
      await vite.close();
    }
  }
} finally {
  await browser.close();
}
