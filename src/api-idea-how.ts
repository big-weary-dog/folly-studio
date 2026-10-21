// How an idea was made (SPEC-generators "How it was made"), for its owner and admins: what the model was asked, and
// round by round what it thought, saw, changed and checked, from the idea's log while it is kept, else from the
// summary the idea keeps. Anyone else gets 404, as for any idea not theirs. The shared prompt goes to owners by size
// only, errors and dollars to admins only.
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { HowPart, HowRound, Idea, IdeaHow } from '../shared/schemas/api.ts';
import { costOf } from './generate/prices.ts';
import { type IdeaLogs, isStillName, ownerOutcome } from './generate/idea-log.ts';
import { HttpError } from './http.ts';
import type { Auth } from './auth.ts';
import type { Store } from './store.ts';

type Obj = Record<string, unknown>;
type Params = { id: string, name?: string };
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const bytes = (s: string) => Buffer.byteLength(s);
/** About how many tokens a text is: a rough four bytes each, shown as an estimate. */
const part = (name: string, text: string, open: boolean): HowPart => ({ name, bytes: bytes(text),
  tokens: Math.round(bytes(text) / 4), ...(open ? { text } : {}) });
const DOC = /<doc path="([^"]{1,200})">\n?([^]*?)<\/doc>/g;

/** A call's user turn as text: a string (codex), or its first message's text blocks (claude). */
function turnText(turn: unknown) {
  if (typeof turn === 'string') return turn;
  const first = Array.isArray(turn) && isObj(turn[0]) ? turn[0].content : undefined;
  if (typeof first === 'string') return first;
  return (Array.isArray(first) ? first : []).filter((b) => isObj(b) && b.type === 'text')
    .map((b) => String((b as Obj).text ?? '')).join('\n\n');
}

/** The first call's prompt in parts: the system prompt and its catalog (text for admins), the docs, the ask. */
function promptParts(system: string | undefined, turn: string, admin: boolean): HowPart[] {
  const parts: HowPart[] = [];
  if (system) {
    const at = system.indexOf('\n# The library\n'), end = system.indexOf('\n# ', at + 2);
    const catalog = at < 0 ? '' : system.slice(at + 1, end < 0 ? undefined : end);
    parts.push(part('The guide', catalog ? system.replace(catalog, '') : system, admin));
    if (catalog) parts.push(part('The library catalog', catalog, admin));
  }
  for (const [, path, text] of turn.matchAll(DOC)) parts.push(part(path!, text!, true));
  const ask = turn.replace(DOC, '').replace(/^The library docs for this idea[^\n]*\n+/, '').trim();
  if (ask) parts.push(part('Your idea', ask, true));
  return parts;
}

/** A logged round as the viewer sees it: an owner, its outcome plain and no notes. */
function roundFor(r: Obj, admin: boolean, model?: string): HowRound {
  const { n, kind, ms, outcome, tokens, critique, plan, thinking, changes, checks, stills, docs, notes, reason,
    warnings } = r;
  const usd = admin && isObj(tokens) ? costOf(model, tokens) : undefined;
  return { n: Number(n), kind: String(kind), ms: Number(ms),
    ...(outcome ? { outcome: admin ? String(outcome) : ownerOutcome(String(outcome)) } : {}),
    ...(isObj(tokens) ? { tokens: tokens as HowRound['tokens'] } : {}),
    ...(typeof critique === 'string' ? { critique } : {}), ...(typeof plan === 'string' ? { plan } : {}),
    ...(typeof thinking === 'string' ? { thinking } : {}), ...(Array.isArray(changes) ? { changes } : {}),
    ...(isObj(checks) ? { checks: checks as HowRound['checks'] } : {}),
    ...(Array.isArray(stills) ? { stills: stills.filter(isObj).filter((s) => isStillName(String(s.file)))
      .map((s) => ({ file: String(s.file), view: String(s.view ?? ''), at: Number(s.at) || 0 })) }
      : typeof stills === 'number' ? { stills } : {}),
    ...(Array.isArray(docs) ? { docs: docs.map(String) } : {}),
    ...(Array.isArray(warnings) ? { warnings: warnings.map(String) } : {}),
    ...(admin && Array.isArray(notes) ? { notes: notes.map(String) } : {}),
    ...(admin && Array.isArray(reason) ? { reason: reason.map(String) } : {}),
    ...(usd !== undefined ? { usd } : {}) };
}

export function ideaHowRoutes({ store, auth, logs, forOwner }: { store: Pick<Store, 'ideas'>, auth: Auth,
  logs: IdeaLogs, forOwner: (idea: Idea) => Idea }) {
  /** The idea, when the viewer owns it or is an admin; 404 for anyone else. */
  const mine = (req: FastifyRequest) => {
    const idea = store.ideas.get((req.params as Params).id), admin = auth.can(req.user, 'admin');
    if (!idea || (idea.owner !== req.user!.id && !admin)) throw new HttpError(404, 'Idea not found.');
    return { idea, admin };
  };
  return {
    'GET /ideas/:id/how': async (req: FastifyRequest): Promise<IdeaHow> => {
      const { idea, admin } = mine(req), log = await logs.read(idea.id);
      const meta = (log?.idea ?? {}) as Obj, name = typeof meta.name === 'string' ? meta.name : undefined;
      const run = { ...(typeof meta.via === 'string' ? { via: meta.via } : {}),
        ...(typeof meta.effort === 'string' ? { effort: meta.effort } : {}),
        ...(typeof meta.level === 'string' ? { level: meta.level } : {}), ...(admin && name ? { name } : {}) };
      const shown = forOwner(idea);
      if (log && Array.isArray(meta.rounds) && meta.rounds.length) {
        const first = log.calls.find(isObj) as Obj | undefined;
        const system = typeof first?.system === 'string' ? log.system[first.system] : undefined;
        const rounds = meta.rounds.filter(isObj).map((r) => roundFor(r, admin, name));
        const usd = admin ? costOf(name, isObj(meta.tokens) ? meta.tokens : {}) : undefined;
        return { idea: shown, from: 'log', run, prompt: promptParts(system, turnText(first?.turn), admin), rounds,
          ...(usd !== undefined ? { usd } : {}) };
      }
      if (idea.how?.length) {
        return { idea: shown, from: 'idea', run, rounds: idea.how.map((r) => roundFor(r as Obj, admin, name)) };
      }
      return { idea: shown, from: 'none', run, rounds: [] };
    },
    'GET /ideas/:id/how/stills/:name': async (req: FastifyRequest, reply: FastifyReply) => {
      const { idea } = mine(req), { name = '' } = req.params as Params;
      if (!isStillName(name)) throw new HttpError(400, 'Not a still\'s name.');
      const png = await logs.still(idea.id, name);
      if (!png) throw new HttpError(404, 'No such still.');
      return reply.type('image/png').header('cache-control', 'private, no-store').send(png);
    },
  };
}
