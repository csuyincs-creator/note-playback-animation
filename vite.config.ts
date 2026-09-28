import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {createReadStream, existsSync, statSync} from 'node:fs';
import path from 'node:path';

const summerLocalAssets = () => ({
  name: 'summer-local-preview-assets',
  configureServer(server: import('vite').ViteDevServer) {
    const allowed = new Map([
      ['summer.mxl', ['application/vnd.recordare.musicxml', '.mxl']],
      ['summer.mid', ['audio/midi', '.mid']],
      ['generaluser.sf2', ['application/octet-stream', '.sf2']],
    ] as const);
    const root = path.resolve('examples/summer-local');
    server.middlewares.use('/__local_examples/summer', (request, response, next) => {
      const fileName = request.url?.split('?')[0]?.replace(/^\//, '');
      const spec = fileName ? allowed.get(fileName as 'summer.mxl' | 'summer.mid' | 'generaluser.sf2') : undefined;
      const filePath = fileName ? path.join(root, fileName) : '';
      if (request.method !== 'GET' || !spec || !existsSync(filePath) || !statSync(filePath).isFile()) { next(); return; }
      response.setHeader('Content-Type', spec[0]);
      response.setHeader('Content-Length', statSync(filePath).size);
      response.setHeader('Cache-Control', 'no-store');
      createReadStream(filePath).pipe(response);
    });
  },
});

export default defineConfig({plugins: [react(), summerLocalAssets()]});
