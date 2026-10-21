// The looks routes of the HTTP API (SPEC "HTTP API"): list, create, read, edit (with versions and review), delete,
// bake and the gallery preview (SPEC "Gallery previews"). Who may see a look: its owner, or anyone signed in when it
// is shared. Bodies are checked by the shared schemas (shared/schemas/api.ts, look.ts); chains from before the one
// rule are converted (shared/chain-order.ts).
import { promises as fs } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { DEFAULT_DURATION } from '../public/js/pattern-core.ts';
import { CHAIN, convertLayers, upgradeLook } from '../shared/chain-order.ts';
import { keepStandardTitles } from '../shared/standard-modules.ts';
import { type Listed, LookCreate, LookPatch, LooksQuery } from '../shared/schemas/api.ts';
import {
  automationFor, dropRemaps, type Globals, type Layer, Layers, playsChanged,
} from '../shared/schemas/look.ts';
import type { LibraryEntry } from '../shared/schemas/rig.ts';
import { newestBy } from './api.ts';
import type { Action } from '../shared/policy.ts';
import type { Auth } from './auth.ts';
import { type createBakeQueue, layersHash, renderFields, reviewBlocker } from './bake.ts';
import { BakeError } from './box-output.ts';
import { etagMatches, HttpError, type Logger, parse } from './http.ts';
import { currentN, nameFields, reviewFor, revisedFields, versionRoutes, versionsOf } from './look-versions.ts';
import type { createPreviews } from './previews/index.ts';
import { CACHE_IMMUTABLE } from './static.ts';
import type { Store, StoredLook as Look, StoredUser as User } from './store.ts';

export const MAX_LOOKS_PER_USER = 500;
export const GALLERY_LIMIT = 200;

type Req = FastifyRequest<{ Params: { id: string } }>;

/** A look's layers as the API stores them (a 400 naming the first problem). */
export const validateLayers = (layers: unknown) => parse(z.object({ layers: Layers }), { layers }).layers;

/** A body's layers and summary as the one rule reads them: converted when it has no `chain: 2`, noted where inexact. */
function ruled(body: { layers: Layer[], summary?: string, chain?: number }) {
  if (body.chain === CHAIN) return { layers: body.layers, summary: body.summary };
  const { look } = upgradeLook({ layers: body.layers, summary: body.summary ?? '', chain: body.chain });
  return { layers: validateLayers(look.layers), summary: look.summary };
}

/** A stored look without layer role remaps (dropRemaps), its versions too; itself when it had none. */
function withoutRemaps(look: Look): Look {
  const layers = Array.isArray(look.layers) ? dropRemaps(look.layers) : look.layers;
  const versions = look.versions?.map((v) => (Array.isArray(v.layers) && dropRemaps(v.layers) !== v.layers
    ? { ...v, layers: dropRemaps(v.layers) } : v));
  const changed = layers !== look.layers || versions?.some((v, i) => v !== look.versions![i]);
  return changed ? { ...look, layers, ...(versions ? { versions } : {}) } : look;
}

/**
 * A stored look at start: role remaps dropped; from before the one rule, its layers and versions converted, marked. A
 * bake keeps its place when the conversion is exact (same frames); otherwise the look needs a fresh bake and review.
 */
