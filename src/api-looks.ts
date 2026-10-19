// The looks routes of the HTTP API (SPEC "HTTP API"): list, create, read, edit (with versions and review), delete
// and bake. Who may see a look: its owner, or anyone signed in when it is shared. Bodies are checked by the shared
// schemas (shared/schemas/api.ts, look.ts); chains from before the one rule are converted (shared/chain-order.ts).
import { isDeepStrictEqual } from 'node:util';

import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { DEFAULT_DURATION } from '../public/js/pattern-core.ts';
import { CHAIN, convertLayers, upgradeLook } from '../shared/chain-order.ts';
import { type Listed, LookCreate, LookPatch, LooksQuery } from '../shared/schemas/api.ts';
import { automationFor, type Globals, type Layer, Layers } from '../shared/schemas/look.ts';
import { newestBy } from './api.ts';
import type { Auth } from './auth.ts';
import { type createBakeQueue, layersHash, renderFields, reviewBlocker } from './bake.ts';
import { BakeError } from './box-output.ts';
import { HttpError, parse } from './http.ts';
import type { Store, StoredLook as Look } from './store.ts';

export const MAX_VERSIONS = 20;
export const MAX_LOOKS_PER_USER = 500;
export const GALLERY_LIMIT = 200;

type User = { id: string, username: string };
type Req = FastifyRequest<{ Params: { id: string } }>;

/** A look's layers as the API stores them (a 400 naming the first problem). */
export const validateLayers = (layers: unknown) => parse(z.object({ layers: Layers }), { layers }).layers;

/** A body's layers and summary as the one rule reads them: converted when it has no `chain: 2`, noted where inexact. */
function ruled(body: { layers: Layer[], summary?: string, chain?: number }) {
  if (body.chain === CHAIN) return { layers: body.layers, summary: body.summary };
  const { look } = upgradeLook({ layers: body.layers, summary: body.summary ?? '', chain: body.chain });
  return { layers: validateLayers(look.layers), summary: look.summary };
}

/**
 * A stored look from before the one rule, at start: its layers and versions converted, marked. A bake keeps its
 * place when the conversion is exact (same frames); otherwise the look needs a fresh bake and review.
 */
export function upgradeStored(look: Look): Look {
  if (look.chain === CHAIN) return look;
  const { look: up, exact } = upgradeLook(look);
  const versions = look.versions?.map((v) => (Array.isArray(v.layers)
    ? { ...v, layers: convertLayers(v.layers as Layer[]).layers } : v));
  const out: Look = { ...up, ...(versions ? { versions } : {}) };
  if (!exact) {
    delete out.reviewedBy;
    return { ...out, reviewed: false };
  }
  if (look.bake?.layersHash === layersHash(renderFields(look))) {
    out.bake = { ...look.bake, layersHash: layersHash(renderFields(up)) };
  }
  return out;
}
/** A look's automation against its globals (a 400 naming the lane when one does not fit). */
const lanes = (automation: unknown, globals: Globals | null | undefined) =>
  parse(z.object({ automation: automationFor(globals) }), { automation }).automation ?? undefined;

