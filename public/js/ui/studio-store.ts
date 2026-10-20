// The Studio's state as signals: the look being edited (replaced, never mutated, on each edit), what the server last
// sent, the selection, mute and solo, the panels' layout, and what is derived from them (dirty, the selected layer
// and module, what the sandbox runs). Edits go through edit*(); save() and setShared() talk to the server.
import { batch, computed, signal } from '@preact/signals';

import { api, statusOf } from '../api.ts';
import type { Automation, Globals, Module } from '../../../shared/schemas/look.ts';
import type { Look, User } from '../../../shared/schemas/api.ts';
import type { LibraryEntry, ModuleEntry, Rig } from '../../../shared/schemas/rig.ts';
import { replaceUrl, setTitle, signedOut } from './session.ts';
import { pref, reducedMotion, toast } from './kit.tsx';
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

/** The look as saved: what save() sends and what `dirty` compares; its chains follow the one rule (chain 2). */
export function saveBody(l: Draft) {
  return { title: l.title.trim() || 'Untitled look', summary: l.summary || '', layers: l.layers.map(cleanLayer),
    duration: cleanDuration(l.duration), bpm: l.bpm || null, globals: some(l.globals), automation: some(l.automation),
    chain: 2 as const };
}

export function createStudio(me: User | null) {
  const NARROW = matchMedia('(max-width: 899px)');
  const look = signal<Draft>({ id: null, title: 'Untitled look', summary: '', layers: [], duration: 30, bpm: null,
    shared: false, ideaId: null, owner: me?.id, ownerName: me?.username, globals: {} });
  const server = signal<Look | null>(null);   // as the server last sent it (bake, reviewed, …); null until saved
  const saved = signal(''), ready = signal(false), saving = signal(false), sharing = signal(false);
  const copyOnSave = signal(false);
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
  const body = computed(() => saveBody(look.value));
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
    return { layers, extra: { globals: L.globals, automation: L.automation, bpm: L.bpm || undefined } };
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
    lookId,
    /** Hooks the preview sets: an edit happened (baked playback stops); flush pending code to the sandbox. */
    onEdit: () => {}, flush: () => {},

    /** Change the look; every edit of the content goes through here. */
    edit(fn: (l: Draft) => Partial<Draft>) {
      look.value = { ...look.value, ...fn(look.value) };
      st.onEdit();
    },
    editLayer(id: string, fn: (l: Layer) => Partial<Layer>) {
      st.edit((L) => ({ layers: L.layers.map((l) => (l.id === id ? { ...l, ...fn(l) } : l)) }));
    },
    editModule(layerId: string, id: string, fn: (m: Module) => Partial<Module>) {
      st.editLayer(layerId, (l) => ({ modules: l.modules.map((m) => (m.id === id ? { ...m, ...fn(m) } : m)) }));
    },
    editGlobals(fn: (g: Globals) => Globals) { st.edit((L) => ({ globals: fn({ ...L.globals }) })); },
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
        look.value = L;
        saved.value = JSON.stringify(saveBody(L));    // untouched: even a brand-new look only nags once edited
        selectedId.value = L.layers.at(-1)?.id ?? null;
        ready.value = true;
      });
    },

    /** The server sent a newer copy of this look (after a save, a bake, a review). */
    adopt(from: Look) {
      if (!from || (look.peek().id && from.id !== look.peek().id)) return;
      server.value = from;
    },

    /** Saves the look: true once saved; false when it failed (and said so) or a save is already running. */
    async save() {
      if (!ready.value || saving.value) return false;
      st.flush();
      const b = body.value, snap = JSON.stringify(b), L = look.value, create = !L.id || copyOnSave.value;
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
          ({ look: from } = await api.updateLook(L.id as string, b));
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
    if (statusOf(err) === 401) return signedOut();
    toast(`${prefix}${(err as Error).message}`, { kind: 'error', timeout: prefix ? 8000 : undefined });
  };
  const onNarrow = () => { narrow.value = NARROW.matches; };
  NARROW.addEventListener('change', onNarrow);
  return Object.assign(st, { dispose: () => NARROW.removeEventListener('change', onNarrow) });
}
export type Studio = ReturnType<typeof createStudio>;
