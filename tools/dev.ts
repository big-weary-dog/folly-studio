#!/usr/bin/env node
// npm run dev: the Node server (server.ts, as `npm start` runs it: PORT, HOST, STUDIO_*) for /api, and Vite's dev
// server on the sources in public/, with HMR, at http://127.0.0.1:5173/ (DEV_PORT), sending /api to it.
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';

process.env.PORT ||= '8780';
await import('../server.ts');
const vite = await createServer({ configFile: fileURLToPath(new URL('../vite.config.js', import.meta.url)),
  server: { port: Number(process.env.DEV_PORT) || 5173, strictPort: true } });
await vite.listen();
vite.printUrls();
