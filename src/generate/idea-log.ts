// What happened inside each idea or refinement (SPEC-generators "The idea log"), on disk in <dataDir>/ideas-log/<id>/:
// `idea.json` (the request, level, model and effort; each round's kind, times, tokens, docs read, outcome and
// expand's notes; the outcome), rewritten as each round ends, so a run cut short still leaves its trail; `calls.jsonl`,
// one line per model call (its user turn, reply, tool calls and usage), the system prompt kept once per idea by hash
// (`system-<hash>.txt`); `stills/`, the PNGs the model was shown. Only the newest `keep` ideas within `maxBytes` stay.
// Tokens and the rounds' summary are counted in memory too, for the idea itself, when there is no disk log.

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { IdeaOutcome } from '../../shared/idea-status.ts';
import { monoNow } from '../clock.ts';
import type { Logger } from '../http.ts';
import { howOf, THINKING_MAX, thinkingOf } from './explain.ts';

export type Usage = { input: number, cached: number, output: number, reasoning: number };
/** One model call as an adapter saw it: its prompt (the system prompt goes by hash), its reply and its tool calls. */
export type Call = { ms: number, system?: string, turn: unknown, images?: number, reply?: unknown, tools?: unknown[],
  usage?: Partial<Usage>, docs?: string[], error?: string };
/** `think`: thinking as it streams in, shown live and kept only until the call that holds it is recorded. */
export type Round = { kind: string, call(c: Call): void, still(png: Uint8Array, about: Record<string, unknown>): void,
  end(r?: { outcome?: string, notes?: string[], [more: string]: unknown }): void, think?(text: string): void };
/** The round running now, for the idea's live view: thinking so far, the latest last when it runs long. */
type LiveRound = { n: number, kind: string, ms: number, thinking?: string };
export type Outcome = { status: IdeaOutcome, error?: string, detail?: string, lookId?: string };
export type IdeaLog = ReturnType<typeof createIdeaLog>;

const ID = /^[\w-]{1,64}$/, STILL = /^\d{1,3}-[a-z]{1,16}-\d{1,2}\.png$/;
/** Whether `name` is a still's file name as the log writes it (no separators, no dots but the extension's). */
export const isStillName = (name: string) => STILL.test(name);
const zero = (): Usage => ({ input: 0, cached: 0, output: 0, reasoning: 0 });
const add = (a: Usage, b?: Partial<Usage>) => {
  for (const k of ['input', 'cached', 'output', 'reasoning'] as const) a[k] += Math.max(0, Number(b?.[k]) || 0);
};
export const hashOf = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** A round that records nothing (no idea log). */
export const NO_ROUND: Round = { kind: '', call() {}, still() {}, end() {} };

