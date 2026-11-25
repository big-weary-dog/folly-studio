// A small settings file in the data folder: read again whenever its size or time changes (so a hand edit applies
// on the next read), parsed field by field into defaults, and saved whole (atomic-file.ts).
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { writeFileAtomic } from './atomic-file.ts';

type Log = { warn?: (...a: unknown[]) => void };

/** `parse` turns the file's JSON (null when missing or broken) into the setting; `broken` ends the warning. */
export function settingsFile<T>({ file, parse, broken, log = console }:
  { file: string, parse: (json: unknown) => T, broken: string, log?: Log }) {
  let sig = '', value = parse(null), saving = 0;
  const signature = () => {
    try { const st = statSync(file); return `${st.size}:${st.mtimeMs}`; } catch { return '-'; }
  };
  return {
    /** The setting as stored now; while saves are under way, the last one saved. */
    current(): T {
      const s = saving ? sig : signature();
      if (s === sig) return value;
      sig = s;
      let json: unknown = null;
      if (s !== '-') {
        try { json = JSON.parse(readFileSync(file, 'utf8')); } catch (err) {
          log.warn?.(`${path.basename(file)} is not valid JSON (${(err as Error).message}); ${broken}`);
        }
      }
      value = parse(json);
      return value;
    },
    /** Writes `next`; once no save is under way, the next read is the file's again. */
    async save(next: T): Promise<T> {
      value = next;
      saving++;
      try {
        await writeFileAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
      } finally {
        if (!--saving) sig = '';
      }
      return next;
    },
  };
}
