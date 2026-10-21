// A look's versions (SPEC-history "Versions"): changing what plays keeps what was there as a version, and the look
// carries the number and the making of the version it is now (`look.version`). The last MAX_VERSIONS unnamed versions
// are kept, and every named one (at most MAX_NAMED). The API's edits and the AI's refinements both go through here.
// Versions are their owner's alone: GET /api/looks/:id/versions lists them, GET …/versions/:n has one's content,
// PUT …/versions/:n names one or unnames it.
import type { FastifyRequest } from 'fastify';

import PALETTES from '../public/data/palettes.json' with { type: 'json' };
import { canonical, type PlaysKey, playsOf } from '../shared/plays.ts';
import {
  type Version, type VersionHow, type VersionListed, type VersionMeta, VersionNamePatch,
} from '../shared/schemas/api.ts';
import { HttpError, parse } from './http.ts';
import type { StoredLook as Look } from './store.ts';

export const MAX_VERSIONS = 20;
export const MAX_NAMED = 50;

/** A version as stored: its meta, words and what plays, when it was saved, and the review it had. */
type Stored = Record<string, unknown> & { [K in PlaysKey]?: unknown } & VersionMeta & { savedAt?: string,
  reviewed?: { by: string, flashOverride?: Look['flashOverride'] } };

/** The look's versions, oldest first, each numbered (one kept before numbers were is numbered by its place). */
export const versionsOf = (look: Look): Stored[] => (Array.isArray(look.versions) ? look.versions : [])
  .map((v, i) => (typeof v.n === 'number' ? v as Stored : { ...v, n: i + 1 }));

/** The number of the version the look is now. */
export const currentN = (look: Look) => look.version?.n ?? (versionsOf(look).at(-1)?.n ?? 0) + 1;

/** The look as it is now, as a version: its meta, words and what plays; `bpm` always (null: none). */
function asVersion(look: Look): Stored {
  return { ...look.version, n: currentN(look), title: look.title, summary: look.summary ?? '', ...playsOf(look),
    bpm: look.bpm ?? null, savedAt: look.updatedAt, ...(look.reviewed ? { reviewed: { by: look.reviewedBy ?? '',
      ...(look.flashOverride ? { flashOverride: look.flashOverride } : {}) } } : {}) };
}

/** Versions with the oldest unnamed ones past MAX_VERSIONS dropped. */
function pruned(list: Stored[]) {
  const unnamed = list.filter((v) => !v.name), drop = new Set(unnamed.slice(0, -MAX_VERSIONS));
  return list.filter((v) => !drop.has(v));
}

/** The look's versions with what it is now added. A version kept before `bpm` was lacks it, so it can be told apart. */
export const versionsWith = (look: Look) => pruned([...versionsOf(look), asVersion(look)]);

/** What a change to what plays sets: a version of what was there, the new one's meta, no bake, no review. */
export const revisedFields = (look: Look, made: Omit<VersionMeta, 'n'> = { how: 'auto' }): Partial<Look> => ({
  versions: versionsWith(look), version: { n: currentN(look) + 1, ...made }, bake: undefined, reviewed: false,
  reviewedBy: undefined, flashOverride: undefined });

/** What names version `n` of the look (the one it is now, or a kept one) `name`, or unnames it (`null`). A named
 * version is kept; at most MAX_NAMED are (409). An unnamed one is pruned with the rest at the next save. */
export function nameFields(look: Look, n: number, name: string | null): Partial<Look> {
  const kept = versionsOf(look), now = currentN(look);
  if (n !== now && !kept.some((v) => v.n === n)) throw new HttpError(404, 'No such version.');
  const named = [...kept, { n: now, name: look.version?.name }].filter((v) => v.name && v.n !== n).length;
  if (name && named >= MAX_NAMED) {
    throw new HttpError(409, `A look keeps at most ${MAX_NAMED} named versions: unname one first.`);
  }
  const set = (v: VersionMeta) => {
    const { name: _, ...rest } = v;
    return name ? { ...rest, name } : rest;
  };
  return n === now ? { version: set(look.version ?? { n, how: 'auto' }) }
    : { versions: kept.map((v) => (v.n === n ? set(v) as Stored : v)) };
}