export function upgradeStored(stored: Look): Look {
  const look = withoutRemaps(stored);
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

export function lookRoutes({ store, auth, bakes, dropFrames, previews, loadLibrary = () => [], log = console }: {
  store: Store, auth: Auth, bakes: ReturnType<typeof createBakeQueue>, dropFrames: (id: string) => Promise<unknown>,
  previews?: Pick<ReturnType<typeof createPreviews>, 'want' | 'keyOf' | 'file'>,
  loadLibrary?: () => readonly LibraryEntry[], log?: Logger }) {
  const ownerName = (id: string) => store.users.get(id)?.username ?? '';
  /** A body's layers as the one rule reads them, each standard module named as the library names it. */
  const ruledNamed = (body: Parameters<typeof ruled>[0]) => {
    const out = ruled(body), library = loadLibrary();
    return { ...out, layers: out.layers.map((l) => ('modules' in l
      ? { ...l, modules: keepStandardTitles(l.modules, library) } : l)) };
  };

  /** A look as GET answers: `mine` adds the number of its version, `versions` the versions themselves. */
  function presentLook(look: Look, { versions = false, mine = false } = {}) {
    const { versions: list, version: _, ...rest } = look;
    return {
      ...rest, ownerName: ownerName(look.owner) || look.ownerName || '', summary: rest.summary ?? '',
      layers: rest.layers ?? [], duration: rest.duration ?? DEFAULT_DURATION, shared: rest.shared === true,
      reviewed: rest.reviewed === true, versionCount: Array.isArray(list) ? list.length : 0,
      ...(mine ? { version: currentN(look) } : {}), ...(versions ? { versions: Array.isArray(list) ? list : [] } : {}),
    };
  }

  /** A look as lists show it: what a card needs, no layers or code (GET /api/looks/:id has those). A shared look
   * whose preview is missing or stale is queued for one. */
  function listed(look: Look): Listed {
    if (look.shared === true) previews?.want(look.id);
    const preview = previews?.keyOf(look.id);
    return { id: look.id, owner: look.owner, ownerName: ownerName(look.owner) || look.ownerName || '',
      title: look.title, summary: look.summary ?? '', duration: look.duration ?? DEFAULT_DURATION,
      layerCount: Array.isArray(look.layers) ? look.layers.length : 0, shared: look.shared === true,
      reviewed: look.reviewed === true, createdAt: look.createdAt, updatedAt: look.updatedAt,
      ...Object.fromEntries((['bpm', 'sharedAt', 'ideaId'] as const).filter((k) => look[k] != null)
        .map((k) => [k, look[k]])), ...(preview ? { preview } : {}) };
  }

  /** The look, when `user` may `action` it (shared/policy.ts); else 404, so a look not theirs is never revealed. */
  function visibleLook(id: string, user: User, action: Action = 'see'): Look {
    const look = store.looks.get(id);
    if (!look || !auth.can(user, action, look)) throw new HttpError(404, 'Look not found.');
    return look;
  }
  const versionsFor = (req: FastifyRequest, look: Look) => (req.query as { versions?: string }).versions === '1'
    && auth.can(req.user, 'edit', look);

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
    const look: Partial<Look> = { owner: user.id, ownerName: user.username, ...body, ...ruledNamed(body), chain: CHAIN,
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
    const made = store.looks.create(look);
    previews?.want(made.id);
    return { look: presentLook(made, { mine: true }) };
  }

  async function edit(req: Req) {
    const { id } = req.params;
    const user = req.user!;
    const look = visibleLook(id, user);
    const isOwner = auth.can(user, 'edit', look);
    const body = parse(LookPatch, req.body);
    const patch: Partial<Look> = {};
    const changed = <K extends keyof Look>(k: K, v: Look[K], was = look[k]) => {
      if (!isDeepStrictEqual(v, was)) patch[k] = v;
    };
    if (body.title !== undefined) patch.title = body.title;
    if (body.summary !== undefined) patch.summary = body.summary;
    if (body.layers !== undefined) {
      const now = ruledNamed({ ...body, layers: body.layers, summary: body.summary ?? look.summary });
      body.layers = now.layers;
      if (now.summary !== (body.summary ?? look.summary)) patch.summary = now.summary;
    }
    if (body.shared !== undefined) {
      patch.shared = body.shared;
      if (body.shared && look.shared !== true) patch.sharedAt = new Date().toISOString();
    }
    // What plays (PLAYS; null clears bpm, globals and automation). A change is a new version; one that changes the
    // frames (not a tempo that is only a grid) also drops the bake and the review.
    if (body.bpm !== undefined) changed('bpm', body.bpm ?? undefined);
    if (body.layers !== undefined) changed('layers', body.layers, look.layers ?? []);
    if (body.duration !== undefined) changed('duration', body.duration, look.duration ?? DEFAULT_DURATION);
    if (body.globals !== undefined) changed('globals', body.globals ?? undefined);
    const globals = 'globals' in patch ? patch.globals : look.globals;
    if (body.automation !== undefined || 'globals' in patch) {
      changed('automation', lanes(body.automation === undefined ? look.automation ?? null : body.automation, globals));
    }
    const after = { ...look, ...patch };
    const frames = (l: Look) => `${l.duration ?? DEFAULT_DURATION}:${layersHash(renderFields(l))}`;
    const versioned = playsChanged(look, after);
    const layersChanged = versioned && frames(look) !== frames(after);
    const from = body.restoredFrom;
    if (from !== undefined && !isOwner) throw new HttpError(404, 'Look not found.');
    if (from !== undefined && !versionsOf(look).some((v) => v.n === from)) {
      throw new HttpError(400, `restoredFrom: the look has no version ${from}.`);
    }
    if (versioned) Object.assign(patch, revisedFields(look, from ? { how: 'restore', from } : { how: 'auto' }));
    if (body.versionName !== undefined) {   // "Save a named version…": names the version the look is now
      if (!isOwner) throw new HttpError(404, 'Look not found.');
      const next = { ...look, ...patch };
      Object.assign(patch, nameFields(next, currentN(next), body.versionName));
    }
    for (const k of ['bake', 'reviewed', 'reviewedBy', 'flashOverride'] as const) {
      if (!layersChanged) delete patch[k];   // set below as the change asks
    }
    const unset: Partial<Look> = { summary: '', shared: false };
    const changes = (['title', 'summary', 'shared', 'bpm'] as const)
      .filter((k) => k in patch && patch[k] !== (look[k] ?? unset[k]));
    // Only the owner edits; a curator may also set `reviewed` on a look shared with them.
    if (!isOwner && (changes.length || versioned || !auth.can(user, 'review', look))) {
      throw new HttpError(404, 'Look not found.');
    }
    if (body.flashOverride !== undefined && body.reviewed !== true) {
      throw new HttpError(400, 'flashOverride goes with reviewed: true.');
    }
    if (body.reviewed !== undefined && body.reviewed !== (look.reviewed === true)) {
      if (!auth.can(user, 'review', look)) throw new HttpError(403, 'Only curators can mark a look reviewed.');
      const override = body.flashOverride ?? '';
      const blocker = body.reviewed && (layersChanged ? 'The code changed. Bake it again first.'
        : reviewBlocker(look, { override }));
      if (blocker) throw new HttpError(409, blocker);
      Object.assign(patch, { reviewed: body.reviewed, reviewedBy: body.reviewed ? user.username : undefined,
        flashOverride: undefined });
      // Approving frames that fail the flash check: the curator's reason stays on the look, and in the log.
      if (body.reviewed && override && look.bake?.analysis?.flicker?.ok === false && !look.bake.ok) {
        patch.flashOverride = { reason: override, by: user.username, at: new Date().toISOString() };
        log.info?.(`[review] look ${id}: ${user.username} approved its flashing frames: ${JSON.stringify(override)}`);
      }
    }
    // New code needs a fresh review, unless it plays exactly as a version a curator reviewed (a restore, an undo).
    const kept = body.reviewed === undefined && layersChanged
      ? reviewFor(versionsOf({ ...look, ...patch }), after) : undefined;
    if (kept) {
      Object.assign(patch, { reviewed: true, reviewedBy: kept.by || undefined, flashOverride: kept.flashOverride });
    }
    const updated = Object.keys(patch).length ? store.looks.update(id, patch)! : look;
    if ('bake' in patch) await dropFrames(id);
    if (kept) await bakes.request(id).catch(() => {});   // its frames again (the same render: often a stored bake)
    previews?.want(id);
    return { look: presentLook(updated, { versions: versionsFor(req, look), mine: isOwner }) };
  }

  async function remove(req: Req) {
    visibleLook(req.params.id, req.user!, 'edit');
    store.looks.remove(req.params.id);
    await dropFrames(req.params.id);
    return { ok: true };
  }

  async function bake(req: Req, reply: FastifyReply) {
    visibleLook(req.params.id, req.user!, 'bake');
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
    return { look: presentLook(look, { versions: versionsFor(req, look),
      mine: look.owner === req.user!.id }) };
  }

  /** The look's gallery preview (`<key>.webp`) or its still (`<key>-still.webp`), immutable. */
  async function preview(req: FastifyRequest<{ Params: { id: string, name: string } }>, reply: FastifyReply) {
    const { id, name } = req.params;
    visibleLook(id, req.user!);
    const file = previews?.file(id, name);
    const body = file && await fs.readFile(file).catch(() => null);
    if (!body) throw new HttpError(404, 'No such preview.');
    const headers = { 'cache-control': CACHE_IMMUTABLE.replace('public', 'private'), etag: `"${name}"` };
    if (etagMatches(req.headers['if-none-match'], headers.etag)) return reply.headers(headers).code(304).send();
    return reply.headers(headers).type('image/webp').send(body);
  }

  return { visibleLook, listed, routes: { 'GET /looks': list, 'POST /looks': create, 'GET /looks/:id': read,
    'PUT /looks/:id': edit, 'DELETE /looks/:id': remove, 'POST /looks/:id/bake': bake,
    'GET /looks/:id/preview/:name': preview,
    ...versionRoutes({ visibleLook, update: (id, p) => store.looks.update(id, p)! }) } };
}
