// HTTP API client (SPEC "HTTP API"): JSON in and out, cookie session. A non-2xx response throws an ApiError with the
// server's message and `status` (0: the server could not be reached).
import type { Bake, Idea, Listed, Look, LookCreate, LookPatch, User } from '../../shared/schemas/api.ts';
import type { AdminModels, ModelChoices, ModelsConfig } from '../../shared/schemas/models.ts';
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
type Me = { user: User };

export const api = {
  me: () => request<{ user?: User }>('GET', '/api/me'),
  signup: (username: string, password: string) => request<Me>('POST', '/api/signup', { username, password }),
  login: (username: string, password: string) => request<Me>('POST', '/api/login', { username, password }),
  logout: () => request('POST', '/api/logout', {}),

  ideas: () => request<{ ideas?: Idea[] }>('GET', '/api/ideas'),
  /** `wait`: the idea's `status@updatedAt` as last seen; the server answers when that changes (or after 25 s). */
  idea: (id: string, wait?: string) => request<{ idea?: Idea }>('GET',
    `/api/ideas/${enc(id)}${wait ? `?wait=${enc(wait)}` : ''}`),
  createIdea: (text: string, model?: string) => request<{ idea: Idea }>('POST', '/api/ideas', { text, model }),
  models: () => request<ModelChoices>('GET', '/api/models'),
  adminModels: () => request<AdminModels>('GET', '/api/admin/models'),
  saveModels: (config: ModelsConfig) => request<AdminModels>('PUT', '/api/admin/models', config),

  looks: (scope: 'mine' | 'gallery' = 'mine') => request<{ looks?: Listed[] }>('GET',
    `/api/looks?scope=${enc(scope)}`),
  look: (id: string) => request<{ look: Look }>('GET', `/api/looks/${enc(id)}`),
  createLook: (look: LookCreate) => request<{ look: Look }>('POST', '/api/looks', look),
  updateLook: (id: string, patch: LookPatch) => request<{ look: Look }>('PUT', `/api/looks/${enc(id)}`, patch),
  deleteLook: (id: string) => request('DELETE', `/api/looks/${enc(id)}`),
  bake: (id: string) => request<{ bake: Bake }>('POST', `/api/looks/${enc(id)}/bake`, {}),

  library: () => request<{ patterns?: LibraryEntry[] }>('GET', '/api/library'),
};

/** Static JSON (not under /api): the rig, the palettes. */
export async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return res.json() as Promise<T>;
}
