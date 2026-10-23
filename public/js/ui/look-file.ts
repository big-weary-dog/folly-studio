// Look files (SPEC-offline "Look files"): a look as JSON, several in one file, and back in through POST /api/looks,
// so a look moves between two Studios (the hosted one and the Pi's) with the same checks as any save.
import { playsOf } from '../../../shared/plays.ts';
import type { Listed, Look, LookCreate } from '../../../shared/schemas/api.ts';
import { api, statusOf } from '../api.ts';

/** What an import sends: a look file's words, chain and what plays, and nothing else. */
const KEYS = ['origin', 'title', 'summary', 'chain', 'layers', 'duration', 'bpm', 'globals', 'automation'] as const;

/** A look as its file holds it: its origin (where it was made: its own id, or the one it came in with) when it was
 * saved, the words, `chain: 2` (every saved look's), then what plays. */
export function lookFile<T extends Pick<Look, 'title' | 'layers'> & { summary?: string | null }>(
  look: T, saved?: Pick<Look, 'id' | 'origin'> | null) {
  const { layers, ...plays } = playsOf(look), origin = saved && (saved.origin ?? saved.id);
  return { ...(origin ? { origin } : {}), title: look.title, summary: look.summary ?? '', chain: 2 as const, ...plays,
    layers };
}

export const fileText = (data: unknown) => `${JSON.stringify(data, null, 2)}\n`;
/** `folly-looks-<scope>-<date>.json`. */
export const manyName = (scope: string, now = new Date()) =>
  `folly-looks-${scope}-${now.toISOString().slice(0, 10)}.json`;

/** Every listed look in full, one request at a time; one gone since the list was made (404) is left out, and any
 * other failure stops it, naming the look, so an export is never quietly short. */
export async function fullLooks(listed: Listed[], onEach?: (done: number) => void) {
  const looks = [];
  for (const [i, l] of listed.entries()) {
    try {
      const { look } = await api.look(l.id);
      looks.push(lookFile(look, look));
    } catch (err) {
      const why = `Could not fetch “${l.title}”: ${(err as Error).message}`;
      if (statusOf(err) !== 404) throw new Error(why, { cause: err });
    }
    onEach?.(i + 1);
  }
  return looks;
}

/** The looks in a file's text: a look file, or `{ looks: [...] }`; an Error saying why it is neither. */
export function looksIn(text: string): unknown[] {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('it is not JSON'); }
  if (data && typeof data === 'object' && Array.isArray((data as { looks?: unknown }).looks)) {
    return (data as { looks: unknown[] }).looks;
  }
  if (data && typeof data === 'object' && Array.isArray((data as { layers?: unknown }).layers)) return [data];
  throw new Error('it holds no looks');
}

/** A look file as POST /api/looks takes it: its own fields only (never shared, never an idea's). */
export function createBody(look: unknown): LookCreate {
  const o = (look && typeof look === 'object' ? look : {}) as Record<string, unknown>;
  return Object.fromEntries(KEYS.filter((k) => o[k] !== undefined && o[k] !== null).map((k) => [k, o[k]])) as
    unknown as LookCreate;
}

export type Imported = { added: number, updated: number, unchanged: number,
  failed: { name: string, error: string }[] };

/** Each look in each file, saved as the importer's: added, or overruling the one of theirs it came from (the server
 * matches its origin). One refused does not stop the rest. */
export async function importFiles(files: Iterable<{ name: string, text(): Promise<string> }>,
  choose?: (looks: LookCreate[]) => Promise<'update' | 'copy' | undefined>): Promise<Imported> {
  const out: Imported = { added: 0, updated: 0, unchanged: 0, failed: [] };
  const entries: { body: LookCreate, name: string }[] = [];
  for (const file of files) {
    let looks: unknown[];
    try { looks = looksIn(await file.text()); } catch (err) {
      out.failed.push({ name: file.name, error: (err as Error).message });
      continue;
    }
    for (const look of looks) {
      const body = createBody(look), name = typeof body.title === 'string' && body.title ? body.title : file.name;
      entries.push({ body, name });
    }
  }
  const choice = choose && entries.length ? await choose(entries.map((e) => e.body)) : 'update';
  if (!choice) return out;
  for (const { body, name } of entries) {
    if (choice === 'copy') delete body.origin;
    try {
      out[(await api.createLook(body)).imported ?? 'added']++;
    } catch (err) {
      out.failed.push({ name, error: (err as Error).message });
    }
  }
  return out;
}
