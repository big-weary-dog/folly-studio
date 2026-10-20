// A layer's groups (SPEC "Looks": layer.groups): the settings' "Plays on" opens a drawer beside the 3D view holding
// the groups tree, where checkboxes say which groups the selected layer plays on and hovering or focusing a row (or
// its pin) lights its LEDs on the model. While it is open the view shows where the layer plays and dims the rest.
// Add a layer (shelf.tsx) shows the same tree for the layer it adds.
import { useEffect, useLayoutEffect, useState } from 'preact/hooks';

import type { RigGroup } from '../../../shared/schemas/rig.ts';
import { Drawer, useDrawer } from './drawer.tsx';
import { groupChecked, groupPartial, toggleGroup } from './groups-model.ts';
import { cx, Field } from './kit.tsx';
import type { Studio } from './studio-store.ts';

/** "Plays on": the selected layer's groups, a button that opens them in the Groups drawer. */
export function PlaysOn({ st }: { st: Studio }) {
  const l = st.selected.value, d = useDrawer(), id = d.open ? l?.id ?? null : null;
  useEffect(() => {
    st.groupsFor.value = id;
    return () => { st.groupsFor.value = null; st.hoverGroup.value = null; st.pinnedGroup.value = null; };
  }, [id]);
  return <Field label="Plays on" class="plays-on">
    <button type="button" class="btn small plays-on-btn" disabled={!l} aria-expanded={d.open} onClick={d.toggle}
      title="Choose the groups this layer plays on">{l ? st.groupNames(l.groups, l.tags) : '—'}</button>
    <Drawer d={d} title={`Groups · ${l?.title ?? ''}`} class="groups-drawer">
      <div class="tree-wrap"><GroupsTree st={st} groups={l?.groups ?? null} set={(groups) => {
        // picked by hand: no longer a portable guess; none is fine (the layer lights nothing)
        if (l) st.editLayer(l.id, () => ({ groups, tags: undefined }));
      }} /></div></Drawer>
  </Field>;
}

/** The groups tree: `groups` ticked (null: nothing to pick for), `set` given the groups a tick makes. Hovering or
 * focusing a row, or pinning it, lights it on the model. */
export function GroupsTree({ st, groups, set }: { st: Studio; groups: readonly string[] | null;
  set: (groups: string[]) => void }) {
  const index = st.data.index, picked = groups?.join('\n') ?? null;
  const [open, setOpen] = useState<ReadonlySet<string> | null>(null);
  // The top of the tree starts open; the branches that hold the layer's groups open so they are visible.
  useLayoutEffect(() => {
    if (!index) return;
    const was = open || new Set((index.children.get(null) || []).map((g) => g.id));
    const add = (picked?.split('\n') || []).flatMap((g) => index.ancestors(g)).filter((a) => !was.has(a));
    if (add.length || !open) setOpen(new Set([...was, ...add]));
  }, [picked, index]);
  if (!index || !open) return null;
  const sel = new Set(picked ? picked.split('\n') : []);
  const toggle = (id: string, on: boolean) => { if (groups) set(toggleGroup(groups, index, id, on)); };
  const item = (g: RigGroup, depth: number) => {
    const kids = index.children.get(g.id) || [], expanded = open.has(g.id);
    const checked = groupChecked(sel, index, g.id), pinned = st.pinnedGroup.value === g.id, boxId = `grp-${g.id}`;
    const expand = () => {
      const next = new Set(open);
      if (!next.delete(g.id)) next.add(g.id);
      setOpen(next);
    };
    return (
      <li class="tree-item">
        <div class={cx('tree-row', pinned && 'pinned', checked && 'checked')} data-id={g.id}
          style={{ '--depth': String(depth) }} onPointerEnter={() => { st.hoverGroup.value = g.id; }}
          onFocusIn={() => { st.hoverGroup.value = g.id; }}>
          {kids.length ? <button type="button" class="tree-toggle" aria-expanded={expanded} onClick={expand}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${g.name}`} />
            : <span class="tree-toggle spacer" aria-hidden="true" />}
          <input type="checkbox" id={boxId} class="tree-box" checked={checked} disabled={picked === null}
            indeterminate={groupPartial(sel, index, g.id)} onChange={(e) => {
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
