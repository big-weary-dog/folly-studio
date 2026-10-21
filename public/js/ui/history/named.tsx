// Named versions (SPEC-history "Named versions"): "Save a named version…" saves the work and names the version it
// is; Rename names a past one, which keeps it (at most 50). An empty name unnames it, and the next save may prune it.
import { useState } from 'preact/hooks';

import type { VersionListed } from '../../../../shared/schemas/api.ts';
import { api } from '../../api.ts';
import { Field, openDialog, toast } from '../kit.tsx';
import type { Studio } from '../studio-store.ts';

/** Ask for a name: the trimmed name, '' to unname (when `clear`), or undefined when cancelled. */
function askName({ title, ok, value = '', text, clear = false }: { title: string, ok: string, value?: string,
  text: string, clear?: boolean }) {
  return openDialog<string>({ title, className: 'name-dialog', body: (close) => {
    const [name, setName] = useState(value);
    return <form class="details-form" onSubmit={(e) => { e.preventDefault(); close(name.trim()); }}>
      <p class="dialog-text">{text}</p>
      <Field label="Name" stack>{(id) => <input id={id} type="text" value={name} maxlength={80} required={!clear}
        autofocus placeholder="Before the drop rework" onInput={(e) => setName(e.currentTarget.value)} />}</Field>
      <div class="dialog-actions">
        <button class="btn ghost" type="button" onClick={() => close()}>Cancel</button>
        <button class="btn primary" type="submit">{ok}</button>
      </div>
    </form>;
  } });
}

/** "Save a named version…": saves now (a version if what plays changed) and names the version the look is. */
export async function saveNamed(st: Studio) {
  const name = await askName({ title: 'Save a named version', ok: 'Save', text: 'Saves your work now and names this '
    + 'version. Named versions are kept until you unname them; the rest, the last 20.' });
  return !!name && st.save({ versionName: name });
}

/** Rename (or name) version `v`; an empty name unnames it. Resolves with the version as listed now. */
export async function rename(st: Studio, v: VersionListed) {
  const id = st.look.peek().id, name = await askName({ title: `Name version ${v.n}`, ok: 'Name it', value: v.name,
    clear: !!v.name, text: v.name ? 'Leave it empty to unname it: then it is kept only while it is among the last 20.'
      : 'A named version is kept until you unname it (up to 50).' });
  if (!id || name === undefined || (!name && !v.name)) return null;
  try { return (await api.nameVersion(id, v.n, name || null)).version; }
  catch (err) { toast((err as Error).message, { kind: 'error' }); return null; }
}
