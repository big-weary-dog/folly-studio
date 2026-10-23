// Poll the light file against the contents actually loaded, so an edit before the first poll cannot become its
// baseline. Studio replaces the file by rename; a missing file uses defaults and a broken one keeps the last light.
import { readFileSync } from 'node:fs';

import { lightOf } from '../../public/js/core/light.ts';

export function lightReader(file: string) {
  let previous: string | null | undefined;
  /** New light settings, or undefined when the contents have not changed since the last read. */
  return () => {
    try {
      let text: string | null;
      try { text = readFileSync(file, 'utf8'); } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        text = null;
      }
      if (text === previous) return;
      previous = text; // report a broken revision once, retry when the contents change
      return lightOf(text === null ? null : JSON.parse(text));
    } catch (e) { throw new Error(`${file}: ${(e as Error).message}`, { cause: e }); }
  };
}
