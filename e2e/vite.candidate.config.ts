import {mergeConfig} from 'vite';
import path from 'node:path';
import frontendConfig from '../frontend/vite.config';
export default mergeConfig(frontendConfig,{
  cacheDir:path.join(frontendConfig.root as string,'node_modules','.vite-e2e-candidate'),
  server:{hmr:false,watch:null,proxy:{'/api':'http://127.0.0.1:8006'}},
});
