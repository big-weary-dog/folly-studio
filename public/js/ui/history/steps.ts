// This session's steps (SPEC-history "Steps"): each edit of the look is a step, named for what it changed. The list
// is linear, like Photoshop's: jumping back greys the later steps, and a new edit drops them. Quick edits to one
// thing (a drag, typing) fold into one step until a pause, a pointer up or a focus change seals it. A save marks its
// step; undoing past it leaves the look unsaved. In the main bundle: undo works with the drawer closed.
import { signal } from '@preact/signals';

import { PLAYS } from '../../../../shared/plays.ts';
import type { Module } from '../../../../shared/schemas/look.ts';
import { humanize } from '../kit.tsx';
import type { Layer } from '../model.ts';
import type { Draft } from '../studio-store.ts';

export type Kind = 'open' | 'add' | 'remove' | 'set' | 'move' | 'code' | 'ai' | 'restore';
/** An AI round's step: the idea, what was asked, by whom, what it changed. */
export type AiStep = { ideaId: string, asked: string, by?: string, changes: string[] };
/** What an edit changed: its name, its kind (the icon), and `key`, the one thing it changed (edits fold by it). */
export type Named = { label: string, kind: Kind, key: string, where?: string };
export type Step = Named & { at: number, look: Draft, saved?: boolean, sealed?: boolean, ai?: AiStep };
export type EditOptions = { step?: string, kind?: Kind, merge?: string, ai?: AiStep };

const MAX_STEPS = 200;
const FOLD_MS = 1500;
/** The fields a step puts back: the look's words and what plays (never its id, owner or sharing). */
export const CONTENT = ['title', 'summary', ...PLAYS] as const;

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
const q = (s?: string) => `“${s || 'Untitled'}”`;
const once = () => `${Date.now()}.${Math.random()}`;   // a key nothing folds into
const firstDiff = (a?: object | null, b?: object | null) => {
  const x = (a ?? {}) as Record<string, unknown>, y = (b ?? {}) as Record<string, unknown>;
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].find((k) => !same(x[k], y[k])) ?? '';
};
const titleOf = (m: Module) => q(m.title || humanize(m.kind));

function moduleChange(lid: string, a: Module, b: Module, where: string): Named {
  const key = `l:${lid}:m:${b.id}`;
  if (a.code !== b.code) return { label: `Edited the code of ${titleOf(b)}`, kind: 'code', key: `${key}:code`, where };
  const p = firstDiff(a.params, b.params);
  if (p) {
    const label = `Set ${humanize(p).toLowerCase()}`;
    return { label, kind: 'set', key: `${key}:p:${p}`, where: `${titleOf(b)} · ${where}` };
  }
  if (a.enabled !== b.enabled) {
    return { label: `${b.enabled === false ? 'Turned off' : 'Turned on'} ${titleOf(b)}`, kind: 'set', key, where };
  }
  return { label: `Changed ${titleOf(b)}`, kind: 'set', key, where };
}

function layerChange(a: Layer, b: Layer): Named {
  const where = q(b.title), key = `l:${b.id}`;
  if (a.title !== b.title) return { label: 'Renamed a layer', kind: 'set', key: `${key}:title`, where };
  const was = new Map(a.modules.map((m) => [m.id, m])), now = new Set(b.modules.map((m) => m.id));
  const added = b.modules.find((m) => !was.has(m.id)), gone = a.modules.find((m) => !now.has(m.id));
  if (added) return { label: `Added ${titleOf(added)}`, kind: 'add', key: once(), where };
  if (gone) return { label: `Deleted ${titleOf(gone)}`, kind: 'remove', key: once(), where };
  if (!same(a.modules.map((m) => m.id), b.modules.map((m) => m.id))) {
    return { label: 'Reordered the chain', kind: 'move', key: `${key}:order`, where };
  }
  const m = b.modules.find((x) => !same(x, was.get(x.id)));
  if (m) return moduleChange(b.id, was.get(m.id)!, m, where);
  const pc = `${Math.round(b.level * 100)}%`;
  if (a.level !== b.level) return { label: `Level ${pc}`, kind: 'set', key: `${key}:level`, where };
  if (a.blend !== b.blend) return { label: `Blend ${b.blend}`, kind: 'set', key: `${key}:blend`, where };
  if (!same(a.clips, b.clips)) return { label: 'Edited the clips', kind: 'set', key: `${key}:clips`, where };
  if (!same(a.groups, b.groups) || !same(a.tags, b.tags)) {
    return { label: 'Changed where it plays', kind: 'set', key: `${key}:groups`, where };
  }
  if (!same(a.soften, b.soften)) return { label: 'Softened', kind: 'set', key: `${key}:soften`, where };
  return { label: 'Changed a layer', kind: 'set', key, where };
}

