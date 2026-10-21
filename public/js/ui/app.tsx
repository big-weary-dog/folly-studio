// The app shell: the session, history-API routing (views load on first use, so the login and list pages never fetch
// the Studio's 3D code), the header, and the guard that keeps unsaved Studio edits from being lost.
import { signal } from '@preact/signals';
import type { ComponentType } from 'preact';
import { useLayoutEffect, useState } from 'preact/hooks';

import { api, statusOf } from '../api.ts';
import { can } from '../../../shared/policy.ts';
import type { User } from '../../../shared/schemas/api.ts';
import { confirmDialog, cx, toast, Toasts } from './kit.tsx';
import { fileBugReport } from './bug-report.tsx';
import { Rose } from './rose.tsx';
import { openTour, welcomeOnce } from './tour-view.ts';
import { redeemInvite, takeInvite } from './invite.ts';
import { flash, here, home, leaveGuard, navigate, onPi, profile, router, setTitle, user, type ViewProps }
  from './session.ts';

interface Route {
  re: RegExp; name: string; title: string; load: () => Promise<ComponentType<ViewProps>>; public?: boolean;
  nav?: string; keys?: string[]; scope?: 'mine' | 'gallery';
}
const pages = () => import('./pages.tsx');
/** An admin page, under the Admin tabs. */
const adminTab = (tab: string, load: Route['load']) => () => Promise.all([import('./admin.tsx'), load()])
  .then(([m, Page]) => m.withTabs(Page, tab));
// /admin opens its first tab; the admin pages' old URLs lead to theirs.
const MOVED: Record<string, string> = { '/admin': '/admin/models', '/models': '/admin/models',
  '/access': '/admin/access', '/light': '/admin/light', '/reports': '/admin/reports' };
const ROUTES: Route[] = [
  { re: /^\/login\/?$/, name: 'auth', title: 'Sign in', public: true,
    load: () => import('./auth.tsx').then((m) => m.Auth) },
  { re: /^\/ideas\/?$/, name: 'ideas', title: 'Ideas', nav: '/ideas', load: () => pages().then((m) => m.Ideas) },
  { re: /^\/studio(?:\/([^/]+))?\/?$/, name: 'studio', title: 'Studio', nav: '/studio', keys: ['lookId'],
    load: () => import('./studio.tsx').then((m) => m.Studio) },
  { re: /^\/looks\/?$/, name: 'looks', title: 'My looks', nav: '/looks', scope: 'mine',
    load: () => pages().then((m) => m.Looks) },
  { re: /^\/gallery\/?$/, name: 'gallery', title: 'Gallery', nav: '/gallery', scope: 'gallery',
    load: () => pages().then((m) => m.Looks) },
  { re: /^\/live\/?$/, name: 'live', title: 'Live', nav: '/live',
    load: () => import('./live/live.tsx').then((m) => m.LivePage) },
  { re: /^\/live\/control\/?$/, name: 'live-control', title: 'Live control', nav: '/live',
    load: () => import('./live/control.tsx').then((m) => m.ControlPage) },
  { re: /^\/admin\/models\/?$/, name: 'models', title: 'Models', nav: '/admin',
    load: adminTab('models', () => import('./models.tsx').then((m) => m.Models)) },
  { re: /^\/admin\/access\/?$/, name: 'access', title: 'Access', nav: '/admin',
    load: adminTab('access', () => import('./access.tsx').then((m) => m.AccessPage)) },
  { re: /^\/admin\/light\/?$/, name: 'light', title: 'Light', nav: '/admin',
    load: adminTab('light', () => import('./light.tsx').then((m) => m.LightPage)) },
  { re: /^\/admin\/reports\/?$/, name: 'reports', title: 'Reports', nav: '/admin',
    load: adminTab('reports', () => import('./reports.tsx').then((m) => m.ReportsPage)) },
];

/** Where to go after signing in: `next` when it is a page of this app, else home. */
export const safeNext = (next: string | null) => (next && next.startsWith('/') && !next.startsWith('//')
  && !next.startsWith('/login') ? next : home());
