// Vite builds public/ (the app shell, its modules and styles, the data it fetches and the sandbox page) into dist/
// with content-hashed names under assets/, which src/static.ts serves. `npm run dev` (tools/dev.ts) serves public/
// with HMR (Preact's, through @preact/preset-vite) and sends /api to the Node server on PORT.
import { fileURLToPath } from 'node:url';

import { preact } from '@preact/preset-vite';
import { defineConfig } from 'vite';

import { precompress } from './tools/vite-compress.ts';
import { sandboxPage } from './tools/vite-sandbox.ts';

export default defineConfig({
  root: fileURLToPath(new URL('./public', import.meta.url)),
  publicDir: false, // public/ is the source root here, not a folder copied as it is
  plugins: [preact(), sandboxPage(), precompress()], // .tsx: JSX for Preact (Oxc), and its HMR in dev
  // The browser's Host header goes through unchanged: the API checks a mutation's Origin against it.
  server: { host: '127.0.0.1', proxy: { '/api': { target: `http://127.0.0.1:${process.env.PORT || 8780}` } } },
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    manifest: true,
    assetsInlineLimit: 0, // data and the sandbox stay files of their own (connect-src and frame-src are 'self')
    modulePreload: { polyfill: false }, // browsers have modulepreload; nothing runs that the CSP would not allow
  },
});