export function lookRoutes({ store, auth, bakes, dropFrames }: { store: Store, auth: Auth,
  bakes: ReturnType<typeof createBakeQueue>, dropFrames: (id: string) => Promise<unknown> }) {
  const ownerName = (id: string) => store.users.get(id)?.username ?? '';

  function presentLook(look: Look, { versions = false } = {}) {
    const { versions: list, ...rest } = look;
    return {
      ...rest, ownerName: ownerName(look.owner) || look.ownerName || '', summary: rest.summary ?? '',
      layers: rest.layers ?? [], duration: rest.duration ?? DEFAULT_DURATION, shared: rest.shared === true,
      reviewed: rest.reviewed === true, versionCount: Array.isArray(list) ? list.length : 0,
      ...(versions ? { versions: Array.isArray(list) ? list : [] } : {}),
    };
  }

  /** A look as lists show it: what a card needs, no layers or code (GET /api/looks/:id has those). */
  function listed(look: Look): Listed {
    return { id: look.id, owner: look.owner, ownerName: ownerName(look.owner) || look.ownerName || '',
      title: look.title, summary: look.summary ?? '', duration: look.duration ?? DEFAULT_DURATION,
      layerCount: Array.isArray(look.layers) ? look.layers.length : 0, shared: look.shared === true,
      reviewed: look.reviewed === true, createdAt: look.createdAt, updatedAt: look.updatedAt,
      ...Object.fromEntries((['bpm', 'sharedAt', 'ideaId'] as const).filter((k) => look[k] != null)
        .map((k) => [k, look[k]])) };
  }

  function visibleLook(id: string, user: User): Look {
    const look = store.looks.get(id);
    if (!look || (look.owner !== user.id && look.shared !== true)) throw new HttpError(404, 'Look not found.');
    return look;
  }
  const versionsFor = (req: FastifyRequest, look: Look) => (req.query as { versions?: string }).versions === '1'
    && look.owner === req.user!.id;

  async function list(req: FastifyRequest) {
    const { scope } = parse(LooksQuery, req.query);
    const looks = scope === 'mine'
      ? store.looks.list((l) => l.owner === req.user!.id).reverse().sort(newestBy('updatedAt'))
      : store.looks.list((l) => l.shared === true).reverse().sort(newestBy('sharedAt')).slice(0, GALLERY_LIMIT);
    return { looks: looks.map(listed) };
  }

  async function create(req: FastifyRequest, reply: FastifyReply) {
    const { automation, ideaId, globals, bpm, ...body } = parse(LookCreate, req.body);
    const user = req.user!;
    const look: Partial<Look> = { owner: user.id, ownerName: user.username, ...body, ...ruled(body), chain: CHAIN,
      reviewed: false, versions: [] };
    if (globals) look.globals = globals;
    const lanesNow = automation === undefined ? undefined : lanes(automation, globals);
    if (lanesNow) look.automation = lanesNow;
    if (bpm != null) look.bpm = bpm;
    if (look.shared) look.sharedAt = new Date().toISOString();
    if (ideaId != null) {
      const idea = store.ideas.get(ideaId);
      if (!idea || idea.owner !== user.id) throw new HttpError(400, 'ideaId does not name one of your ideas.');
      look.ideaId = idea.id;
    }
    if (store.looks.list((l) => l.owner === user.id).length >= MAX_LOOKS_PER_USER) {
      throw new HttpError(429, `You have ${MAX_LOOKS_PER_USER} looks; delete some first.`);
    }
    reply.code(201);
    return { look: presentLook(store.looks.create(look)) };
  }

  async function edit(req: Req) {
    const { id } = req.params;
    const user = req.user!;
    const look = visibleLook(id, user);
    const isOwner = look.owner === user.id;
    const isCurator = auth.isCurator(user);
    const body = parse(LookPatch, req.body);
    const patch: Partial<Look> = {};
    const changed = <K extends keyof Look>(k: K, v: Look[K], was = look[k]) => {
      if (!isDeepStrictEqual(v, was)) patch[k] = v;
    };
    if (body.title !== undefined) patch.title = body.title;
    if (body.summary !== undefined) patch.summary = body.summary;
    if (body.layers !== undefined) {
      const now = ruled({ ...body, layers: body.layers, summary: body.summary ?? look.summary });
      body.layers = now.layers;
      if (now.summary !== (body.summary ?? look.summary)) patch.summary = now.summary;
    }
    if (body.shared !== undefined) {
      patch.shared = body.shared;
      if (body.shared && look.shared !== true) patch.sharedAt = new Date().toISOString();
    }
    if (body.bpm !== undefined) changed('bpm', body.bpm ?? undefined);
    // What plays: the layers, how long the look runs, its globals and their automation (null clears those two).
    // A change is a new version.
    if (body.layers !== undefined) changed('layers', body.layers, look.layers ?? []);
    if (body.duration !== undefined) changed('duration', body.duration, look.duration ?? DEFAULT_DURATION);
    if (body.globals !== undefined) changed('globals', body.globals ?? undefined);
    const globals = 'globals' in patch ? patch.globals : look.globals;
    if (body.automation !== undefined || 'globals' in patch) {
      changed('automation', lanes(body.automation === undefined ? look.automation ?? null : body.automation, globals));
    }
    const layersChanged = ['layers', 'duration', 'globals', 'automation'].some((k) => k in patch);
    if (layersChanged) {
      const prev = { title: look.title, summary: look.summary ?? '', layers: look.layers ?? [],
        duration: look.duration ?? DEFAULT_DURATION, ...(look.globals ? { globals: look.globals } : {}),
        ...(look.automation ? { automation: look.automation } : {}), savedAt: look.updatedAt };
      patch.versions = [...(Array.isArray(look.versions) ? look.versions : []), prev].slice(-MAX_VERSIONS);
    }
    const unset: Partial<Look> = { summary: '', shared: false };
    const changes = (['title', 'summary', 'shared', 'bpm'] as const)
      .filter((k) => k in patch && patch[k] !== (look[k] ?? unset[k]));
    // Only the owner edits; a curator may also set `reviewed` on a look shared with them.
    if (!isOwner && (changes.length || layersChanged || !isCurator)) {
      throw new HttpError(403, 'Only the owner can edit this look.');
    }
    if (layersChanged && look.bake) patch.bake = undefined; // its frames show the old code
    if (body.reviewed !== undefined && body.reviewed !== (look.reviewed === true)) {
      if (!isCurator) throw new HttpError(403, 'Only curators can mark a look reviewed.');
      const blocker = body.reviewed && (layersChanged ? 'The code changed. Bake it again first.' : reviewBlocker(look));
      if (blocker) throw new HttpError(409, blocker);
      Object.assign(patch, { reviewed: body.reviewed, reviewedBy: body.reviewed ? user.username : undefined });
    } else if (body.reviewed === undefined && layersChanged && look.reviewed === true) {
      Object.assign(patch, { reviewed: false, reviewedBy: undefined }); // new code needs a fresh review
    }
    const updated = Object.keys(patch).length ? store.looks.update(id, patch)! : look;
    if ('bake' in patch) await dropFrames(id);
    return { look: presentLook(updated, { versions: versionsFor(req, look) }) };
  }

  async function remove(req: Req) {
    if (visibleLook(req.params.id, req.user!).owner !== req.user!.id) {
      throw new HttpError(403, 'Only the owner can delete this look.');
    }
    store.looks.remove(req.params.id);
    await dropFrames(req.params.id);
    return { ok: true };
  }

  async function bake(req: Req, reply: FastifyReply) {
    const look = visibleLook(req.params.id, req.user!);
    if (look.owner !== req.user!.id && !auth.isCurator(req.user!)) {
      throw new HttpError(403, 'Only the owner or a curator can bake this look.');
    }
    try {
      const queued = await bakes.request(req.params.id);
      reply.code(202);
      return { bake: queued };
    } catch (err) {
      if (err instanceof BakeError) throw new HttpError((err as { status?: number }).status || 503, err.reason);
      throw err;
    }
  }

  async function read(req: Req) {
    const look = visibleLook(req.params.id, req.user!);
    return { look: presentLook(look, { versions: versionsFor(req, look) }) };
  }

  return { visibleLook, routes: { 'GET /looks': list, 'POST /looks': create, 'GET /looks/:id': read,
    'PUT /looks/:id': edit, 'DELETE /looks/:id': remove, 'POST /looks/:id/bake': bake } };
}
