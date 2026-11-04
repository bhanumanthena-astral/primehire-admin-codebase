/** Remove only known generated outputs; credentials, uploads and dependencies are retained. */
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {lstat,realpath,readdir,rm} from 'node:fs/promises';

const root=await realpath(fileURLToPath(new URL('../',import.meta.url)));
const cacheOnly=process.argv.includes('--cache-only');
const names=['.tmp','test-results','playwright-report','coverage','frontend/coverage',
  '.coverage','backend/.coverage','.pytest_cache','backend/.pytest_cache',
  'jobs-audit-check.json','jobs-backend-check.txt','jobs-browser-check.txt',
  'jobs-build-check.txt','jobs-final-regression.txt','jobs-frontend-check.txt',
  // Obsolete frontend files left behind by the old root build. The server now serves frontend/dist.
  'dist/assets','dist/index.html'];
if(!cacheOnly)names.push('dist','frontend/dist');
async function findBytecode(relative){
  const folder=path.join(root,relative);
  for(const entry of await readdir(folder,{withFileTypes:true}).catch(()=>[])){
    if(!entry.isDirectory()||entry.isSymbolicLink())continue;
    const name=path.join(relative,entry.name);
    if(entry.name==='__pycache__')names.push(name);else await findBytecode(name);
  }
}
for(const name of ['backend/app','backend/migrations','backend/tests','backend/deploy','scripts'])await findBytecode(name);
const removed=[];
for(const name of [...new Set(names)]){
  const target=path.resolve(root,name);
  if(!target.startsWith(root+path.sep))throw new Error('Cleanup target escaped the workspace');
  const info=await lstat(target).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(!info)continue;
  if(info.isSymbolicLink()||!(await realpath(target)).startsWith(root+path.sep))throw new Error('Refusing a linked cleanup target');
  await rm(target,{recursive:true,force:true,maxRetries:2});
  removed.push(name.replaceAll('\\','/'));
}
console.log(JSON.stringify({mode:cacheOnly?'cache-only':'all-generated',removed},null,2));
