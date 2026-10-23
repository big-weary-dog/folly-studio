// The Pi bundle's download (SPEC-offline "Downloading the Pi bundle"): the one file STUDIO_PI_BUNDLE names, made by
// `npm run host`, for curators and admins, or for anyone holding a link one of them minted (1 hour, in memory).
// Nothing in a request names a path; a token is only looked up, and never logged (stats log the route, not the URL).
import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { FastifyReply, FastifyRequest } from 'fastify';

import { HttpError } from './http.ts';

export const LINK_MS = 60 * 60 * 1000;
export const MAX_LINKS = 20;
const NAME = /^folly-studio-pi-([0-9a-f]{12})\.tar$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;   // 32 random bytes, base64url

/** The routes, for a routes() table; `file` is STUDIO_PI_BUNDLE (none: no bundle). */
export function piBundleRoutes({ file, now = Date.now }: { file?: string, now?: () => number }) {
  const links: { token: Buffer, expires: number }[] = [];
  const bundle = async () => {
    const commit = file && NAME.exec(path.basename(file))?.[1];
    const stat = commit ? await fs.promises.stat(file).catch(() => null) : null;
    if (!commit || !stat?.isFile()) throw new HttpError(404, 'This server has no Pi bundle.');
    return { file: file!, commit, bytes: stat.size, builtAt: stat.mtime.toISOString() };
  };
  const send = async (_req: FastifyRequest, reply: FastifyReply) => {
    const b = await bundle();
    // Gone since the check: a 404 too, never an error that would log the request's URL.
    const fh = await fs.promises.open(b.file)
      .catch(() => { throw new HttpError(404, 'This server has no Pi bundle.'); });
    return reply.headers({ 'content-type': 'application/x-tar', 'content-length': (await fh.stat()).size,
      'content-disposition': `attachment; filename="${path.basename(b.file)}"`, 'cache-control': 'private, no-store' })
      .send(fh.createReadStream());
  };
  const live = () => {
    while (links.length && links[0]!.expires <= now()) links.shift();
    return links;
  };
  const curators = { role: 'curator' } as const;
  return {
    'GET /pi-bundle/info': [async () => {
      const { commit, bytes, builtAt } = await bundle();
      return { commit, bytes, builtAt };
    }, curators],
    'GET /pi-bundle': [send, curators],
    'POST /pi-bundle/link': [async () => {
      await bundle();
      const token = randomBytes(32), expires = now() + LINK_MS;
      live().push({ token, expires });
      if (links.length > MAX_LINKS) links.shift();
      return { path: `/api/pi-bundle/${token.toString('base64url')}`, expires: new Date(expires).toISOString() };
    }, curators],
    'GET /pi-bundle/:token': [async (req: FastifyRequest, reply: FastifyReply) => {
      const given = (req.params as { token: string }).token;
      const asked = TOKEN.test(given) ? Buffer.from(given, 'base64url') : null;
      // Every live link is compared, each in constant time, so the answer's timing says nothing of a near miss.
      const held = live().reduce((ok, l) => (asked?.length === l.token.length && timingSafeEqual(asked, l.token))
        || ok, false);
      if (!held || asked?.toString('base64url') !== given) {
        throw new HttpError(404, 'That link is unknown or has expired.');
      }
      return send(req, reply);
    }, { public: true }],
  } as const;
}
