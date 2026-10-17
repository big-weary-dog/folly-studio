// My looks and the Gallery: cards that open in the Studio.
import { api } from '../api.js';
import { h, clear, confirmDialog, jewelGradient, stylesheet, timeAgo, toast } from './dom.js';

await stylesheet('/css/gallery.css');

export function mount(root, ctx) {
  const scope = ctx.args.scope === 'gallery' ? 'gallery' : 'mine';
  const isGallery = scope === 'gallery';
  ctx.setTitle(isGallery ? 'Gallery' : 'My looks');
  let alive = true, looks = [];
  const grid = h('ul', { class: 'card-grid', 'aria-busy': 'true' });
  const empty = h('div', { class: 'empty', hidden: true });
  const filter = h('input', { type: 'search', class: 'search', 'aria-label': 'Search looks',
    placeholder: isGallery ? 'Search the gallery' : 'Search my looks' });

  root.append(h('div', { class: 'page looks-page' },
    h('div', { class: 'section-head page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: isGallery ? 'Gallery' : 'My looks' }),
        h('p', { class: 'lede', text: isGallery
          ? 'Looks people have shared. Open one to watch it; edit it and Save makes it your own copy.'
          : 'Everything you have saved. Share one to put it in the gallery.' })),
      h('div', { class: 'head-actions' }, filter,
        isGallery ? null : h('a', { class: 'btn primary', href: '/studio', text: 'New look' }))),
    grid, empty));

  filter.addEventListener('input', draw);

  function draw() {
    clear(grid);
    grid.setAttribute('aria-busy', 'false');
    const q = filter.value.trim().toLowerCase();
    const shown = looks.filter((l) => !q
      || `${l.title} ${l.summary || ''} ${l.ownerName || ''}`.toLowerCase().includes(q));
    if (!looks.length) {
      clear(empty).append(isGallery
        ? h('p', { text: 'Nothing shared yet. Open one of your looks in the Studio and switch on '
          + '“Share to gallery”.' })
        : h('p', {}, 'No saved looks yet. ', h('a', { href: '/ideas', text: 'Describe an idea' }), ' or ',
          h('a', { href: '/studio', text: 'start a blank look' }), '.'));
    } else if (!shown.length) {
      clear(empty).append(h('p', { text: 'No looks match that search.' }));
    }
    empty.hidden = shown.length > 0;
    for (const look of shown) grid.append(card(look));
  }

  function card(look) {
    const layers = Array.isArray(look.layers) ? look.layers.length : 0;
    const mine = ctx.user && look.owner === ctx.user.id;
    const art = h('div', { class: 'card-art', 'aria-hidden': 'true' });
    art.style.setProperty('--art', jewelGradient(look.id + look.title));
    const href = `/studio/${encodeURIComponent(look.id)}`;
    const actions = h('div', { class: 'card-actions' }, h('a', { class: 'btn small', href, text: 'Open' }));
    if (mine && !isGallery) {
      actions.append(h('button', { class: 'btn small ghost danger-text', type: 'button', text: 'Delete',
        'aria-label': `Delete ${look.title}`, onClick: () => remove(look) }));
    }
    return h('li', { class: 'card' }, art,
      h('div', { class: 'card-body' },
        h('h2', { class: 'card-title' }, h('a', { href, text: look.title || 'Untitled look' })),
        look.summary ? h('p', { class: 'card-summary', text: look.summary }) : null,
        h('div', { class: 'card-meta' },
          isGallery ? h('span', { class: 'meta-item', text: `by ${look.ownerName || 'someone'}` }) : null,
          h('span', { class: 'meta-item', text: `${layers} layer${layers === 1 ? '' : 's'}` }),
          h('time', { class: 'meta-item', datetime: look.updatedAt || '',
            text: timeAgo(look.updatedAt || look.createdAt) }),
          look.shared && !isGallery ? h('span', { class: 'tag tag-sapphire', text: 'Shared' }) : null,
          look.reviewed ? h('span', { class: 'tag tag-emerald', text: 'Reviewed' }) : null)),
      actions);
  }

  async function remove(look) {
    const ok = await confirmDialog(`Delete “${look.title}”? This cannot be undone.`,
      { title: 'Delete look', ok: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.deleteLook(look.id);
      looks = looks.filter((l) => l.id !== look.id);
      draw();
      toast('Look deleted.');
    } catch (err) {
      if (err.status === 401) return ctx.signedOut();
      toast(err.message, { kind: 'error' });
    }
  }

  api.looks(scope).then((res) => {
    if (!alive) return;
    looks = Array.isArray(res.looks) ? res.looks : [];
    const when = (l) => Date.parse(l.updatedAt || l.createdAt || 0);
    looks.sort((a, b) => when(b) - when(a));
    draw();
  }).catch((err) => {
    if (err.status === 401) return ctx.signedOut();
    grid.setAttribute('aria-busy', 'false');
    clear(empty).append(h('p', { class: 'form-error', text: err.message }));
    empty.hidden = false;
  });

  return { unmount() { alive = false; } };
}
