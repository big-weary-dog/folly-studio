// The layer stack, top of the list = top of the composite (index 0 is the bottom); what the Studio does to layers:
// add from the library, duplicate, delete (with undo), move; and the groups tree, where checkboxes say which groups
// the selected layer plays on, and hovering or focusing a row (or its pin) lights its LEDs on the model.
import { useComputed } from '@preact/signals';
import { useId, useLayoutEffect, useState } from 'preact/hooks';

import type { RigGroup } from '../../../shared/schemas/rig.ts';
import { cx, Scrub, toast } from './kit.tsx';
import {
  BLEND_MODES, cleanLayer, isPreset, type Layer, layerFromPattern, makeLayer, newLayer, presetLayers, withPresetGlobals,
} from './model.ts';
import type { Preview } from './preview.ts';
import type { Entry } from './shelf.tsx';
import type { Studio } from './studio-store.ts';

const STATUS_TEXT: Record<string, string> = { ok: 'Running', pending: 'Compiling…', compile: 'Compile error',
  runtime: 'Runtime error', hung: 'Hung — paused', muted: 'Muted' };
type Props = { st: Studio; pv: Preview };

/** Put a layer in the stack (by default above the selected one) and select it. */
function insertLayer(st: Studio, layer: Layer, at?: number) {
  st.edit((L) => {
    const layers = L.layers.slice(), sel = st.selected.peek();
    layers.splice(at ?? (sel ? layers.indexOf(sel) + 1 : layers.length), 0, layer);
    return { layers };
  });
  st.select(layer.id);
}

export function LayersPane({ st, pv }: Props) {
  const layers = st.look.value.layers, l = st.selected.value, i = l ? layers.indexOf(l) : -1;
  const icon = (label: string, title: string, text: string, disabled: boolean, onClick: () => void) =>
    <button type="button" class="icon-btn" aria-label={label} title={title} disabled={disabled} onClick={onClick}>
      {text}</button>;
  const move = (dir: number) => {
    const j = i + dir;
    if (!l || j < 0 || j >= layers.length) return;
    const next = layers.slice();
    next.splice(j, 0, next.splice(i, 1)[0]);
    st.edit(() => ({ layers: next }));
  };
  function remove() {
    if (!l) return;
    st.edit((L) => ({ layers: L.layers.filter((x) => x !== l) }));
    for (const set of [st.muted, st.solo]) if (set.peek().has(l.id)) st.toggle(set, l.id);
    const left = st.look.peek().layers;
    st.select(left[Math.min(i, left.length - 1)]?.id ?? null);
    toast(`Deleted “${l.title}”.`, { action: { label: 'Undo', onClick: () => insertLayer(st, l,
      Math.min(i, st.look.peek().layers.length)) } });
  }
  // Add a layer (shelf.tsx): a blank one, one source (auditioned over the selected layer's groups), or a preset's
  // layers above the selected one, with the globals it needs.
  const made = (e: Entry) => (isPreset(e) ? presetLayers(e, st.data.library, st.data.rig) : null);
  const add = () => import('./shelf.tsx').then(({ openShelf }) => openShelf({
    mode: 'layer', library: st.data.library, audition: { pv, layer: l || { groups: [] }, layers: made },
    onPick: (e) => {
      if (isPreset(e)) {
        const list = made(e);
        if (!list) return toast(`${e.title} needs a module this library lacks.`, { kind: 'warn' });
        const at = st.selected.peek() ? st.look.peek().layers.indexOf(st.selected.peek()!) + 1 : undefined;
        if (e.globals) st.edit((L) => ({ globals: withPresetGlobals(L.globals, e) }));
        list.forEach((layer, i) => insertLayer(st, layer, at === undefined ? undefined : at + i));
        return;
      }
      insertLayer(st, 'blank' in e ? newLayer({ title: 'New layer' }, st.data.rig) : layerFromPattern(e, st.data.rig));
      st.setTab('code', { onlyNarrow: true });
      if ('blank' in e && !st.narrow.peek()) st.showDock('code');   // a blank layer is for writing code
    } }));
  return (
    <section class="pane pane-layers" data-pane="layers" aria-label="Layers">
      <div class="pane-head"><h2 class="pane-title">Layers</h2>
        <div class="pane-tools">
          {icon('Move layer up', 'Move up (toward the top)', '↑', !l || i >= layers.length - 1, () => move(+1))}
          {icon('Move layer down', 'Move down (toward the bottom)', '↓', !l || i <= 0, () => move(-1))}
          {icon('Duplicate layer', 'Duplicate layer', '⧉', !l, () => {
            if (l) insertLayer(st, makeLayer({ ...cleanLayer(l), title: `${l.title} copy` }, st.data.rig), i + 1);
          })}
          {icon('Delete layer', 'Delete layer', '🗑', !l, remove)}
          <button type="button" class="btn small primary" title="Add a layer from the library" onClick={add}>
            + Add</button>
        </div></div>
      <div class="pane-body">
        <ol class="layer-list" aria-label="Layers, top first">
          {layers.map((x, n) => <LayerRow key={x.id} l={x} index={n} st={st} />).reverse()}</ol>
      </div>
    </section>);
}

