// HTTP API client (SPEC "HTTP API"): JSON in and out, cookie session. A non-2xx response throws an ApiError with the
// server's message and `status` (0: the server could not be reached).
import type {
  Bake, BakeMode, BakingState, FlashSettings, Listed, Look, LookCreate, LookPatch, ServerStats, User, Version,
  VersionListed,
} from '../../shared/schemas/api.ts';
import type { LightSettings } from '../../shared/schemas/light.ts';
import type { ReportBody, ReportSummary } from '../../shared/schemas/report.ts';
import type { LibraryEntry } from '../../shared/schemas/rig.ts';
import type { Tour } from '../../shared/schemas/tour.ts';

export type ApiError = Error & { status: number; data?: unknown };
const fail = (message: string, status: number, extra = {}): ApiError => Object.assign(new Error(message), { status },
  extra);
/** An error's HTTP status (0 when it has none). */
export const statusOf = (err: unknown) => (err as Partial<ApiError>)?.status ?? 0;

// Where a 401 still means "not signed in" to the caller, not "the session ended".
const SESSIONLESS = new Set(['/api/me', '/api/login', '/api/signup', '/api/guest']);
let signedOut = () => {};
/** What a 401 from any other call does (session.ts sends the person to sign in). That call then never settles,
 * so no view shows the refusal as an error on its way out. */
export function onSignedOut(fn: () => void) { signedOut = fn; }

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (method !== 'GET') {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body ?? {});
  }
  const res = await fetch(path, init).catch((cause) => {
    throw fail('Could not reach the server. Check your connection and try again.', 0, { cause });
  });
  const text = await res.text();
  let data: { error?: unknown } | null = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (res.status === 401 && !SESSIONLESS.has(path)) {
    signedOut();
    return new Promise<T>(() => {});
  }
  if (!res.ok) {
    const msg = typeof data?.error === 'string' && data.error ? data.error
      : `${res.status} ${res.statusText || 'error'}`;
    throw fail(msg.trim(), res.status, { data });
  }
  return (data ?? {}) as T;
}

const enc = encodeURIComponent;
type Me = { user: User, flash?: FlashSettings, profile?: 'hosted' | 'pi' };
/** Playing on the lights (SPEC-offline): what may play, and how one look would (`play`, when asked about one). */
export type Lights = { liveLooks: boolean, mode: 'jukebox' | 'live', canQueue: boolean, canDrive: boolean,
  engine: boolean,
  play?: { kind: 'live' | 'baked', error?: undefined } | { kind?: undefined, error: string } };
export type At = 'now' | 'next' | 'end';
/** A look as the live page offers it (SPEC-offline `GET /api/lights/looks`). */
export type LightsLook = { id: string, title: string, ownerName: string, duration: number, preview?: string,
  play: { kind: 'live' | 'baked' } | { error: string } };

export const api = {
  me: () => request<Partial<Me>>('GET', '/api/me'),
  signup: (username: string, password: string) => request<Me>('POST', '/api/signup', { username, password }),
  login: (username: string, password: string) => request<Me>('POST', '/api/login', { username, password }),
  guest: (name: string) => request<Me>('POST', '/api/guest', { name }),
  logout: () => request('POST', '/api/logout', {}),
  saveTour: (tour: Tour) => request<{ tour: Tour }>('PUT', '/api/me/tour', tour),

  light: () => request<LightSettings>('GET', '/api/light'),
  saveLight: (light: LightSettings) => request<LightSettings>('PUT', '/api/admin/light', light),
  lights: (lookId?: string) => request<Lights>('GET', `/api/lights${lookId ? `?lookId=${enc(lookId)}` : ''}`),
  playOnLights: (lookId: string, at: At, fade?: number) => request<{ kind: 'live' | 'baked' }>('POST',
    '/api/lights/queue', { lookId, at, ...fade ? { fade } : {} }),
  lightsLooks: (from: 'mine' | 'gallery') => request<{ looks: LightsLook[] }>('GET', `/api/lights/looks?from=${from}`),
  saveLights: (change: Partial<Pick<Lights, 'liveLooks' | 'mode'>>) => request<Lights>('PUT', '/api/admin/lights',
    change),

  looks: (scope: 'mine' | 'gallery' = 'mine') => request<{ looks?: Listed[] }>('GET',
    `/api/looks?scope=${enc(scope)}`),
  look: (id: string) => request<{ look: Look }>('GET', `/api/looks/${enc(id)}`),
  createLook: (look: LookCreate) => request<{ look: Look, imported?: 'added' | 'updated' | 'unchanged' }>('POST',
    '/api/looks', look),
  updateLook: (id: string, patch: LookPatch) => request<{ look: Look }>('PUT', `/api/looks/${enc(id)}`, patch),
  deleteLook: (id: string) => request('DELETE', `/api/looks/${enc(id)}`),
  /** One's own look's versions, newest first (SPEC-history), and one with its content. */
  versions: (id: string) => request<{ versions: VersionListed[] }>('GET', `/api/looks/${enc(id)}/versions`),
  version: (id: string, n: number) => request<{ version: Version }>('GET', `/api/looks/${enc(id)}/versions/${n}`),
  /** Names version `n` (it is kept), or unnames it (`null`). */
  nameVersion: (id: string, n: number, name: string | null) =>
    request<{ version: VersionListed }>('PUT', `/api/looks/${enc(id)}/versions/${n}`, { name }),
  bake: (id: string) => request<{ bake: Bake }>('POST', `/api/looks/${enc(id)}/bake`, {}),

  liveLooks: () => request<{ looks: Listed[] }>('GET', '/api/live/looks'),

  /** An F8 bug report (SPEC "Bug reports"); 413 when it is too big. */
  report: (report: ReportBody) => request<{ id: string }>('POST', '/api/reports', report),
  reports: () => request<{ reports: ReportSummary[] }>('GET', '/api/admin/reports'),
  bugReport: (id: string) => request<{ report: ReportBody & Record<string, unknown> }>('GET',
    `/api/admin/reports/${enc(id)}`),

  library: () => request<{ patterns?: LibraryEntry[] }>('GET', '/api/library'),
  /** The bake setting and the render box here (SPEC "Baked frames"); admins change the setting. */
  baking: () => request<BakingState>('GET', '/api/baking'),
  saveBaking: (body: { mode?: BakeMode, customCode?: boolean }) => request<BakingState>('PUT', '/api/admin/baking',
    body),
  /** Visits, requests and the server since it started (SPEC-access "Stats"); admins only. */
  stats: () => request<ServerStats>('GET', '/api/admin/stats'),
  /** The Pi bundle this server holds (SPEC-offline "Downloading the Pi bundle"), and a curl link to it. */
  piBundle: () => request<{ commit: string, bytes: number, builtAt: string }>('GET', '/api/pi-bundle/info'),
  piBundleLink: () => request<{ path: string, expires: string }>('POST', '/api/pi-bundle/link'),
};

/** Static JSON (not under /api): the rig, the palettes. */
export async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return res.json() as Promise<T>;
}
