// The layer stack, top of the list = top of the composite (index 0 is the bottom); what the Studio does to layers:
// add from the library, duplicate, delete (with undo), move (by the buttons, or a row's grip dragged).
import { useId, useRef } from 'preact/hooks';

import { useDragOrder } from './drag-order.ts';
import { cx, loadFailed, Scrub, toast } from './kit.tsx';
import {
  BLEND_MODES, cleanLayer, isPreset, type Layer, layerFromPattern, makeLayer, newLayer, presetLayers, withPresetGlobals,
} from './model.ts';
import type { Preview } from './preview.ts';
import { SideExpand, SideFold } from './side-panels.tsx';
import type { Entry } from './shelf.tsx';
import type { Studio } from './studio-store.ts';
import { tourName } from './tour-view.ts';

const STATUS_TEXT: Record<string, string> = { ok: 'Running', pending: 'Compiling…', compile: 'Compile error',
  runtime: 'Runtime error', hung: 'Hung — paused', muted: 'Muted' };
type Props = { st: Studio; pv: Preview };
type EditOptions = Parameters<Studio['edit']>[1];

/** Put a layer in the stack (by default above the selected one) and select it. */
function insertLayer(st: Studio, layer: Layer, at?: number, o?: EditOptions) {
  st.edit((L) => {
    const layers = L.layers.slice(), sel = st.selected.peek();
    layers.splice(at ?? (sel ? layers.indexOf(sel) + 1 : layers.length), 0, layer);
    return { layers };
  }, o);
  st.select(layer.id);
}

export function LayersPane({ st, pv }: Props) {
  const layers = st.look.value.layers, l = st.selected.value, i = l ? layers.indexOf(l) : -1;
  const icon = (label: string, title: string, text: string, disabled: boolean, onClick: () => void) =>
    <button type="button" class="icon-btn" aria-label={label} title={title} disabled={disabled} onClick={onClick}
      data-tour={tourName(label)}>
      {text}</button>;
  const reorder = (from: number, to: number) => {
    if (to < 0 || to >= layers.length) return;
    const next = layers.slice();
    next.splice(to, 0, next.splice(from, 1)[0]);
    st.edit(() => ({ layers: next }));
  };
  const move = (dir: number) => { if (l) reorder(i, i + dir); };
  // The list shows the top first: a row's place there is n - 1 - its index.
  const n = layers.length, listRef = useRef<HTMLOListElement>(null);
  const order = useDragOrder(listRef, (from, to) => reorder(n - 1 - from, n - 1 - to));
  function remove() {
    if (!l) return;
    st.edit((L) => ({ layers: L.layers.filter((x) => x !== l) }));
    for (const set of [st.muted, st.solo]) if (set.peek().has(l.id)) st.toggle(set, l.id);
    const left = st.look.peek().layers;
    st.select(left[Math.min(i, left.length - 1)]?.id ?? null);
    const step = st.step();
    toast(`Deleted “${l.title}”.`, { action: { label: 'Undo', onClick: () => st.undoStep(step) } });
  }
  // Add a layer (shelf.tsx): a blank one, one source, or a preset's layers above the selected one, with the globals it
  // needs; each on the groups picked in the shelf.
  const made = (e: Entry) => (isPreset(e) ? presetLayers(e, st.data.library, st.data.rig) : null);
  const add = () => import('./shelf.tsx').then(({ openShelf }) => openShelf({
    mode: 'layer', library: st.data.library, audition: { pv, layer: l || {}, layers: made }, st,
    onPick: (e, groups) => {
      if (isPreset(e)) {
        const list = made(e)?.map((x) => (groups ? { ...x, groups: [...groups] } : x));
        if (!list) return toast(`${e.title} needs a module this library lacks.`, { kind: 'warn' });
        const at = st.selected.peek() ? st.look.peek().layers.indexOf(st.selected.peek()!) + 1 : undefined;
        const o = { step: `Added the preset “${e.title}”`, kind: 'add', merge: `preset:${Date.now()}` } as const;
        if (e.globals) st.edit((L) => ({ globals: withPresetGlobals(L.globals, e) }), o);   // one step, all of it
        list.forEach((layer, i) => insertLayer(st, layer, at === undefined ? undefined : at + i, o));
        return;
      }
      const one = 'blank' in e ? newLayer({ title: 'New layer' }, st.data.rig) : layerFromPattern(e, st.data.rig);
      insertLayer(st, groups ? { ...one, groups } : one);
      if (!('blank' in e)) return;    // a blank layer is for writing code
      st.setTab('code', { onlyNarrow: true });
      if (!st.narrow.peek()) st.showDock('code');
    } })).catch(loadFailed);
  return (
    <section class="pane pane-layers" data-pane="layers" aria-label="Layers" data-tour="layers">
      <div class="pane-head"><h2 class="pane-title"><SideFold st={st} panel="layers" /></h2>
        <div class="pane-tools">
          {icon('Move layer up', 'Move up (toward the top)', '↑', !l || i >= layers.length - 1, () => move(+1))}
          {icon('Move layer down', 'Move down (toward the bottom)', '↓', !l || i <= 0, () => move(-1))}
          {icon('Duplicate layer', 'Duplicate layer', '⧉', !l, () => {
            if (l) insertLayer(st, makeLayer({ ...cleanLayer(l), title: `${l.title} copy` }, st.data.rig), i + 1);
          })}
          {icon('Delete layer', 'Delete layer', '🗑', !l, remove)}
          <button type="button" class="btn small primary" title="Add a layer from the library" onClick={add}
            data-tour="layers-add">
            + Add</button>
        </div><SideExpand st={st} panel="layers" /></div>
      <div class="pane-body">
        <ol class="layer-list" aria-label="Layers, top first" ref={listRef}>
          {layers.map((x, k) => <LayerRow key={x.id} l={x} index={k} st={st} grip={order.grip(n - 1 - k)}
            drop={order.drop(n - 1 - k, n)} dragging={order.dragging === n - 1 - k} />).reverse()}</ol>
      </div>
    </section>);
}

