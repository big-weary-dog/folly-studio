// The baked-frames routes (SPEC "HTTP API", "Baked frames"), for whoever may see the look:
//   GET /api/looks/:id/frames[?compress=1|zstd|zlib]   the .fseq (attachment)
//   GET /api/looks/:id/frames/wire                     302 → the manifest; 202 while it is encoded
//   GET /api/looks/:id/frames/:hash/manifest           the manifest (JSON, immutable)
//   GET /api/looks/:id/frames/:hash/:n                 chunk n (immutable; br, else gzip, else plain)

import { promises as fsp } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';

import { HttpError } from './auth.js';
import { framesPath } from './bake.js';
import { FSEQ_CODEC, HAS_ZSTD } from './fseq-codec.js';
import { acceptsEncoding, etagMatches, pickEncoding } from './static.js';

// The URL names the content (its hash), so a copy never goes stale.
export const IMMUTABLE = 'public, max-age=31536000, immutable';
const ID = '([A-Za-z0-9_-]{1,64})';
const HASH = '([0-9a-f]{32})';

/** ?compress= → the codec to write, or null for the plain file. */
function codecFor(v) {
  if (v === null || v === '' || v === '0' || v === 'none') return null;
  if (v === '1' || v === 'true') return FSEQ_CODEC;
  if (v === 'zlib' || (v === 'zstd' && HAS_ZSTD)) return v;
  if (v === 'zstd') throw new HttpError(400, 'This server has no zstd; ask for compress=zlib.');
  throw new HttpError(400, 'compress must be 1, zstd or zlib.');
}

const fileName = (look) => String(look.title || '').replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-')
  .slice(0, 60) || 'look';

/** framesRoutes({ framesDir, cache, visibleLook, STREAMED }) → routes for createApi. */
export function framesRoutes({ framesDir, cache, visibleLook, STREAMED }) {
  const noFrames = () => new HttpError(404, 'This look has no baked frames.');

  /** The look, if `hash` names its current bake. */
  function bakeOf(id, hash, user) {
    const look = visibleLook(id, user);
    if (cache.hashOf(look) !== hash) throw noFrames();
    return look;
  }

  /** 304 when the client has it (nothing is read then), else 200 with load() → { body, headers }. */
  async function sendImmutable(req, res, etag, load) {
    if (etagMatches(req.headers['if-none-match'], etag)) {
      res.writeHead(304, { 'Cache-Control': IMMUTABLE, ETag: etag }).end();
      return STREAMED;
    }
    const { body, headers } = await load();
    res.writeHead(200, { ...headers, 'Content-Length': body.length, 'Cache-Control': IMMUTABLE, ETag: etag }).end(body);
    return STREAMED;
  }

  async function download({ user, req, res, params: [id], query }) {
    const look = visibleLook(id, user);
    const codec = codecFor(query.get('compress'));
    // Replays revalidate (the bake's hash is the ETag), and gzip makes LED frames ~3× smaller.
    const sha = look.bake?.frames?.sha256;
    const etag = sha ? `W/"${String(sha).slice(0, 40)}${codec ? `-${codec}` : ''}"` : null;
    const vary = codec ? {} : { Vary: 'Accept-Encoding' };
    if (etag && etagMatches(req.headers['if-none-match'], etag)) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': 'private, no-cache', ...vary }).end();
      return STREAMED;
    }
    const gzip = !codec && acceptsEncoding(req.headers['accept-encoding'], 'gzip');
    const file = codec ? await cache.fseq(look, codec) : framesPath(framesDir, id);
    const fh = file && await fsp.open(file, 'r').catch(() => null);
    if (!fh) throw noFrames();
    try {
      const { size } = await fh.stat();
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        ...(gzip ? { 'Content-Encoding': 'gzip' } : { 'Content-Length': size }),
        'Content-Disposition': `attachment; filename="${fileName(look)}.fseq"`,
        'Cache-Control': etag ? 'private, no-cache' : 'private, no-store',
        ...(etag ? { ETag: etag } : {}),
        ...vary,
      });
      const body = fh.createReadStream({ autoClose: false });
      if (gzip) await pipeline(body, zlib.createGzip({ level: 4 }), res);
      else await pipeline(body, res);
    } finally {
      await fh.close();
    }
    return STREAMED;
  }

  async function wire({ user, res, params: [id] }) {
    const w = await cache.wire(visibleLook(id, user));
    if (w.state === 'none') throw noFrames();
    if (w.state === 'failed') throw new HttpError(500, 'The baked frames could not be prepared for playback.');
    if (w.state === 'pending') {
      res.setHeader('Retry-After', '2');
      return [202, { pending: true, done: w.done, chunks: w.chunks }];
    }
    res.writeHead(302, { Location: `/api/looks/${id}/frames/${w.hash}/manifest`, 'Cache-Control': 'no-store' }).end();
    return STREAMED;
  }

  async function manifest({ user, req, res, params: [id, hash] }) {
    bakeOf(id, hash, user);
    return sendImmutable(req, res, `W/"${hash}"`, async () => {
      const body = await cache.manifest(hash);
      if (!body) throw new HttpError(404, 'These baked frames are not ready yet.');
      return { body, headers: { 'Content-Type': 'application/json; charset=utf-8' } };
    });
  }

  async function chunk({ user, req, res, params: [id, hash, n] }) {
    bakeOf(id, hash, user);
    res.setHeader('Vary', 'Accept-Encoding');
    // The gzip copy lays its frames out its own way (frames-wire.js): an ETag of its own.
    const encoding = pickEncoding(req.headers['accept-encoding']);
    return sendImmutable(req, res, `W/"${hash}.${n}${encoding === 'gzip' ? '.gz' : ''}"`, async () => {
      const got = await cache.chunk(hash, Number(n), encoding);
      if (!got) throw new HttpError(404, 'No such chunk.');
      const headers = { 'Content-Type': 'application/octet-stream' };
      if (got.encoding) headers['Content-Encoding'] = got.encoding;
      return { body: got.body, headers };
    });
  }

  const route = (path, handler) => ({ method: 'GET', path: new RegExp(`^/api/looks/${ID}/frames${path}$`),
    handler });
  return [route('', download), route('/wire', wire), route(`/${HASH}/manifest`, manifest),
    route(`/${HASH}/(\\d{1,5})`, chunk)];
}
