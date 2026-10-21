// The Studio's state as signals: the look being edited (replaced, never mutated, on each edit), what the server last
// sent, the selection, mute and solo, the panels' layout, and what is derived from them (dirty, the selected layer
// and module, what the sandbox runs). Edits go through edit*(); save() and setShared() talk to the server.
import { batch, computed, signal } from '@preact/signals';

import { api } from '../api.ts';
import { extrasOf, PLAYS, type PlaysKey } from '../../../shared/plays.ts';
import type { Automation, Globals, Module } from '../../../shared/schemas/look.ts';
import type { Look, LookPatch, User, Version } from '../../../shared/schemas/api.ts';
import type { LibraryEntry, ModuleEntry, Rig } from '../../../shared/schemas/rig.ts';
import { keepStandardTitles } from '../../../shared/standard-modules.ts';
import { replaceUrl, setTitle } from './session.ts';
import { pref, reducedMotion, toast } from './kit.tsx';
import { type AiStep, changes, CONTENT, createSteps, type EditOptions, type Step } from './history/steps.ts';
import { createLayerStatus } from './layer-status.ts';
import {
  buildGroupIndex, cleanLayer, type GroupIndex, type Layer, layerFromPattern, newLayer, normaliseLayers,
} from './model.ts';
import { cleanBpm, cleanDuration } from './timeline-model.ts';

/** The look as edited: what saves (saveBody), and where it came from. */
export interface Draft { id: string | null; title: string; summary: string; layers: Layer[]; duration: number;
  bpm: number | null; globals?: Globals | null; automation?: Automation | null; shared: boolean; ideaId: string | null;
  owner?: string; ownerName?: string }
export const TABS = ['layers', 'code', 'time', 'look', 'more'] as const;
export type Tab = typeof TABS[number];
export type Dock = 'code' | 'timeline' | 'look';
/** The side column, wide: Layers over Settings (split), or one taking it all and the other down to its head. */
export type SideView = 'split' | 'layers' | 'params';
const copy = <T>(v: T): T => (v == null ? v : JSON.parse(JSON.stringify(v)));
const some = <T extends object>(o?: T | null) => (o && Object.keys(o).length ? copy(o) : null);
const SHORT = '(max-height: 899px)';   // below this height the code editor starts folded

/** How each field that plays (PLAYS) is saved: a new one needs a line here. */
const CLEAN = { layers: (v: Layer[]) => v.map(cleanLayer), duration: cleanDuration,
  bpm: (v: number | null) => v || null, globals: (v?: Globals | null) => some(v),
  automation: (v?: Automation | null) => some(v) } satisfies { [K in PlaysKey]: (v: Draft[K]) => unknown };
type Saved = { [K in PlaysKey]: ReturnType<typeof CLEAN[K]> };

/** The look as saved: what save() sends and what `dirty` compares; its chains follow the one rule (chain 2). */
export function saveBody(l: Draft) {
  const plays = Object.fromEntries(PLAYS.map((k) => [k, (CLEAN[k] as (v: unknown) => unknown)(l[k])])) as Saved;
  return { title: l.title.trim() || 'Untitled look', summary: l.summary || '', ...plays, chain: 2 as const };
}