/** One idea's log; `dir`: its folder, none to count in memory only. */
export function createIdeaLog(o: { dir?: string, meta: Record<string, unknown>, log?: Logger }) {
  const meta: Record<string, unknown> = { ...o.meta, startedAt: new Date().toISOString() };
  const rounds: Record<string, unknown>[] = [], tokens = zero(), systems = new Set<string>();
  let all = 0; // calls made
  // A second attempt (a run cut short, queued again) keeps the first's record and numbers its rounds from 101.
  let chain = Promise.resolve(), n = Number(o.meta.attempt) > 1 ? 100 : 0;
  const running = new Map<number, () => LiveRound>();
  const write = (fn: (dir: string) => Promise<unknown>) => {
    if (!o.dir) return;
    const dir = o.dir;
    chain = chain.then(() => fn(dir)).then(() => {}, (err) => {
      o.log?.warn?.(`[generate] idea log ${path.basename(dir)}: ${(err as Error)?.message || err}`);
    });
  };
  const save = () => write(async (dir) => {
    await fs.writeFile(path.join(dir, 'idea.json.tmp'), JSON.stringify({ ...meta, tokens, rounds }, null, 1));
    await fs.rename(path.join(dir, 'idea.json.tmp'), path.join(dir, 'idea.json'));
  });
  write(async (dir) => {
    await fs.mkdir(path.join(dir, 'stills'), { recursive: true });
    const before = await fs.readFile(path.join(dir, 'idea.json'), 'utf8').then(JSON.parse, () => null);
    if (n && before) meta.earlier = [...before.earlier ?? [], { ...before, earlier: undefined }];
  });
  save();

  return {
    /** Adds to what the log says of the idea (the effort a level raised it to, …). */
    note(more: Record<string, unknown>) { Object.assign(meta, more); save(); },
    /** A round begins: its calls and stills are recorded under it until end(). */
    begin(kind: string): Round {
      const i = ++n, start = monoNow(), used = zero(), docs: string[] = [], stills: Record<string, unknown>[] = [];
      let calls = 0, ended = false, thinking = '', streaming = '';
      running.set(i, () => {
        const said = `${thinking}${streaming}`.trim();
        return { n: i, kind, ms: monoNow() - start, ...(said ? { thinking: said.slice(-THINKING_MAX) } : {}) };
      });
      return {
        kind,
        think(text) { streaming = `${streaming}${text}`.slice(-THINKING_MAX); },
        call(c) {
          calls++;
          all++;
          add(used, c.usage);
          add(tokens, c.usage);
          docs.push(...c.docs ?? []);
          const thought = thinkingOf(c);
          if (thought) thinking = `${thinking && `${thinking}\n\n`}${thought}`.slice(0, THINKING_MAX);
          streaming = '';
          const { system, ...rest } = c;
          const sys = system === undefined ? undefined : hashOf(system);
          if (system !== undefined && sys && !systems.has(sys)) {
            systems.add(sys);
            write((dir) => fs.writeFile(path.join(dir, `system-${sys}.txt`), system));
          }
          const line = `${JSON.stringify({ round: i, kind, at: new Date().toISOString(), system: sys, ...rest })}\n`;
          write((dir) => fs.appendFile(path.join(dir, 'calls.jsonl'), line));
        },
        still(png, about) {
          const file = `${i}-${kind.replace(/[^a-z]/g, '').slice(0, 16) || 'round'}-${stills.length + 1}.png`;
          if (stills.length >= 99) return;
          stills.push({ file, ...about });
          write((dir) => fs.writeFile(path.join(dir, 'stills', file), png));
        },
        end({ outcome, notes, ...more } = {}) {
          if (ended) return;
          ended = true;
          running.delete(i);
          rounds.push({ n: i, kind, start: new Date(start).toISOString(), end: new Date().toISOString(),
            ms: monoNow() - start, calls, tokens: used, ...(docs.length ? { docs } : {}),
            ...(outcome ? { outcome } : {}), ...(thinking ? { thinking } : {}), ...more,
            ...(notes?.length ? { notes } : {}),
            ...(stills.length ? { stills } : {}) });
          save();
        },
      };
    },
    /** The round running now (the latest, when takes run side by side) and how many have ended; null when the
     * idea has ended. */
    live() {
      if (meta.endedAt) return null;
      const now = [...running.values()].at(-1)?.();
      return { rounds: rounds.length, ...(now ? { round: now } : {}) };
    },
    /** Adds to the last round ended (the render check that followed it). */
    amend(more: Record<string, unknown>) {
      if (!rounds.length) return;
      Object.assign(rounds.at(-1)!, more);
      save();
    },
    /** The idea ended (or was cut): its outcome. Resolves once everything is written. */
    finish(outcome: Outcome) {
      meta.outcome = outcome;
      meta.endedAt = new Date().toISOString();
      save();
      return chain;
    },
    /** For the idea itself: the tokens (none when no call was recorded); each round as `{ kind, ms, outcome }`, a
     * failure's outcome plain (ownerOutcome); and `how` it was made (explain.ts howOf), outcomes as plain. */
    summary() {
      const { input, cached, output } = tokens, plain = (r: Record<string, unknown>) => (r.outcome
        ? { ...r, outcome: ownerOutcome(String(r.outcome)) } : r);
      return { tokens: all ? { input, cached, output } : undefined, rounds: rounds.map((r) => ({ kind: String(r.kind),
        ms: Number(r.ms), ...(r.outcome ? { outcome: ownerOutcome(String(r.outcome)).slice(0, 80) } : {}) })),
      how: howOf(rounds.map(plain)) };
    },
  };
}

/** An outcome (or a critique's outcomes, joined) as the idea's owner sees it: "failed" without its error, which can
 * carry a provider's or a CLI's text and stays in the admin's log. An error may hold ", " itself, so everything
 * after the first "failed: " goes: an older idea's verdict loses the outcomes after it, never leaks. New verdicts
 * are joined from plain outcomes (rounds.ts), so they keep all of theirs. */
