// HTTP API client (SPEC "HTTP API"): JSON in and out, cookie session. A non-2xx response throws an ApiError with the
// server's message and `status` (0: the server could not be reached).
import type {
  Bake, Explore, FlashSettings, Idea, Listed, Look, LookCreate, LookPatch, User,
} from '../../shared/schemas/api.ts';
import type { Access, Invite, Person, PersonLimits } from '../../shared/schemas/access.ts';
import type { LightSettings } from '../../shared/schemas/light.ts';
import type { AdminModels, ModelChoices, ModelsConfig } from '../../shared/schemas/models.ts';
import type { ReportBody, ReportSummary } from '../../shared/schemas/report.ts';
import type { LibraryEntry } from '../../shared/schemas/rig.ts';

export type ApiError = Error & { status: number; data?: unknown };
const fail = (message: string, status: number, extra = {}): ApiError => Object.assign(new Error(message), { status },
  extra);
/** An error's HTTP status (0 when it has none). */
export const statusOf = (err: unknown) => (err as Partial<ApiError>)?.status ?? 0;

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
  if (!res.ok) {
    const msg = typeof data?.error === 'string' && data.error ? data.error
      : `${res.status} ${res.statusText || 'error'}`;
    throw fail(msg.trim(), res.status, { data });
  }
  return (data ?? {}) as T;
}

const enc = encodeURIComponent;
type Me = { user: User, flash?: FlashSettings, access?: Access };

export const api = {
  me: () => request<Partial<Me>>('GET', '/api/me'),
  signup: (username: string, password: string) => request<Me>('POST', '/api/signup', { username, password }),
  login: (username: string, password: string) => request<Me>('POST', '/api/login', { username, password }),
  logout: () => request('POST', '/api/logout', {}),

  ideas: () => request<{ ideas?: Idea[] }>('GET', '/api/ideas'),
  /** `wait`: the idea's `status@updatedAt` as last seen; the server answers when that changes (or after 25 s). */
  idea: (id: string, wait?: string) => request<{ idea?: Idea }>('GET',
    `/api/ideas/${enc(id)}${wait ? `?wait=${enc(wait)}` : ''}`),
  createIdea: (text: string, model?: string, explore?: Explore) => request<{ idea: Idea }>('POST', '/api/ideas',
    { text, model, explore }),
  models: () => request<ModelChoices>('GET', '/api/models'),
  /** Redeem an invite code: the account's access once unlocked. */
  redeem: (code: string) => request<{ access: Access }>('POST', '/api/invite', { code }),
  invites: () => request<{ invites: Invite[] }>('GET', '/api/admin/invites'),
  createInvite: (body: { label?: string, uses?: number, days?: number }) => request<{ invite: Invite, code: string }>(
    'POST', '/api/admin/invites', body),
  revokeInvite: (id: string) => request<{ invite: Invite }>('DELETE', `/api/admin/invites/${enc(id)}`),
  people: () => request<{ people: Person[] }>('GET', '/api/admin/people'),
  updatePerson: (id: string, patch: { unlocked?: boolean, limits?: PersonLimits | null, reset?: true }) =>
    request<{ person: Person }>('PUT', `/api/admin/people/${enc(id)}`, patch),
  adminModels: () => request<AdminModels>('GET', '/api/admin/models'),
  saveModels: (config: ModelsConfig) => request<AdminModels>('PUT', '/api/admin/models', config),
  light: () => request<LightSettings>('GET', '/api/light'),
  saveLight: (light: LightSettings) => request<LightSettings>('PUT', '/api/admin/light', light),

  looks: (scope: 'mine' | 'gallery' = 'mine') => request<{ looks?: Listed[] }>('GET',
    `/api/looks?scope=${enc(scope)}`),
  look: (id: string) => request<{ look: Look }>('GET', `/api/looks/${enc(id)}`),
  createLook: (look: LookCreate) => request<{ look: Look }>('POST', '/api/looks', look),
  updateLook: (id: string, patch: LookPatch) => request<{ look: Look }>('PUT', `/api/looks/${enc(id)}`, patch),
  deleteLook: (id: string) => request('DELETE', `/api/looks/${enc(id)}`),
  /** A refinement undone: its look was put back (SPEC-generators "Refine history"). */
  undoRefine: (id: string) => request<{ idea: Idea }>('POST', `/api/ideas/${enc(id)}/undo`),
  /** A refinement of one's own look (SPEC-generators "Refine"): its idea, to follow with idea(). */
  refine: (id: string, body: { text?: string, model?: string, critique?: true,
    fix?: { layer: string, error: string } }) => request<{ idea: Idea }>('POST', `/api/looks/${enc(id)}/refine`, body),
  bake: (id: string) => request<{ bake: Bake }>('POST', `/api/looks/${enc(id)}/bake`, {}),

  liveLooks: () => request<{ looks: Listed[] }>('GET', '/api/live/looks'),

  /** An F8 bug report (SPEC "Bug reports"); 413 when it is too big. */
  report: (report: ReportBody) => request<{ id: string }>('POST', '/api/reports', report),
  reports: () => request<{ reports: ReportSummary[] }>('GET', '/api/admin/reports'),
  bugReport: (id: string) => request<{ report: ReportBody & Record<string, unknown> }>('GET',
    `/api/admin/reports/${enc(id)}`),

  library: () => request<{ patterns?: LibraryEntry[] }>('GET', '/api/library'),
};

/** Static JSON (not under /api): the rig, the palettes. */
export async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return res.json() as Promise<T>;
}
