// The looks routes of the HTTP API (SPEC "HTTP API"): list, create, read, edit (with versions and
// review), delete and bake. Who may see a look: its owner, or anyone signed in when it is shared.

import { DEFAULT_DURATION } from '../public/js/pattern-core.js';
import { HttpError } from './auth.js';
import { reviewBlocker } from './bake.js';
import { BakeError } from './box-output.js';
import {
  bad, cleanAutomation, cleanBool, cleanBpm, cleanDuration, cleanGlobals, cleanSummary, cleanTitle, validateLayers,
} from './look-rules.js';

export const MAX_VERSIONS = 20;
export const MAX_LOOKS_PER_USER = 500;
export const GALLERY_LIMIT = 200;
const ID = '([A-Za-z0-9_-]{1,64})';

export const newestBy = (field) => (a, b) => {
  const x = a[field] ?? a.createdAt ?? '';
  const y = b[field] ?? b.createdAt ?? '';
  return x < y ? 1 : x > y ? -1 : 0;
};

/** lookRoutes({ store, auth, bakes, dropFrames }) → { routes, visibleLook } */
export function lookRoutes({ store, auth, bakes, dropFrames }) {
  const ownerName = (id) => store.users.get(id)?.username ?? '';

  function presentLook(look, { versions = false } = {}) {
    const { versions: list, ...rest } = look;
    return {
      ...rest, ownerName: ownerName(look.owner) || look.ownerName || '', summary: rest.summary ?? '',
      layers: rest.layers ?? [], duration: rest.duration ?? DEFAULT_DURATION, shared: rest.shared === true,
      reviewed: rest.reviewed === true, versionCount: Array.isArray(list) ? list.length : 0,
      ...(versions ? { versions: Array.isArray(list) ? list : [] } : {}),
    };
  }

  /** A look as lists show it: what a card needs, no layers or code (GET /api/looks/:id has those). */
  function listed(look) {
    const out = { id: look.id, owner: look.owner, ownerName: ownerName(look.owner) || look.ownerName || '',
      title: look.title, summary: look.summary ?? '', duration: look.duration ?? DEFAULT_DURATION,
      layerCount: Array.isArray(look.layers) ? look.layers.length : 0, shared: look.shared === true,
      reviewed: look.reviewed === true, createdAt: look.createdAt, updatedAt: look.updatedAt };
    for (const k of ['bpm', 'sharedAt', 'ideaId']) if (look[k] != null) out[k] = look[k];
    return out;
  }

  function visibleLook(id, user) {
    const look = store.looks.get(id);
    if (!look || (look.owner !== user.id && look.shared !== true)) throw new HttpError(404, 'Look not found.');
    return look;
  }

  function list({ user, query }) {
    const scope = query.get('scope') || 'mine';
    let looks;
    if (scope === 'mine') looks = store.looks.list((l) => l.owner === user.id).reverse().sort(newestBy('updatedAt'));
    else if (scope === 'gallery') {
      looks = store.looks.list((l) => l.shared === true).reverse().sort(newestBy('sharedAt')).slice(0, GALLERY_LIMIT);
    } else bad('scope must be mine or gallery.');
    return { looks: looks.map(listed) };
  }

  function create({ user, body }) {
    const look = { owner: user.id, ownerName: user.username, title: cleanTitle(body.title, { required: true }),
      summary: cleanSummary(body.summary), layers: validateLayers(body.layers) };
    if (body.duration !== undefined) look.duration = cleanDuration(body.duration);
    const globals = body.globals === undefined ? undefined : cleanGlobals(body.globals);
    if (globals) look.globals = globals;
    const automation = body.automation === undefined ? undefined : cleanAutomation(body.automation, globals);
    if (automation) look.automation = automation;
    const bpm = body.bpm === undefined ? undefined : cleanBpm(body.bpm);
    if (bpm !== undefined) look.bpm = bpm;
    look.shared = body.shared === undefined ? false : cleanBool(body.shared, 'shared');
    if (look.shared) look.sharedAt = new Date().toISOString();
    Object.assign(look, { reviewed: false, versions: [] });
    if (body.ideaId !== undefined && body.ideaId !== null) {
      const idea = typeof body.ideaId === 'string' ? store.ideas.get(body.ideaId) : null;
      if (!idea || idea.owner !== user.id) bad('ideaId does not name one of your ideas.');
      look.ideaId = idea.id;
    }
    if (store.looks.list((l) => l.owner === user.id).length >= MAX_LOOKS_PER_USER) {
      throw new HttpError(429, `You have ${MAX_LOOKS_PER_USER} looks; delete some first.`);
    }
    return [201, { look: presentLook(store.looks.create(look)) }];
  }

  async function edit({ user, params: [id], body, query }) {
    const look = visibleLook(id, user);
    const isOwner = look.owner === user.id;
    const isCurator = auth.isCurator(user);
    const patch = {};
    if (body.title !== undefined) patch.title = cleanTitle(body.title, { required: false });
    if (body.summary !== undefined) patch.summary = cleanSummary(body.summary);
    if (body.shared !== undefined) {
      patch.shared = cleanBool(body.shared, 'shared');
      if (patch.shared && look.shared !== true) patch.sharedAt = new Date().toISOString();
    }
    if (body.bpm !== undefined && cleanBpm(body.bpm) !== look.bpm) patch.bpm = cleanBpm(body.bpm);
    // What plays: the layers and how long the look runs. A change is a new version.
    if (body.layers !== undefined) {
      const layers = validateLayers(body.layers);
      if (JSON.stringify(layers) !== JSON.stringify(look.layers ?? [])) patch.layers = layers;
    }
    if (body.duration !== undefined) {
      const duration = cleanDuration(body.duration);
      if (duration !== (look.duration ?? DEFAULT_DURATION)) patch.duration = duration;
    }
    // The globals and their automation play too (null clears them).
    const globals = body.globals === undefined ? look.globals : cleanGlobals(body.globals);
    if (body.globals !== undefined && JSON.stringify(globals) !== JSON.stringify(look.globals)) patch.globals = globals;
    if (body.automation !== undefined || 'globals' in patch) {
      const automation = cleanAutomation(body.automation === undefined ? look.automation ?? null : body.automation,
        globals);
      if (JSON.stringify(automation) !== JSON.stringify(look.automation)) patch.automation = automation;
    }
    const layersChanged = 'layers' in patch || 'duration' in patch || 'globals' in patch || 'automation' in patch;
    if (layersChanged) {
      const prev = { title: look.title, summary: look.summary ?? '', layers: look.layers ?? [],
        duration: look.duration ?? DEFAULT_DURATION, ...(look.globals ? { globals: look.globals } : {}),
        ...(look.automation ? { automation: look.automation } : {}), savedAt: look.updatedAt };
      patch.versions = [...(Array.isArray(look.versions) ? look.versions : []), prev].slice(-MAX_VERSIONS);
    }
    const unset = { summary: '', shared: false };
    const changes = ['title', 'summary', 'shared', 'bpm']
      .filter((k) => k in patch && patch[k] !== (look[k] ?? unset[k]));
    // Only the owner edits; a curator may also set `reviewed` on a look shared with them.
    if (!isOwner && (changes.length || layersChanged || !isCurator)) {
      throw new HttpError(403, 'Only the owner can edit this look.');
    }
    if (layersChanged && look.bake) patch.bake = undefined; // its frames show the old code
    if (body.reviewed !== undefined) {
      const reviewed = cleanBool(body.reviewed, 'reviewed');
      if (reviewed !== (look.reviewed === true)) {
        if (!isCurator) throw new HttpError(403, 'Only curators can mark a look reviewed.');
        const blocker = reviewed && (layersChanged ? 'The code changed. Bake it again first.' : reviewBlocker(look));
        if (blocker) throw new HttpError(409, blocker);
        patch.reviewed = reviewed;
        patch.reviewedBy = reviewed ? user.username : undefined;
      }
    } else if (layersChanged && look.reviewed === true) {
      patch.reviewed = false; // new code needs a fresh review
      patch.reviewedBy = undefined;
    }
    const updated = Object.keys(patch).length ? store.looks.update(id, patch) : look;
    if ('bake' in patch) await dropFrames(id);
    return { look: presentLook(updated, { versions: query.get('versions') === '1' && isOwner }) };
  }

  async function remove({ user, params: [id] }) {
    if (visibleLook(id, user).owner !== user.id) throw new HttpError(403, 'Only the owner can delete this look.');
    store.looks.remove(id);
    await dropFrames(id);
    return { ok: true };
  }

  async function bake({ user, params: [id] }) {
    const look = visibleLook(id, user);
    if (look.owner !== user.id && !auth.isCurator(user)) {
      throw new HttpError(403, 'Only the owner or a curator can bake this look.');
    }
    try {
      return [202, { bake: await bakes.request(id) }];
    } catch (err) {
      if (err instanceof BakeError) throw new HttpError(err.status || 503, err.reason);
      throw err;
    }
  }

  function read({ user, params: [id], query }) {
    const look = visibleLook(id, user);
    return { look: presentLook(look, { versions: query.get('versions') === '1' && look.owner === user.id }) };
  }

  const route = (method, path, handler) => ({ method, path: new RegExp(`^/api/looks${path}$`), handler });
  return { visibleLook, routes: [route('GET', '', list), route('POST', '', create), route('GET', `/${ID}`, read),
    route('PUT', `/${ID}`, edit), route('DELETE', `/${ID}`, remove), route('POST', `/${ID}/bake`, bake)] };
}
