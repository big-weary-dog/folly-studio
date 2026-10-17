// Folly Studio — app bootstrap: session, header, history-API routing.
import { api } from './api.js';
import { clear, confirmDialog, toast } from './ui/dom.js';
import { rose } from './ui/rose.js';
// Views load on first use, so the login and list pages never fetch the Studio's 3D code.
const auth = () => import('./ui/auth.js');
const looks = () => import('./ui/looks.js');
const ROUTES = [
  { re: /^\/login\/?$/, load: auth, public: true, title: 'Sign in' },
  { re: /^\/ideas\/?$/, load: () => import('./ui/ideas.js'), nav: '/ideas', title: 'Ideas' },
  { re: /^\/studio(?:\/([^/]+))?\/?$/, load: () => import('./ui/studio.js'), nav: '/studio', title: 'Studio', keys: ['lookId'] },
  { re: /^\/looks\/?$/, load: looks, nav: '/looks', title: 'My looks', args: { scope: 'mine' } },
  { re: /^\/gallery\/?$/, load: looks, nav: '/gallery', title: 'Gallery', args: { scope: 'gallery' } },
];

const app = {
  user: null,
  current: null,      // { route, instance }
  url: null,
};

const main = document.getElementById('main');
let renders = 0;
const header = document.getElementById('app-header');
// The rose: the brand mark, and the loader while the first view loads.
document.getElementById('brand-mark')?.append(rose());
document.getElementById('boot-msg')?.prepend(rose({ detail: 'full', className: 'rose-loader' }));

function match(pathname) {
  for (const r of ROUTES) {
    const m = r.re.exec(pathname);
    if (m) {
      const params = {};
      (r.keys || []).forEach((k, i) => { if (m[i + 1]) params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
  }
  return null;
}

function ctxFor(route, params) {
  return {
    user: app.user,
    params,
    query: new URLSearchParams(location.search),
    args: route.args || {},
    navigate,
    setUser,
    /** Call when an API call says 401: back to the login screen. */
    signedOut() {
      app.user = null;
      renderHeader();
      navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true, force: true });
    },
    setTitle(t) { document.title = t ? `${t} · Folly Studio` : 'Folly Studio'; },
    /** Change the address bar without re-rendering (e.g. a new look got its id). */
    replaceUrl(path) {
      history.replaceState(null, '', path);
      app.url = location.pathname + location.search;
    },
  };
}

async function render() {
  const path = location.pathname;
  if (path === '/' || path === '') {
    history.replaceState(null, '', app.user ? '/ideas' : '/login');
    return render();
  }
  let found = match(path);
  if (!found) {
    history.replaceState(null, '', '/ideas');
    found = match('/ideas');
  }
  const { route, params } = found;
  if (!route.public && !app.user) {
    history.replaceState(null, '', `/login?next=${encodeURIComponent(path + location.search)}`);
    return render();
  }
  if (route.public && app.user) {
    const next = new URLSearchParams(location.search).get('next');
    history.replaceState(null, '', safeNext(next));
    return render();
  }

  let view;
  const token = ++renders;
  try {
    view = await route.load();
  } catch (err) {
    toast(`Could not load this page: ${err.message}`, { kind: 'error', timeout: 0 });
    return;
  }
  if (token !== renders) return;          // a newer navigation won the race

  // tear down the old view
  if (app.current?.instance?.unmount) {
    try { app.current.instance.unmount(); } catch (err) { console.error(err); }
  }
  app.current = null;
  clear(main);
  main.className = `view view-${route.nav ? route.nav.slice(1) : 'auth'}`;
  document.body.dataset.view = route.nav ? route.nav.slice(1) : 'auth';
  document.title = `${route.title} · Folly Studio`;
  renderHeader(route);

  const ctx = ctxFor(route, params);
  const instance = view.mount(main, ctx) || {};
  app.current = { route, instance };
  app.url = location.pathname + location.search;
}

function safeNext(next) {
  if (next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login')) return next;
  return '/ideas';
}

async function canLeave() {
  const inst = app.current?.instance;
  if (inst?.isDirty?.()) {
    return confirmDialog('You have unsaved changes in the Studio. Leave without saving?', {
      title: 'Unsaved changes', ok: 'Leave', danger: true,
    });
  }
  return true;
}

export async function navigate(to, { replace = false, force = false } = {}) {
  const url = new URL(to, location.origin);
  const target = url.pathname + url.search;
  if (!force && target === app.url && !replace) return;
  if (!force && !(await canLeave())) return;
  if (app.current?.instance?.isDirty) app.current.instance.discard?.();
  history[replace ? 'replaceState' : 'pushState'](null, '', target);
  await render();
  if (!replace) main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function setUser(user) {
  app.user = user;
  renderHeader(app.current?.route);
}

function renderHeader(route) {
  const user = app.user;
  header.hidden = !user;
  if (!user) return;
  const nameEl = document.getElementById('user-name');
  nameEl.textContent = user.username;
  const role = document.getElementById('user-role');
  role.hidden = user.role !== 'curator';
  for (const a of header.querySelectorAll('.main-nav a')) {
    const active = route && route.nav === a.getAttribute('href');
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

// ---- global wiring ----------------------------------------------------------------------

document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a || a.target || a.hasAttribute('download') || a.dataset.native != null) return;
  const href = a.getAttribute('href');
  if (!href || !href.startsWith('/') || href.startsWith('//') || href.startsWith('/api/')) return;
  e.preventDefault();
  navigate(href);
});

window.addEventListener('popstate', async () => {
  const inst = app.current?.instance;
  if (inst?.isDirty?.()) {
    const wanted = location.pathname + location.search;
    history.pushState(null, '', app.url);       // stay put until the user decides
    if (!(await canLeave())) return;
    inst.discard?.();
    history.pushState(null, '', wanted);
  }
  render();
});

window.addEventListener('beforeunload', (e) => {
  if (app.current?.instance?.isDirty?.()) { e.preventDefault(); e.returnValue = ''; }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  if (!(await canLeave())) return;
  app.current?.instance?.discard?.();
  try { await api.logout(); } catch (err) { toast(err.message, { kind: 'error' }); }
  app.user = null;
  navigate('/login', { force: true, replace: true });
});

const menuBtn = document.getElementById('nav-toggle');
if (menuBtn) {
  menuBtn.addEventListener('click', () => {
    const open = header.classList.toggle('nav-open');
    menuBtn.setAttribute('aria-expanded', String(open));
  });
  const closeNav = () => { header.classList.remove('nav-open'); menuBtn.setAttribute('aria-expanded', 'false'); };
  header.addEventListener('click', (e) => { if (e.target.closest('.main-nav a, #logout-btn')) closeNav(); });
  document.addEventListener('click', (e) => { if (!header.contains(e.target)) closeNav(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && header.classList.contains('nav-open')) { closeNav(); menuBtn.focus(); }
  });
}

async function boot() {
  try {
    const { user } = await api.me();
    app.user = user || null;
  } catch (err) {
    app.user = null;
    if (err.status !== 401 && err.status !== 403) toast(err.message, { kind: 'error' });
  }
  document.body.classList.remove('booting');
  await render();
}

boot();
