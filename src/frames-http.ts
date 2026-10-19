// The baked-frames routes (SPEC "HTTP API", "Baked frames"), for whoever may see the look:
//   GET /api/looks/:id/frames[?compress=1|zstd|zlib]   the .fseq (attachment), streamed
//   GET /api/looks/:id/frames/wire                     302 → the manifest; 202 while it is encoded
//   GET /api/looks/:id/frames/:hash/manifest           the manifest (JSON, immutable)
//   GET /api/looks/:id/frames/:hash/:n                 chunk n (immutable; br, else gzip, else plain)
import { promises as fsp } from 'node:fs';
import { pipeline } from 'node:stream';
import zlib from 'node:zlib';

import type { FastifyReply, FastifyRequest } from 'fastify';

import type { lookRoutes } from './api-looks.ts';
import { framesPath } from './bake.ts';
import type { createFramesCache } from './frames-cache.ts';
import { FSEQ_CODEC, HAS_ZSTD } from './fseq-codec.ts';
import { etagMatches, HttpError, pickEncoding } from './http.ts';
import { CACHE_IMMUTABLE as IMMUTABLE } from './static.ts';

export { IMMUTABLE };
const HASH = /^[0-9a-f]{32}$/;
type Req = FastifyRequest<{ Params: { id: string, hash: string, n: string }, Querystring: { compress?: string } }>;

/** ?compress= → the codec to write, or null for the plain file. */
function codecFor(v: string | undefined) {
  if (v === undefined || v === '' || v === '0' || v === 'none') return null;
  if (v === '1' || v === 'true') return FSEQ_CODEC;
  if (v === 'zlib' || (v === 'zstd' && HAS_ZSTD)) return v;
  if (v === 'zstd') throw new HttpError(400, 'This server has no zstd; ask for compress=zlib.');
  throw new HttpError(400, 'compress must be 1, zstd or zlib.');
}

const fileName = (look: { title?: string }) => String(look.title || '').replace(/[^A-Za-z0-9 _-]+/g, '').trim()
  .replace(/\s+/g, '-').slice(0, 60) || 'look';

/** The frames routes, for the API's table. */
export function framesRoutes({ framesDir, cache, visibleLook }: { framesDir: string,
  cache: ReturnType<typeof createFramesCache>, visibleLook: ReturnType<typeof lookRoutes>['visibleLook'] }) {
  const noFrames = () => new HttpError(404, 'This look has no baked frames.');
  // Frames evicted for the disk cap are baked again (src/frames-cache.ts): ask again in a while.
  const rebaking = () => new HttpError(503, 'These frames are being baked again. Try again in a minute.',
    { 'Retry-After': '30' });

  /** The look, if `hash` names its current bake. */
  function bakeOf({ params: { id, hash }, user }: Req) {
    const look = visibleLook(id, user!);
    if (!HASH.test(hash) || cache.hashOf(look) !== hash) throw noFrames();
    cache.touch(look);
    return look;
  }

  /** 304 when the client has it (nothing is read then), else 200 with load() → { body, type, encoding? }. */
  async function immutable(req: Req, reply: FastifyReply, etag: string,
    load: () => Promise<{ body: Buffer, type: string, encoding?: string | null }>) {
    const headers = { 'cache-control': IMMUTABLE, etag };
    if (etagMatches(req.headers['if-none-match'], etag)) return reply.headers(headers).code(304).send();
    const { body, type, encoding } = await load();
    return reply.headers({ ...headers, ...(encoding ? { 'content-encoding': encoding } : {}) }).type(type).send(body);
  }

  async function download(req: Req, reply: FastifyReply) {
    const look = visibleLook(req.params.id, req.user!);
    const codec = codecFor(req.query.compress);
    // Replays revalidate (the bake's hash is the ETag), and gzip makes LED frames ~3× smaller.
    const sha = look.bake?.frames?.sha256;
    const etag = sha ? `W/"${String(sha).slice(0, 40)}${codec ? `-${codec}` : ''}"` : null;
    const headers = { 'cache-control': etag ? 'private, no-cache' : 'private, no-store', ...(etag ? { etag } : {}),
      ...(codec ? {} : { vary: 'Accept-Encoding' }) };
    if (etag && etagMatches(req.headers['if-none-match'], etag)) return reply.headers(headers).code(304).send();
    const file = codec ? await cache.fseq(look, codec) : framesPath(framesDir, req.params.id);
    const fh = file && await fsp.open(file, 'r').catch(() => null);
    if (!fh) throw (await cache.restore(look)) ? rebaking() : noFrames();
    cache.touch(look);
    reply.headers({ ...headers, 'content-disposition': `attachment; filename="${fileName(look)}.fseq"` })
      .type('application/octet-stream');
    if (codec || !pickEncoding(req.headers['accept-encoding'], ['gzip'])) {
      return reply.header('content-length', (await fh.stat()).size).send(fh.createReadStream());
    }
    reply.header('content-encoding', 'gzip');
    return reply.send(pipeline(fh.createReadStream(), zlib.createGzip({ level: 4 }), () => {}));
  }

  async function wire(req: Req, reply: FastifyReply) {
    const w = await cache.wire(visibleLook(req.params.id, req.user!));
    if (w.state === 'none') throw noFrames();
    if (w.state === 'failed') throw new HttpError(500, 'The baked frames could not be prepared for playback.');
    if (w.state === 'pending') {
      reply.code(202).header('retry-after', '2');
      return { pending: true, done: w.done, chunks: w.chunks };
    }
    return reply.header('cache-control', 'no-store').redirect(`/api/looks/${req.params.id}/frames/${w.hash}/manifest`);
  }

  async function manifest(req: Req, reply: FastifyReply) {
    const { hash } = req.params;
    bakeOf(req);
    return immutable(req, reply, `W/"${hash}"`, async () => {
      const body = await cache.manifest(hash);
      if (!body) throw new HttpError(404, 'These baked frames are not ready yet.');
      return { body, type: 'application/json; charset=utf-8' };
    });
  }

  async function chunk(req: Req, reply: FastifyReply) {
    const { hash, n } = req.params;
    bakeOf(req);
    reply.header('vary', 'Accept-Encoding');
    // The gzip copy lays its frames out its own way (frames-wire.js): an ETag of its own.
    const encoding = pickEncoding(req.headers['accept-encoding']);
    return immutable(req, reply, `W/"${hash}.${n}${encoding === 'gzip' ? '.gz' : ''}"`, async () => {
      const got = /^\d{1,5}$/.test(n) && await cache.chunk(hash, Number(n), encoding);
      if (!got) throw new HttpError(404, 'No such chunk.');
      return { body: got.body, type: 'application/octet-stream', encoding: got.encoding };
    });
  }

  const at = (path: string) => `GET /looks/:id/frames${path}`;
  return { [at('')]: download, [at('/wire')]: wire, [at('/:hash/manifest')]: manifest, [at('/:hash/:n')]: chunk };
}