/** On the Pi (SPEC-offline), the pages of what it does not run lead elsewhere. */
const PI_MOVED: Record<string, string> = { '/ideas': '/looks', '/admin': '/admin/light',
  '/admin/models': '/admin/light', '/admin/access': '/admin/light' };

/** Where a path leads: a redirect, or a route and its params. */
export function resolve(path: string, search: string, signedIn: boolean):
  { redirect: string } | { route: Route; params: Record<string, string> } {
  if (path === '/' || path === '') return { redirect: signedIn ? home() : '/login' };
  const bare = path.replace(/\/$/, ''), moved = (onPi() && PI_MOVED[bare]) || MOVED[bare];
  if (moved) return { redirect: moved + search };
  for (const route of ROUTES) {
    const m = route.re.exec(path);
    if (!m) continue;
    if (!route.public && !signedIn) return { redirect: `/login?next=${encodeURIComponent(path + search)}` };
    if (route.public && signedIn) return { redirect: safeNext(new URLSearchParams(search).get('next')) };
    const params: Record<string, string> = {};
    (route.keys || []).forEach((k, i) => { if (m[i + 1]) params[k] = decodeURIComponent(m[i + 1]); });
    return { route, params };
  }
  return { redirect: home() };
}

const current = signal<{ route: Route; props: ViewProps; View: ComponentType<ViewProps>; key: number } | null>(null);
let renders = 0;

async function show() {
  const found = resolve(location.pathname, location.search, !!user.value);
  if ('redirect' in found) { history.replaceState(null, '', found.redirect); return show(); }
  const { route, params } = found;
  const token = ++renders;
  const View = await route.load().catch((err) => {
    toast(`Could not load this page: ${err.message}`, { kind: 'error', timeout: 0 });
  });
  if (!View || token !== renders) return;          // a newer navigation won the race
  setTitle(route.title);
  document.body.dataset.view = route.nav?.slice(1) || 'auth';
  current.value = { route, View, key: token,
    props: { params, query: new URLSearchParams(location.search), scope: route.scope } };
  router.shown = here();
}

async function canLeave() {
  if (!leaveGuard.isDirty?.()) return true;
  return confirmDialog('You have unsaved changes in the Studio. Leave without saving?',
    { title: 'Unsaved changes', ok: 'Leave', danger: true });
}

router.go = async (to, { replace = false, force = false }) => {
  const url = new URL(to, location.origin), target = url.pathname + url.search;
  if (!force && target === router.shown && !replace) return;
  if (!force && !(await canLeave())) return;
  leaveGuard.discard?.();
  history[replace ? 'replaceState' : 'pushState'](null, '', target);
  await show();
  if (!replace) document.getElementById('main')?.focus({ preventScroll: true });
  window.scrollTo(0, 0);
};

async function logout() {
  if (!(await canLeave())) return;
  leaveGuard.discard?.();
  try { await api.logout(); } catch (err) { toast((err as Error).message, { kind: 'error' }); }
  user.value = null;
  navigate('/login', { force: true, replace: true });
}

const NAV = [['/ideas', 'Ideas'], ['/studio', 'Studio'], ['/looks', 'My looks'], ['/gallery', 'Gallery'],
  ['/live', 'Live']];
const ADMIN_NAV = [...NAV, ['/admin', 'Admin']];
/** The header's links: no Ideas on the Pi, where curators have the engine's control page (SPEC-offline). */
function navOf(me: User) {
  const nav = can(me, 'admin') ? ADMIN_NAV : NAV;
  return onPi() ? [...nav.filter(([href]) => href !== '/ideas'), ...(can(me, 'curate') ? [['/pi/', 'Lights']] : [])]
    : nav;
}

/** The user menu drops under its button at a desktop's width; on a phone it sits open in the nav panel. */
function placeUserMenu(e: { newState: string; currentTarget: HTMLElement }) {
  const r = document.getElementById('user-menu-btn')?.getBoundingClientRect();
  if (e.newState === 'open' && r) {
    Object.assign(e.currentTarget.style, { top: `${r.bottom + 6}px`, right: `${innerWidth - r.right}px` });
  }
}