/** How a refinement's version was made: by the AI, for this idea and what it asked. */
export const byAi = (idea: { id: string, text?: string | null }) => ({ how: 'ai' as const, ideaId: idea.id,
  ask: String(idea.text ?? '').slice(0, 200) });

/** The review of a version that plays exactly as `look` does, if one was reviewed. */
export function reviewFor(versions: Stored[], look: Look) {
  const plays = canonical(playsOf(look));
  return versions.findLast((v) => v.reviewed && 'bpm' in v && canonical(playsOf(v)) === plays)?.reviewed;
}

const HOUSE = PALETTES.palettes.find((p) => p.name === 'chapel') ?? PALETTES.palettes[0];
const ROLES = ['low', 'body', 'accent', 'high'] as const;
/** Up to 8 of a version's palette colours, a role at a time (the house default when it has none). */
function colours(globals: unknown) {
  const p = (globals as { palette?: Record<string, unknown> } | null)?.palette;
  const from = p && ROLES.some((r) => Array.isArray(p[r]) && p[r].length) ? p : HOUSE;
  const lists = ROLES.map((r) => (Array.isArray(from[r]) ? from[r] as string[] : []));
  const out: string[] = [];
  for (let i = 0; out.length < 8 && lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length && out.length < 8) out.push(l[i]);
  }
  return out;
}

/** A version as the list shows it; old versions without a tempo read the look's. */
function listed(v: Stored, look: Look, current: boolean): VersionListed {
  const has = 'bpm' in v, bpm = has ? v.bpm as number | null : look.bpm ?? null;
  return { n: v.n, how: (v.how ?? 'auto') as VersionHow, ...(v.name ? { name: v.name } : {}),
    ...(v.from ? { from: v.from } : {}), ...(v.ideaId ? { ideaId: v.ideaId } : {}), ...(v.ask ? { ask: v.ask } : {}),
    savedAt: String(v.savedAt ?? ''), title: String(v.title ?? ''),
    layerCount: Array.isArray(v.layers) ? v.layers.length : 0, duration: playsOf(v).duration as number, bpm,
    ...(has ? {} : { tempoGuessed: true }), reviewed: !!v.reviewed,
    ...(current ? { current: true, shared: look.shared === true } : {}), palette: colours(v.globals) };
}

/** The routes: a look's versions, newest first (the look as saved is the first), and one with its content. */
export function versionRoutes({ visibleLook, update }: {
  visibleLook: (id: string, user: { id: string, username: string }) => Look,
  update: (id: string, patch: Partial<Look>) => Look }) {
  type Req = FastifyRequest<{ Params: { id: string, n?: string } }>;
  const mine = (req: Req) => {
    const look = visibleLook(req.params.id, req.user!);
    if (look.owner !== req.user!.id) throw new HttpError(403, "A look's versions are its owner's alone.");
    return look;
  };
  const all = (look: Look) => [...versionsOf(look), asVersion(look)].reverse();
  async function list(req: Req) {
    const look = mine(req), now = currentN(look);
    return { versions: all(look).map((v) => listed(v, look, v.n === now)) };
  }
  async function one(req: Req): Promise<{ version: Version }> {
    const look = mine(req), n = Number(req.params.n), v = all(look).find((x) => x.n === n);
    if (!v) throw new HttpError(404, 'No such version.');
    const { layers, globals, automation } = playsOf(v) as Partial<Version>;
    return { version: { ...listed(v, look, n === currentN(look)), summary: String(v.summary ?? ''),
      layers: layers ?? [], globals: globals ?? null, automation: automation ?? null } };
  }
  async function name(req: Req) {
    const look = mine(req), n = Number(req.params.n), { name: to } = parse(VersionNamePatch, req.body);
    const after = update(look.id, nameFields(look, n, to));
    return { version: listed(all(after).find((v) => v.n === n)!, after, n === currentN(after)) };
  }
  return { 'GET /looks/:id/versions': list, 'GET /looks/:id/versions/:n': one, 'PUT /looks/:id/versions/:n': name };
}