function LayerRow({ l, index, st }: { l: Layer; index: number; st: Studio }) {
  const id = l.id, status = st.status.of(id), title = l.title || 'Layer';
  const said = STATUS_TEXT[status.kind] || status.kind;
  const muted = st.muted.value.has(id), soloed = st.solo.value.has(id), selected = id === st.selectedId.value;
  const ms = st.heavy.value.get(id), blendId = useId(), select = () => st.select(id);
  return (
    <li class={cx('layer', selected && 'selected', st.silent(id) && 'silent')} data-status={status.kind}
      data-blend={l.blend} onClick={(e) => {   // the row's empty space selects it too
        const t = e.target as HTMLElement;
        if (t === e.currentTarget || t.matches('.layer-groups, .layer-top, .layer-bottom')) select();
      }}>
      <div class="layer-top"><span class="layer-index" aria-hidden="true">{index + 1}</span>
        <div class="ms" role="group" aria-label="Mute and solo">
          <button type="button" class="ms-btn mute" aria-pressed={muted} aria-label={`Mute ${title}`}
            onClick={() => st.toggle(st.muted, id)}>M</button>
          <button type="button" class="ms-btn solo" aria-pressed={soloed} aria-label={`Solo ${title}`}
            onClick={() => st.toggle(st.solo, id)}>S</button></div>
        <button type="button" class="layer-name" aria-current={selected} onClick={select}
          title={`${title} — ${said}${status.message ? `: ${status.message}` : ''}`}>{title}</button>
        <span class="kind-badge layer-heavy" hidden={!ms}
          title={ms ? `${ms.toFixed(1)} ms a frame: over 40 % of a 40 fps frame, so phones preview it slower.`
            : undefined}>
          Heavy</span>
        <span class="status-dot" aria-hidden="true" title={STATUS_TEXT[status.kind] || ''} />
        <span class="sr-only">{`, ${said}`}</span></div>
      <div class="layer-bottom">
        <label for={blendId} class="sr-only">Blend for {title}</label>
        <select id={blendId} class="blend-select" value={l.blend}
          onChange={(e) => {
            const blend = e.currentTarget.value as Layer['blend'];
            st.editLayer(id, () => ({ blend }));
          }}>
          {BLEND_MODES.map((b) => <option value={b.value} title={b.help}>{b.label}</option>)}</select>
        <Scrub label={`Level for ${title}`} min={0} max={100} step={1} unit="%" value={Math.round(l.level * 100)}
          set={(v) => st.editLayer(id, () => ({ level: v / 100 }))} /></div>
      <span class="layer-groups">{st.groupNames(l.groups)}</span>
    </li>);
}

export function GroupsTree({ st }: { st: Studio }) {
  const index = st.data.index, picked = useComputed(() => st.selected.value?.groups.join('\n') ?? null).value;
  const [open, setOpen] = useState<ReadonlySet<string> | null>(null);
  // The top of the tree starts open; the branches that hold the layer's groups open so they are visible.
  useLayoutEffect(() => {
    if (!index) return;
    const was = open || new Set((index.children.get(null) || []).map((g) => g.id));
    const add = (picked?.split('\n') || []).flatMap((g) => index.ancestors(g)).filter((a) => !was.has(a));
    if (add.length || !open) setOpen(new Set([...was, ...add]));
  }, [picked, index]);
  if (!index || !open) return null;
  const sel = new Set(picked?.split('\n') || []), partial = new Set([...sel].flatMap((g) => index.ancestors(g)));
  const toggle = (id: string, on: boolean) => {
    const l = st.selected.peek();
    if (!l) return;
    const set = new Set(l.groups);
    if (on) set.add(id); else set.delete(id);
    // picked by hand: no longer a portable guess
    if (set.size) st.editLayer(l.id, () => ({ groups: [...set], tags: undefined }));
    else toast('A layer needs at least one group. Tick another group first.', { kind: 'warn' });
  };
  const item = (g: RigGroup, depth: number) => {
    const kids = index.children.get(g.id) || [], expanded = open.has(g.id);
    const checked = sel.has(g.id), pinned = st.pinnedGroup.value === g.id, boxId = `grp-${g.id}`;
    const implied = !checked && index.ancestors(g.id).some((a) => sel.has(a));
    const expand = () => {
      const next = new Set(open);
      if (!next.delete(g.id)) next.add(g.id);
      setOpen(next);
    };
    return (
      <li class="tree-item">
        <div class={cx('tree-row', pinned && 'pinned', checked && 'checked', implied && 'implied')} data-id={g.id}
          style={{ '--depth': String(depth) }} onPointerEnter={() => { st.hoverGroup.value = g.id; }}
          onFocusIn={() => { st.hoverGroup.value = g.id; }}>
          {kids.length ? <button type="button" class="tree-toggle" aria-expanded={expanded} onClick={expand}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${g.name}`} />
            : <span class="tree-toggle spacer" aria-hidden="true" />}
          <input type="checkbox" id={boxId} class="tree-box" checked={checked} disabled={picked === null}
            indeterminate={!checked && partial.has(g.id)} onChange={(e) => {
              const on = e.currentTarget.checked;
              e.currentTarget.checked = checked;    // the look decides
              toggle(g.id, on);
            }} />
          <label for={boxId} class="tree-label" title={g.name}>{g.name}</label>
          <span class="tree-count">{(index.counts.get(g.id) || 0).toLocaleString()}</span>
          <button type="button" class="tree-pin" aria-pressed={pinned} aria-label={`Highlight ${g.name} on the model`}
            title="Highlight on the model" onClick={() => { st.pinnedGroup.value = pinned ? null : g.id; }} />
        </div>
        {kids.length > 0 && <ul class="tree-children" role="group" hidden={!expanded}>
          {kids.map((k) => item(k, depth + 1))}</ul>}
      </li>);
  };
  return <>
    <p class="pane-hint" hidden={picked !== null}>Select a layer to choose where it plays.</p>
    <ul class="tree" aria-label="Groups" onPointerLeave={() => { st.hoverGroup.value = null; }}
      onFocusOut={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) st.hoverGroup.value = null; }}>
      {(index.children.get(null) || []).map((g) => item(g, 0))}</ul>
  </>;
}
