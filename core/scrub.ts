// Values made safe to keep in a bug report (SPEC "Bug reports"), in the page and on the server: keys that name a
// secret are blanked, strings that look like an IP are masked, a URL keeps only its origin and path, an error
// becomes its name, message and stack, and deep or huge values are cut short.

const SECRET_KEY = new RegExp(['token', 'ticket', 'secret', 'passw', 'auth', 'cookie', 'session_?key', 'handoff',
  'invite', '(?:^|[_-])ip(?:$|[_-])', '(?:client|remote|peer|source|destination)ip', 'address'].join('|'), 'i');
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
const IPV6 = /(?<![\w:])[0-9a-f]*:[0-9a-f:]*:[0-9a-f]*(?![\w:])/gi;
const URL_TAIL = /\b([a-z][a-z0-9+.-]*):\/\/([^\s/?#]+)([^\s?#]*)(?:[?#]\S*)?/gi;
const MAX_STRING = 2000;

/** How far scrub() goes. */
type ScrubLimits = { depth: number, items: number, chars?: number };
/** A log line's limits; DEEP a state's. */
export const LINE: ScrubLimits = { depth: 4, items: 50 };
export const DEEP: ScrubLimits = { depth: 12, items: 500, chars: 20_000 };
/** The most one piece of a report takes, in characters of JSON. */
const PIECE_MAX_CHARS = 64_000;

/** `text` with its URLs' queries and fragments dropped and its IPs masked. */
export function scrubText(text: string, max = MAX_STRING): string {
  const cut = text.length > max ? `${text.slice(0, max)}…` : text;
  return cut
    .replace(URL_TAIL, (_url, scheme: string, host: string, path: string) =>
      `${scheme}://${host.slice(host.lastIndexOf('@') + 1)}${path}`)
    .replace(IPV4, '[ip]')
    .replace(IPV6, (ip) => {
      const halves = ip.split('::'), groups = ip.split(':').filter(Boolean);
      const valid = groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))
        && (halves.length === 2 ? groups.length < 8 : halves.length === 1 && groups.length === 8);
      return valid ? '[ip]' : ip;
    });
}

/** `value` as plain data safe to keep, cut at `limits`. */
export function scrub(value: unknown, limits = LINE, depth = 0): unknown {
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'string') return scrubText(value, limits.chars);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) {
    return { name: value.name, message: scrubText(value.message), ...(value.stack ? { stack: scrubText(value.stack) }
      : {}) };
  }
  if (depth >= limits.depth) return '[deep]';
  if (ArrayBuffer.isView(value)) return `[${value.byteLength} bytes]`;
  if (value instanceof Map) value = Object.fromEntries(value);
  else if (value instanceof Set) value = [...value];
  if (Array.isArray(value)) return value.slice(0, limits.items).map((v) => scrub(v, limits, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as object).slice(0, limits.items)) {
    out[key] = SECRET_KEY.test(key) ? '[redacted]' : scrub(v, limits, depth + 1);
  }
  return out;
}

/** One piece of a report: scrubbed deep, and `{ cut, chars }` in its place when its JSON is past PIECE_MAX_CHARS. */
export function piece(value: unknown): unknown {
  const clean = scrub(value, DEEP);
  const chars = JSON.stringify(clean ?? null)?.length ?? 0;
  return chars > PIECE_MAX_CHARS ? { cut: true, chars } : clean;
}