export function createStudio(me: User | null) {
  const NARROW = matchMedia('(max-width: 899px)');
  const look = signal<Draft>({ id: null, title: 'Untitled look', summary: '', layers: [], duration: 30, bpm: null,
    shared: false, ideaId: null, owner: me?.id, ownerName: me?.username, globals: {} });
  const server = signal<Look | null>(null);   // as the server last sent it (bake, reviewed, …); null until saved
  const saved = signal(''), ready = signal(false), saving = signal(false), sharing = signal(false);
  const copyOnSave = signal(false);
  /** A saved version playing instead of the work, which is held until "Back to my work" (or a restore). */
  const previewing = signal<{ n: number, label: string, held: Draft } | null>(null);
  const history = createSteps();
  const selectedId = signal<string | null>(null), picked = signal<Record<string, string>>({});
  const muted = signal<ReadonlySet<string>>(new Set()), solo = signal<ReadonlySet<string>>(new Set());
  const heavy = signal<ReadonlyMap<string, number>>(new Map());   // layers too slow for a phone's 40 fps: ms a frame
  const hoverGroup = signal<string | null>(null), pinnedGroup = signal<string | null>(null);
  const groupsFor = signal<string | null>(null);     // the layer whose groups are being picked: the view focuses them
  const newGroups = signal<string[] | null>(null);   // a layer being added (the shelf): the groups picked for it
  /** The [groups, tags] being picked, as JSON, so the view refocuses only when they change. */
  const focusKey = computed(() => {
    if (newGroups.value) return JSON.stringify([newGroups.value, null]);
    const l = groupsFor.value && look.value.layers.find((x) => x.id === groupsFor.value);
    return l ? JSON.stringify([l.groups ?? null, l.tags ?? null]) : null;
  });
  const narrow = signal(NARROW.matches);
  const knownDock = (d: string | null): Dock => (d === 'code' || d === 'look' ? d : 'timeline');
  const dock = signal(knownDock(pref('studio.dock'))), wasFolded = pref('studio.dockFolded');
  const tab = signal<Tab>(TABS.includes(pref('studio.tab') as Tab) ? pref('studio.tab') as Tab : 'layers');
  const folded = signal(wasFolded === null ? dock.value === 'code' && matchMedia(SHORT).matches : wasFolded === '1');
  const side = signal<SideView>(['layers', 'params'].includes(pref('studio.side') ?? '')
    ? pref('studio.side') as SideView : 'split');
  const fallbackRev = signal(0);       // a module fell back to its last good code: send the look again
  const data = { rig: null as Rig | null, index: null as GroupIndex | null, library: [] as LibraryEntry[] };
  const clock = { t: 0, typingUntil: 0 };       // show time (per frame, not a signal); when code edits settle
  const playing = signal(!reducedMotion()), speed = signal(1), baked = signal(false);

  const layerById = (id: string) => look.peek().layers.find((l) => l.id === id) || null;
  const silent = (id: string) => muted.value.has(id) || (solo.value.size > 0 && !solo.value.has(id));
  const status = createLayerStatus(layerById, (id) => silent(id));
  const work = computed(() => previewing.value?.held ?? look.value);   // the look as edited, even while previewing
  const body = computed(() => saveBody(work.value));
  const dirty = computed(() => ready.value && JSON.stringify(body.value) !== saved.value);
  const selected = computed(() => look.value.layers.find((l) => l.id === selectedId.value) || null);
  const module = computed(() => {
    const l = selected.value, id = l && picked.value[l.id];
    return l ? l.modules.find((m) => m.id === id) || l.modules.find((m) => m.kind === 'source') || l.modules[0] : null;
  });
  /** What the dock's head shows: the layer › its module; the editor's problem. */
  const lookId = computed(() => look.value.id);
  const codeFor = computed(() => {
    const l = selected.value, m = module.value;
    return l ? `${l.title}${m && l.modules.length > 1 ? ` › ${m.title}` : ''}` : '';
  });
  const problem = computed(() => (selected.value ? status.problem(selected.value.id, module.value) : null));
  /** The look as the sandbox runs it: each module's last good code, silent layers off. */
  const sandboxLook = computed(() => {
    void fallbackRev.value;
    const L = look.value;
    const layers = L.layers.map((l) => {
      const c = cleanLayer(l);
      c.modules = c.modules.map((m) => ({ ...m, code: status.codeFor(l.id, m) }));
      return silent(l.id) ? { ...c, level: 0, enabled: false } : c;
    });
    return { layers, extra: extrasOf(L) };
  });
  /** Where a layer plays: its groups' names; none given: the whole rig; none picked: its tags, else nothing. */
  const groupNames = (ids?: string[], tags?: string[]) => {
    if (ids?.length) return ids.map((id) => data.index?.byId.get(id)?.name || id).join(', ');
    if (tags?.length) return tags.map((t) => `#${t}`).join(', ');
    return ids ? 'Nothing' : data.index?.byId.get(data.index.root)?.name || 'Everything';
  };

  const st = {
    look, server, saved, ready, saving, sharing, copyOnSave, selectedId, picked, muted, solo, heavy, hoverGroup,
    pinnedGroup, groupsFor, newGroups, focusKey, narrow, dock, tab, folded, side, fallbackRev, data, clock, playing,
    speed, baked, status, body, dirty, selected, module, sandboxLook, layerById, silent, groupNames, codeFor, problem,
    lookId, previewing, work, history,
    /** Hooks the preview sets: an edit happened (baked playback stops); flush pending code to the sandbox. */
    onEdit: () => {}, flush: () => {},

    /** Change the look; every edit of the content goes through here, and each is a step (`o.step` names it, else
     * what it changed does; `o.merge` folds edits that share it into one). */
    edit(fn: (l: Draft) => Partial<Draft>, o?: EditOptions) {
      if (previewing.peek()) {
        toast('You are previewing a version. Go back to your work to edit.', { kind: 'warn' });
        return;
      }
      const before = look.value, after = { ...before, ...fn(before) };
      look.value = after;
      if (ready.peek() && changes(before, after)) history.record(before, after, o);
      st.onEdit();
    },
    /** The look as it was at step `i` (its words and what plays); later steps stay, greyed, until a new edit. */
    jump(i: number) {
      const s = history.list.peek()[i];
      if (!s || i === history.at.peek()) return;
      if (previewing.peek()) st.back();
      const L = { ...look.peek(), ...Object.fromEntries(CONTENT.map((k) => [k, s.look[k]])) };
      batch(() => {
        look.value = L;
        history.at.value = i;
        if (!L.layers.some((l) => l.id === selectedId.peek())) selectedId.value = L.layers.at(-1)?.id ?? null;
      });
      setTitle(L.title);
      st.onEdit();
    },
    undo() { st.jump(history.at.peek() - 1); },
    redo() { st.jump(history.at.peek() + 1); },
    /** A toast's Undo: back to before `step`, if it is still the step now (else History has it). */
    undoStep(step?: Step) {
      if (step && history.list.peek()[history.at.peek()] === step) st.undo();
      else toast('Other edits came after it: History (Ctrl+Z) walks back through them.', { kind: 'warn' });
    },
    /** The step the last edit made or folded into. */
    step: () => history.list.peek()[history.at.peek()],
    editLayer(id: string, fn: (l: Layer) => Partial<Layer>, o?: EditOptions) {
      st.edit((L) => ({ layers: L.layers.map((l) => (l.id === id ? { ...l, ...fn(l) } : l)) }), o);
    },
    /** Change a module; a standard one keeps the library's name (standard-modules.ts). */
    editModule(layerId: string, id: string, fn: (m: Module) => Partial<Module>, o?: EditOptions) {
      st.editLayer(layerId, (l) => ({ modules: keepStandardTitles(l.modules.map((m) => (m.id === id
        ? { ...m, ...fn(m) } : m)), data.library) }), o);
    },
    editGlobals(fn: (g: Globals) => Globals, o?: EditOptions) {
      st.edit((L) => ({ globals: fn({ ...L.globals }) }), o);
    },
    select(id: string | null) { selectedId.value = id; },
    pickModule(id: string) {
      const l = selected.peek();
      if (l) picked.value = { ...picked.value, [l.id]: id };
    },
    toggle(set: typeof muted, id: string) {
      const next = new Set(set.value);
      if (!next.delete(id)) next.add(id);
      set.value = next;
    },
    setTab(id: Tab, { onlyNarrow = false } = {}) {
      if (onlyNarrow && !narrow.value) return;
      tab.value = TABS.includes(id) ? id : 'layers';
      pref('studio.tab', tab.value);
    },
    showDock(id: Dock, unfold = true) {
      dock.value = id;
      pref('studio.dock', id);
      if (unfold) st.fold(false);
    },
    fold(on: boolean) { folded.value = on; pref('studio.dockFolded', on ? '1' : '0'); },
    showSide(v: SideView) { side.value = v; pref('studio.side', v); },

    /** The rig, the library and the look are here: set the look up. */
    setup(rig: Rig, library: LibraryEntry[], from: Look | null) {
      Object.assign(data, { rig, index: buildGroupIndex(rig), library });
      const L = { ...look.peek() };
      if (from) {
        Object.assign(L, { id: from.id, title: from.title || 'Untitled look', summary: from.summary || '',
          shared: !!from.shared, layers: normaliseLayers(from.layers, rig), ideaId: from.ideaId || null,
          owner: from.owner, ownerName: from.ownerName, duration: cleanDuration(from.duration),
          bpm: cleanBpm(from.bpm), globals: copy(from.globals) || {}, automation: copy(from.automation) });
        copyOnSave.value = !!(me && from.owner && from.owner !== me.id);
        server.value = from;
        setTitle(L.title);
      }
      if (!L.layers.length) {
        const first = library.find((p): p is ModuleEntry => (p.kind || 'source') === 'source');
        L.layers = [first ? layerFromPattern(first, rig) : newLayer({ title: 'Rising band' }, rig)];
      }
      batch(() => {
        previewing.value = null;
        look.value = L;
        saved.value = JSON.stringify(saveBody(L));    // untouched: even a brand-new look only nags once edited
        selectedId.value = L.layers.at(-1)?.id ?? null;
        ready.value = true;
      });
      history.start(L);
    },

    /** Plays version `v` in place of the work, which is held, untouched, until back() or restore(). */
    preview(v: Version, label: string) {
      const held = previewing.peek()?.held ?? look.peek();
      batch(() => {
        previewing.value = { n: v.n, label, held };
        look.value = { ...held, layers: normaliseLayers(v.layers, data.rig as Rig), duration: cleanDuration(v.duration),
          bpm: cleanBpm(v.bpm), globals: copy(v.globals) || {}, automation: copy(v.automation) };
      });
      st.onEdit();
    },
    /** Back to the work as it was before the preview. */
    back() {
      const p = previewing.peek();
      if (!p) return;
      batch(() => { look.value = p.held; previewing.value = null; });
      st.onEdit();
    },
    /** The version previewed becomes the work, as an edit, and is saved: a new version that names it. */
    async restore() {
      const p = previewing.peek(), L = look.peek();
      if (!p) return false;
      st.back();
      st.edit(() => Object.fromEntries(PLAYS.map((k) => [k, L[k]])),
        { step: `Restored version ${p.n}`, kind: 'restore' });
      return st.save({ restoredFrom: p.n });
    },

    /** An AI round's revision, saved by the server: one step, saved. */
    revised(from: Look, ai: AiStep) {
      if (from.id !== look.peek().id) return;
      const quoted = ai.asked.length > 40 ? `${ai.asked.slice(0, 39)}…` : ai.asked;
      st.edit(() => ({ layers: normaliseLayers(from.layers, data.rig as Rig), duration: cleanDuration(from.duration),
        bpm: cleanBpm(from.bpm), globals: copy(from.globals) || {}, automation: copy(from.automation) }),
      { step: ai.asked ? `AI: “${quoted}”` : 'An AI round', kind: 'ai', ai });
      batch(() => { saved.value = JSON.stringify(body.peek()); server.value = from; });
      history.saved();
    },

    /** The server sent a newer copy of this look (after a save, a bake, a review). */
    adopt(from: Look) {
      if (!from || (look.peek().id && from.id !== look.peek().id)) return;
      server.value = from;
    },

    /** Saves the look: true once saved; false when it failed (and said so) or a save is already running. */
    async save(extra: Pick<LookPatch, 'restoredFrom' | 'versionName'> = {}) {
      if (!ready.value || saving.value) return false;
      if (previewing.value) {
        toast('You are previewing a version: restore it, or go back to your work, to save.', { kind: 'warn' });
        return false;
      }
      st.flush();
      const b = body.value, snap = JSON.stringify(b), L = look.value, create = !L.id || copyOnSave.value;
      const step = history.at.peek(), steps = history.list.peek();   // edits made while it saves are not saved
      saving.value = true;
      try {
        let from: Look;
        if (create) {
          ({ look: from } = await api.createLook({ ...b, bpm: b.bpm || undefined,
            ...(L.ideaId && !copyOnSave.value ? { ideaId: L.ideaId } : {}) }));
          replaceUrl(`/studio/${encodeURIComponent(from.id)}`);
          toast(copyOnSave.value ? 'Saved as your own copy.' : 'Saved.', { kind: 'ok' });
        } else {
          const hadBake = !!server.value?.bake;
          ({ look: from } = await api.updateLook(L.id as string, { ...b, ...extra }));
          const cleared = hadBake && !from.bake;
          toast(cleared ? 'Saved. The old bake was cleared: bake again to check the new code.' : 'Saved.',
            { kind: 'ok', timeout: cleared ? 5000 : 1800 });
        }
        batch(() => {
          look.value = { ...look.value, id: from.id, title: b.title,
            ...(create ? { owner: from.owner, ownerName: from.ownerName, shared: !!from.shared } : {}) };
          copyOnSave.value = false;
          saved.value = snap;
          st.adopt(from);
        });
        setTitle(b.title);
        if (history.list.peek()[step]?.look === steps[step]?.look) history.saved(step);
        for (const id of history.undoneRounds()) api.undoRefine(id).catch(() => {});   // the AI learns it was undone
        return true;
      } catch (err) {
        failed(err, 'Could not save: ');
        return false;
      } finally {
        saving.value = false;
      }
    },

    async setShared(on: boolean) {
      if (copyOnSave.value) {
        toast('This look belongs to someone else. Save your own copy first, then share it.', { kind: 'warn' });
        return;
      }
      sharing.value = true;
      try {
        if ((!look.value.id || dirty.value) && !(await st.save())) return; // never share what did not save
        const id = look.value.id;
        if (!id) return;
        const { look: from } = await api.updateLook(id, { shared: on });
        look.value = { ...look.value, shared: !!from.shared };
        st.adopt(from);
        toast(from.shared ? 'Shared to the gallery.' : 'Removed from the gallery.', { kind: 'ok' });
      } catch (err) {
        failed(err);
      } finally {
        sharing.value = false;
      }
    },
  };
  const failed = (err: unknown, prefix = '') => {
    toast(`${prefix}${(err as Error).message}`, { kind: 'error', timeout: prefix ? 8000 : undefined });
  };
  const onNarrow = () => { narrow.value = NARROW.matches; };
  NARROW.addEventListener('change', onNarrow);
  return Object.assign(st, { dispose: () => NARROW.removeEventListener('change', onNarrow) });
}
export type Studio = ReturnType<typeof createStudio>;
