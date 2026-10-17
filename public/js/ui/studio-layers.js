// The Studio's layer operations: add from the library, duplicate, delete (with undo), move, rename,
// and which groups the selected layer plays on.
import { h, openDialog, toast } from './dom.js';
import { cleanLayer, layerFromPattern, makeLayer } from './model.js';

// createLayerOps({ S, ui, changed(opts?), select(id), selected(), setTab(id, opts), narrow(), groupsTree(),
//   groupNames(ids), showLayerName(l) }) → { insertLayer, toggleGroup }
export function createLayerOps(o) {
  const { S, ui, changed, select, selected, setTab, narrow, groupsTree, groupNames, showLayerName } = o;
  const layers = () => S.look.layers;

  function insertLayer(layer, at) {
    const i = at ?? (selected() ? layers().indexOf(selected()) + 1 : layers().length);
    layers().splice(i, 0, layer);
    changed();
    select(layer.id);
  }

  function chooseFromLibrary() {
    openDialog({ title: 'Add a layer', className: 'library-dialog', build: (close) => {
      const pick = (make, blank) => {
        close();
        insertLayer(make());
        setTab('code', { onlyNarrow: true });
        if (blank && !narrow()) ui.dock.show('code');   // a blank layer is for writing code
      };
      const item = (title, summary, make, blank = false) => h('li', {}, h('button', { type: 'button',
        class: `library-item${blank ? ' blank' : ''}`, onClick: () => pick(make, blank) },
      h('span', { class: 'library-title', text: title }),
      summary ? h('span', { class: 'library-summary', text: summary }) : null));
      return h('ul', { class: 'library-list' },
        item('Blank pattern', 'A minimal starting point: one colour, one moving band.',
          () => makeLayer({ title: 'New layer' }, S.cathedral), true),
        S.library.map((p) => item(p.title || p.name, p.summary, () => layerFromPattern(p, S.cathedral))),
        S.library.length ? null : h('li', { class: 'pane-hint', text: 'The pattern library could not be loaded.' }));
    } });
  }

  ui.addBtn.addEventListener('click', () => chooseFromLibrary());
  ui.dupBtn.addEventListener('click', () => {
    const l = selected();
    if (l) {
      insertLayer(makeLayer({ ...cleanLayer(l), title: `${l.title} copy` }, S.cathedral), layers().indexOf(l) + 1);
    }
  });
  ui.delBtn.addEventListener('click', () => {
    const l = selected();
    if (!l) return;
    const i = layers().indexOf(l);
    layers().splice(i, 1);
    [S.muted, S.solo].forEach((set) => set.delete(l.id));
    changed();
    select(layers()[Math.min(i, layers().length - 1)]?.id ?? null);
    const undo = () => insertLayer(l, Math.min(i, layers().length));
    toast(`Deleted “${l.title}”.`, { action: { label: 'Undo', onClick: undo } });
  });
  const move = (dir) => {
    const l = selected();
    const i = layers().indexOf(l), j = i + dir;
    if (!l || j < 0 || j >= layers().length) return;
    layers().splice(i, 1);
    layers().splice(j, 0, l);
    changed();
  };
  ui.upBtn.addEventListener('click', () => move(+1));
  ui.downBtn.addEventListener('click', () => move(-1));

  ui.layerTitle.addEventListener('input', () => {
    const l = selected();
    if (!l) return;
    l.title = ui.layerTitle.value;
    showLayerName(l);
    changed({ look: false });
  });
  ui.layerTitle.addEventListener('blur', () => {
    const l = selected();
    if (l && !l.title.trim()) { l.title = ui.layerTitle.value = 'Layer'; changed({ look: false }); }
  });

  function toggleGroup(id, checked) {
    const l = selected();
    if (!l) return;
    const set = new Set(l.groups);
    if (checked) set.add(id); else set.delete(id);
    if (!set.size) toast('A layer needs at least one group. Tick another group first.', { kind: 'warn' });
    else l.groups = [...set];
    groupsTree().setLayer(l);
    if (!set.size) return;
    ui.playsOn.textContent = groupNames(l.groups);
    changed();
  }

  return { insertLayer, toggleGroup };
}
