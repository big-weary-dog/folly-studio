// Pure: a layer's groups as the groups tree edits them. A group stands for its whole subtree, so the stored list keeps
// only the outermost picked groups: ticking a group ticks every group under it, unticking one unticks them, and a
// group whose children are all ticked becomes ticked itself. None ticked is a valid pick: the layer lights nothing.

/** The tree as the index gives it: each group's children (null: the top) and its ancestors, nearest first. */
export type Tree = { children: ReadonlyMap<string | null, readonly { id: string }[]>,
  ancestors: (id: string) => string[] };

const kids = (t: Tree, id: string) => (t.children.get(id) || []).map((g) => g.id);

/** Every group under `id`, at any depth. */
function descendants(t: Tree, id: string, out: string[] = []) {
  for (const k of kids(t, id)) { out.push(k); descendants(t, k, out); }
  return out;
}

/** Ticked: picked, or under a picked group. */
export const groupChecked = (picked: ReadonlySet<string>, t: Tree, id: string) => picked.has(id)
  || t.ancestors(id).some((a) => picked.has(a));

/** Partly ticked: not ticked, with some group under it ticked. */
export const groupPartial = (picked: ReadonlySet<string>, t: Tree, id: string) => !groupChecked(picked, t, id)
  && descendants(t, id).some((d) => picked.has(d));

/** The outermost of `ids` (ids this rig lacks are kept as they are). */
export const outermost = (ids: readonly string[], t: Tree) => {
  const set = new Set(ids);
  return [...set].filter((id) => !t.ancestors(id).some((a) => set.has(a)));
};

/** `id` ticked (with all under it) or unticked (with all under it, and out of any ticked group above it). */
export function toggleGroup(ids: readonly string[], t: Tree, id: string, on: boolean): string[] {
  const under = new Set(descendants(t, id)), up = t.ancestors(id);
  if (on && groupChecked(new Set(ids), t, id)) return outermost(ids, t);
  let out = outermost(ids, t).filter((g) => g !== id && !under.has(g));
  if (on) {
    out.push(id);
    // Climb while every child of the next group up is ticked: that group stands for them.
    for (let at = id, i = 0; i < up.length; at = up[i++]) {
      const sibs = kids(t, up[i]);
      if (!sibs.every((s) => s === at || out.includes(s))) break;
      out = [...out.filter((g) => !sibs.includes(g)), up[i]];
    }
    return out;
  }
  // Out of a ticked group above: it becomes its children, down the path to `id`, all but the way down.
  const top = up.findIndex((a) => out.includes(a));
  if (top < 0) return out;
  out = out.filter((g) => g !== up[top]);
  for (let i = top; i >= 0; i--) out.push(...kids(t, up[i]).filter((k) => k !== (i ? up[i - 1] : id)));
  return out;
}
