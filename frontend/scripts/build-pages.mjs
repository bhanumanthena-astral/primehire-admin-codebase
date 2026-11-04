import {copyFile,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../',import.meta.url));
const output = path.join(root,'dist');
await copyFile(path.join(root,'cloudflare/worker.js'),path.join(output,'_worker.js'));
// Static assets and SPA routes stay on Pages' static service, outside Function quotas.
await writeFile(path.join(output,'_routes.json'),JSON.stringify({version:1,include:['/api','/api/*'],exclude:[]},null,2)+'\n');
await writeFile(path.join(output,'_headers'),`/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'
/index.html
  Cache-Control: no-cache
/\n  Cache-Control: no-cache\n`);
const html = await readFile(path.join(output,'index.html'),'utf8');
if (!html.includes('/assets/')) throw new Error('Frontend assets were not built.');
console.log('Frontend-only Pages output ready: dist/ (assets + API gateway).');