/** What an edit from `a` to `b` changed, named. */
export function named(a: Draft, b: Draft): Named {
  if (a.title !== b.title) return { label: 'Renamed the look', kind: 'set', key: 'title', where: q(b.title) };
  if (a.summary !== b.summary) return { label: 'Edited the summary', kind: 'set', key: 'summary' };
  if (a.layers !== b.layers) {
    const was = new Map(a.layers.map((l) => [l.id, l])), now = new Set(b.layers.map((l) => l.id));
    const added = b.layers.filter((l) => !was.has(l.id)), gone = a.layers.filter((l) => !now.has(l.id));
    const n = (list: Layer[], verb: string) => (list.length > 1 ? `${verb} ${list.length} layers` : `${verb} a layer`);
    if (added.length && !gone.length) {
      return { label: n(added, 'Added'), kind: 'add', key: once(), where: q(added[0].title) };
    }
    if (gone.length && !added.length) {
      return { label: n(gone, 'Deleted'), kind: 'remove', key: once(), where: q(gone[0].title) };
    }
    if (added.length) return { label: 'Changed the layers', kind: 'set', key: once() };
    const i = b.layers.findIndex((l, j) => a.layers[j]?.id !== l.id);
    if (i >= 0) return { label: 'Moved a layer', kind: 'move', key: once(), where: q(b.layers[i].title) };
    const l = b.layers.find((x) => x !== was.get(x.id) && !same(x, was.get(x.id)));
    if (l) return layerChange(was.get(l.id)!, l);
  }
  if (a.duration !== b.duration) return { label: `Duration ${b.duration} s`, kind: 'set', key: 'duration' };
  if (a.bpm !== b.bpm) return { label: b.bpm ? `Tempo ${b.bpm} bpm` : 'Tempo off', kind: 'set', key: 'bpm' };
  const g = firstDiff(a.globals, b.globals);
  const set = g === 'palette' ? 'Changed the palette' : `Set ${humanize(g).toLowerCase()}`;
  if (g) return { label: set, kind: 'set', key: `g:${g}` };
  if (!same(a.automation, b.automation)) return { label: 'Edited the automation', kind: 'set', key: 'automation' };
  return { label: 'Edited the look', kind: 'set', key: 'look' };
}

/** Whether `b` changes any of the look's content from `a`. */
export const changes = (a: Draft, b: Draft) => CONTENT.some((k) => a[k] !== b[k] && !same(a[k], b[k]));

/** The steps and where the look is among them (`at`). */
export function createSteps() {
  const list = signal<Step[]>([]), at = signal(0);
  let reported = new Set<string>(), dropped: string[] = [];   // AI rounds told undone; dropped, not yet told
  const replace = (i: number, s: Step) => { list.value = list.peek().map((x, j) => (j === i ? s : x)); };
  return {
    list, at,
    /** A fresh list: the look as opened. */
    start(look: Draft) {
      list.value = [{ label: look.id ? 'Opened the look' : 'New look', kind: 'open', key: 'open', at: Date.now(), look,
        saved: !!look.id }];
      at.value = 0;
      reported = new Set();
      dropped = [];
    },
    /** An edit from `before` to `after`: a new step (the greyed ones dropped), or folded into the last one. */
    record(before: Draft, after: Draft, o: EditOptions = {}) {
      const all = list.peek(), i = at.peek(), last = all[i], now = Date.now();
      const n: Named = o.step ? { label: o.step, kind: o.kind ?? 'set', key: o.merge ?? once() } : named(before, after);
      if (o.merge) n.key = o.merge;
      const fold = last && i === all.length - 1 && !last.sealed && !last.saved && !o.ai && last.kind !== 'open'
        && last.key === n.key && now - last.at < FOLD_MS;
      if (fold) { replace(i, { ...last, label: n.label, where: n.where, look: after, at: now }); return; }
      for (const s of all.slice(i + 1)) if (s.ai) dropped.push(s.ai.ideaId);
      const kept = [...all.slice(0, i + 1), { ...n, at: now, look: after, ...(o.ai ? { ai: o.ai } : {}) }];
      list.value = kept.slice(-MAX_STEPS);
      at.value = list.peek().length - 1;
    },
    /** The last step takes no more folded edits (a pointer up, a focus change). */
    seal() {
      const i = list.peek().length - 1, s = list.peek()[i];
      if (s && !s.sealed) replace(i, { ...s, sealed: true });
    },
    /** Step `i` (by default the one now) was saved. */
    saved(i = at.peek()) {
      const s = list.peek()[i];
      if (s && !s.saved) replace(i, { ...s, saved: true, sealed: true });
    },
    /** AI rounds undone (greyed, or dropped) that the server has not been told of, now told. */
    undoneRounds(): string[] {
      const ahead = list.peek().slice(at.peek() + 1).flatMap((s) => (s.ai ? [s.ai.ideaId] : []));
      const fresh = [...new Set([...dropped, ...ahead])].filter((id) => !reported.has(id));
      dropped = [];
      for (const id of fresh) reported.add(id);
      return fresh;
    },
  };
}
export type Steps = ReturnType<typeof createSteps>;