export const ownerOutcome = (outcome: string) => outcome.replace(/\bfailed: .*$/s, 'failed');

/** The ideas' logs under `dir`: open one, read one back (admins), keep only the newest. `keep` 0: none written. */
export function createIdeaLogs({ dir, keep = 300, maxBytes = 500 * 2 ** 20, log }: { dir: string, keep?: number,
  maxBytes?: number, log?: Logger }) {
  let pruning: Promise<void> | null = null;
  const folder = (id: string) => (ID.test(id) ? path.join(dir, id) : null);

  /** Folders past the newest `keep`, or past `maxBytes` in all, removed: the oldest go first. */
  async function prune(open = new Set<string>()) {
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    const all = await Promise.all(names.filter((d) => ID.test(d)).map(async (d) => {
      const at = path.join(dir, d), files = await walk(at);
      const stats = await Promise.all(files.map((f) => fs.stat(f).catch(() => null)));
      return { d, at, bytes: stats.reduce((s, st) => s + (st?.size ?? 0), 0),
        mtime: Math.max(0, ...stats.map((st) => st?.mtimeMs ?? 0)) };
    }));
    all.sort((a, b) => b.mtime - a.mtime);
    let total = 0, count = 0;
    for (const f of all) {
      total += f.bytes;
      if (open.has(f.d) || (++count <= keep && total <= maxBytes)) continue;
      await fs.rm(f.at, { recursive: true, force: true }).catch(() => {});
    }
  }

  const open = new Set<string>(), running = new Map<string, IdeaLog>();
  return {
    dir, keep, maxBytes,
    /** A new log for idea `id` (one already there, from a run cut short, is added to). */
    open(id: string, meta: Record<string, unknown>) {
      const at = keep > 0 ? folder(id) : null;
      if (at) {
        open.add(id);
        pruning ??= prune(open).finally(() => { pruning = null; });
      }
      const l = createIdeaLog({ dir: at ?? undefined, meta: { id, ...meta }, log });
      running.set(id, l);
      return { ...l, finish: (outcome: Outcome) => {
        if (running.get(id) === l) running.delete(id);
        return l.finish(outcome).finally(() => open.delete(id));
      } };
    },
    /** What idea `id`'s run is doing now (IdeaLog.live); null when it is not running here. */
    live(id: string) {
      return running.get(id)?.live() ?? null;
    },
    /** An idea's log as the admin route answers it; null when there is none. */
    async read(id: string) {
      const at = folder(id);
      const idea = at && await fs.readFile(path.join(at, 'idea.json'), 'utf8').then(JSON.parse, () => null);
      if (!at || !idea) return null;
      const lines = await fs.readFile(path.join(at, 'calls.jsonl'), 'utf8').catch(() => '');
      const calls = lines.split('\n').filter(Boolean).map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      });
      const files = await fs.readdir(at).catch(() => [] as string[]);
      const system = Object.fromEntries(await Promise.all(files.filter((f) => /^system-[0-9a-f]{16}\.txt$/.test(f))
        .map(async (f) => [f.slice(7, -4), await fs.readFile(path.join(at, f), 'utf8')])));
      return { idea, calls: calls.filter(Boolean), system,
        stills: (await fs.readdir(path.join(at, 'stills')).catch(() => [] as string[])).filter(isStillName).sort() };
    },
    /** A still's PNG bytes, by a name as the log wrote it; null when there is none. */
    async still(id: string, name: string) {
      const at = folder(id);
      if (!at || !isStillName(name)) return null;
      return fs.readFile(path.join(at, 'stills', name)).catch(() => null);
    },
    prune: () => prune(open),
  };
}
export type IdeaLogs = ReturnType<typeof createIdeaLogs>;

/** Every file under `at` (two levels: the log and its stills). */
async function walk(at: string): Promise<string[]> {
  const entries = await fs.readdir(at, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries) {
    if (e.isFile()) out.push(path.join(at, e.name));
    else if (e.isDirectory()) {
      const inner = await fs.readdir(path.join(at, e.name)).catch(() => [] as string[]);
      out.push(...inner.map((f) => path.join(at, e.name, f)));
    }
  }
  return out;
}