function Header({ me, nav }: { me: User; nav?: string }) {
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    if (!open) return undefined;
    const outside = (e: MouseEvent) => { if (!(e.target as Element).closest?.('.app-header')) setOpen(false); };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); document.getElementById('nav-toggle')?.focus(); }
    };
    document.addEventListener('click', outside);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('click', outside); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <header class={cx('app-header', open && 'nav-open')} id="app-header">
      <a class="brand" href={home()} aria-label="Folly Studio home">
        <span class="brand-mark"><Rose /></span>
        <svg class="wordmark" aria-hidden="true"><use href="#wordmark" /></svg>
      </a>
      <button class="nav-toggle" id="nav-toggle" type="button" aria-expanded={open} aria-controls="nav-panel"
        onClick={() => setOpen(!open)}>
        <span class="sr-only">Menu</span><span class="nav-toggle-bars" aria-hidden="true" />
      </button>
      <div class="nav-panel" id="nav-panel" onClick={(e) => {
        if ((e.target as Element).closest('a, .btn')) setOpen(false);
      }}>
        <nav class="main-nav" aria-label="Main">
          {navOf(me).map(([href, text]) => <a href={href} data-native={href === '/pi/' ? '' : undefined}
            data-tour={`nav:${href.slice(1)}`} aria-current={nav === href ? 'page' : undefined}>{text}</a>)}
        </nav>
        <div class="user-box">
          <span class="user-name">{me.username}</span>
          <button class="user-menu-btn" id="user-menu-btn" type="button" popovertarget="user-menu"
            aria-haspopup="menu" data-tour="user-menu"><span class="user-name">{me.username}</span></button>
          {me.role === 'admin' ? <span class="tag tag-sapphire">Admin</span>
            : me.role === 'curator' && <span class="tag tag-amber">Curator</span>}
          <div class="user-menu" id="user-menu" popover="auto" onBeforeToggle={placeUserMenu}
            onClick={(e) => { if ((e.target as Element).closest('.btn')) e.currentTarget.hidePopover?.(); }}>
            <button class="btn ghost small" type="button" onClick={() => openTour('menu')}>Tutorials</button>
            <button class="btn ghost small report-btn" type="button" title="Report a problem (F8)" data-tour="report"
              onClick={() => { setOpen(false); void fileBugReport(); }}>Report a problem</button>
            <button class="btn ghost small" type="button" onClick={logout}>Log out</button>
          </div>
        </div>
      </div>
    </header>);
}

export function App() {
  const cur = current.value, name = cur ? cur.route.nav?.slice(1) || 'auth' : null;
  return <>
    {user.value && <Header me={user.value} nav={cur?.route.nav} />}
    <main id="main" tabindex={-1} class={name ? `view view-${name}` : undefined}>
      {cur ? <cur.View key={cur.key} {...cur.props} />
        : <div class="boot-msg" aria-live="polite"><Rose detail="full" class="rose-loader" />Lighting the candles…
        </div>}
    </main>
    <Toasts />
  </>;
}

/** Links to our own pages go through the router; history moves re-route, asking first when edits would be lost. */
export async function boot() {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || a.target || a.hasAttribute('download') || a.dataset.native != null) return;
    const href = a.getAttribute('href') || '';
    if (!href.startsWith('/') || href.startsWith('//') || href.startsWith('/api/')) return;
    e.preventDefault();
    navigate(href);
  });
  window.addEventListener('popstate', async () => {
    if (leaveGuard.isDirty?.()) {
      const wanted = here();
      history.pushState(null, '', router.shown);   // stay put until the user decides
      if (!(await canLeave())) return;
      leaveGuard.discard?.();
      history.pushState(null, '', wanted);
    }
    show();
  });
  window.addEventListener('beforeunload', (e) => { if (leaveGuard.isDirty?.()) e.preventDefault(); });
  takeInvite();
  try {
    const me = await api.me();
    user.value = me.user || null;
    flash.value = me.flash ?? null;
    profile.value = me.profile ?? 'hosted';
  } catch (err) {
    if (statusOf(err) !== 401 && statusOf(err) !== 403) toast((err as Error).message, { kind: 'error' });
  }
  if (user.value && !onPi()) await redeemInvite();
  document.body.classList.remove('booting');
  await show();
  welcomeOnce(user.value);
}
