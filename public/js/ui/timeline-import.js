// "Import look…": pick one of my looks or a gallery look to play after this one. The timeline
// does the sequencing (Timeline.importLook); this is only the picker.
import { api } from '../api.js';
import { clear, h, openDialog } from './dom.js';
import { clock, DEFAULT_DURATION } from './timeline-model.js';

const SCOPES = [{ id: 'mine', label: 'My looks' }, { id: 'gallery', label: 'Gallery' }];

// importLookDialog({ currentId (listed last: importing it repeats it), onPick(look) → error | '', signedOut() })
export function importLookDialog({ currentId, onPick, signedOut }) {
  return openDialog({ title: 'Import a look', className: 'import-dialog', build(close) {
    const list = h('ul', { class: 'library-list import-list', 'aria-live': 'polite' });
    const status = h('p', { class: 'import-status', role: 'status' });
    const cache = new Map();
    const tabs = SCOPES.map((s) => h('button', { type: 'button', class: 'tab import-tab', dataset: { scope: s.id },
      text: s.label, 'aria-pressed': 'false', onClick: () => show(s.id) }));

    async function show(scope) {
      for (const t of tabs) t.setAttribute('aria-pressed', String(t.dataset.scope === scope));
      status.textContent = '';
      clear(list).append(h('li', { class: 'pane-hint', text: 'Loading…' }));
      let looks = cache.get(scope);
      try {
        if (!looks) cache.set(scope, looks = (await api.looks(scope)).looks || []);
      } catch (err) {
        if (err.status === 401) { close(false); signedOut(); return; }
        clear(list).append(h('li', { class: 'pane-hint', text: err.message }));
        return;
      }
      clear(list);
      const sorted = looks.filter((l) => l.id !== currentId).concat(looks.filter((l) => l.id === currentId));
      const none = scope === 'mine' ? 'You have no saved looks yet.' : 'The gallery is empty.';
      if (!sorted.length) list.append(h('li', { class: 'pane-hint', text: none }));
      for (const look of sorted) {
        const n = look.layerCount ?? (look.layers || []).length;     // lists carry metadata only
        const meta = `${n} layer${n === 1 ? '' : 's'} · ${clock(look.duration || DEFAULT_DURATION)}`
          + `${look.id === currentId ? ' · this look (saved version)' : ''}`
          + `${scope === 'gallery' && look.ownerName ? ` · by ${look.ownerName}` : ''}`;
        list.append(h('li', {}, h('button', { type: 'button', class: 'library-item', onClick: () => pick(look) },
          h('span', { class: 'library-title', text: look.title || 'Untitled look' }),
          h('span', { class: 'library-summary', text: meta }))));
      }
    }

    async function pick(look) {
      let full;
      try {
        ({ look: full } = await api.look(look.id));
      } catch (err) {
        if (err.status === 401) { close(false); signedOut(); return; }
        status.textContent = err.message;
        return;
      }
      const error = onPick(full);
      if (error) status.textContent = error; else close(true);
    }

    show('mine');
    return [
      h('p', { class: 'dialog-text', text: 'Its layers are added to this look, each with a clip that starts where '
        + 'this look’s content ends. Layers here that play throughout end there, so the two follow each other.' }),
      h('div', { class: 'import-tabs', role: 'group', 'aria-label': 'Which looks' }, tabs), list, status,
    ];
  } });
}
