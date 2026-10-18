// The build's text files precompressed for @fastify/static (`preCompressed`, src/static.ts): <file>.br (quality 11)
// and <file>.gz (level 9) beside each file of 512 bytes or more, where smaller. Made once per build, so the server
// never compresses a static file per request.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

const TEXT = /\.(?:html|m?js|css|json|svg|txt)$/;
const Z = zlib.constants;
const ENCODE = {
  '.br': (body) => promisify(zlib.brotliCompress)(body, { params: { [Z.BROTLI_PARAM_QUALITY]: 11,
    [Z.BROTLI_PARAM_MODE]: Z.BROTLI_MODE_TEXT, [Z.BROTLI_PARAM_SIZE_HINT]: body.length } }),
  '.gz': (body) => promisify(zlib.gzip)(body, { level: 9 }),
};

/** Precompress the files a build writes (dotfiles, such as .vite/manifest.json, are never served, so skipped). */
export function precompress() {
  return {
    name: 'folly-precompress',
    apply: 'build',
    async writeBundle({ dir }, bundle) {
      const files = Object.keys(bundle).filter((f) => TEXT.test(f) && !f.startsWith('.'));
      await Promise.all(files.map(async (f) => {
        const body = await readFile(path.join(dir, f));
        if (body.length < 512) return;
        await Promise.all(Object.entries(ENCODE).map(async ([ext, encode]) => {
          const packed = await encode(body);
          if (packed.length < body.length) await writeFile(path.join(dir, f + ext), packed);
        }));
      }));
    },
  };
}