function LayerRow({ l, index, st, grip, drop, dragging }: { l: Layer; index: number; st: Studio;
  grip: ReturnType<ReturnType<typeof useDragOrder>['grip']>; drop?: string; dragging: boolean }) {
  const id = l.id, status = st.status.of(id), title = l.title || 'Layer';
  const said = STATUS_TEXT[status.kind] || status.kind;
  // A failing layer adds nothing while the rest play on; its line says why, in place of its groups (the same height,
  // so an error that comes and goes never moves the panel).
  const failing = status.kind === 'compile' || status.kind === 'runtime' || status.kind === 'hung';
  const muted = st.muted.value.has(id), soloed = st.solo.value.has(id), selected = id === st.selectedId.value;
  const ms = st.heavy.value.get(id), blendId = useId(), select = () => st.select(id);
  return (
    <li class={cx('layer', selected && 'selected', st.silent(id) && 'silent', dragging && 'dragging')}
      data-status={status.kind} data-blend={l.blend} data-drop={drop}
      data-tour={`layer:${tourName(title)}`} onClick={(e) => {   // its empty space selects it
        const t = e.target as HTMLElement;
        if (t === e.currentTarget || t.matches('.layer-groups, .layer-top, .layer-bottom')) select();
      }}>
      <div class="layer-top"><span class="grip" title="Drag to reorder" aria-hidden="true"
        data-tour={`layer-grip:${tourName(title)}`} {...grip} />
        <span class="layer-index" aria-hidden="true">{index + 1}</span>
        <div class="ms" role="group" aria-label="Mute and solo">
          <button type="button" class="ms-btn mute" aria-pressed={muted} aria-label={`Mute ${title}`}
            title="Mute in the preview and preview FSEQ export"
            data-tour={`mute:${tourName(title)}`} onClick={() => st.toggle(st.muted, id)}>M</button>
          <button type="button" class="ms-btn solo" aria-pressed={soloed} aria-label={`Solo ${title}`}
            title="Solo in the preview and preview FSEQ export"
            data-tour={`solo:${tourName(title)}`} onClick={() => st.toggle(st.solo, id)}>S</button></div>
        <button type="button" class="layer-name" aria-current={selected} onClick={select}
          title={`${title} — ${said}${status.message ? `: ${status.message}` : ''}`}>{title}</button>
        <span class="kind-badge layer-heavy" hidden={!ms}
          title={ms ? `${ms.toFixed(1)} ms a frame: over 40 % of a 40 fps frame, so phones preview it slower.`
            : undefined}>
          Heavy</span>
        <span class="status-dot" aria-hidden="true" title={STATUS_TEXT[status.kind] || ''} />
        <span class="sr-only">{`, ${said}`}</span></div>
      <div class="layer-bottom" data-tour={`level:${tourName(title)}`}>
        <label for={blendId} class="sr-only">Blend for {title}</label>
        <select id={blendId} class="blend-select" value={l.blend} data-tour={`blend:${tourName(title)}`}
          onChange={(e) => {
            const blend = e.currentTarget.value as Layer['blend'];
            st.editLayer(id, () => ({ blend }));
          }}>
          {BLEND_MODES.map((b) => <option value={b.value} title={b.help}>{b.label}</option>)}</select>
        <Scrub label={`Level for ${title}`} min={0} max={100} step={1} unit="%" value={Math.round(l.level * 100)}
          set={(v) => st.editLayer(id, () => ({ level: v / 100 }))} /></div>
      <span class={cx('layer-groups', failing && 'layer-issue')}>
        {failing ? `${said}${status.message ? `: ${status.message}` : ''}` : st.groupNames(l.groups, l.tags)}</span>
    </li>);
}
