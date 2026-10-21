// The reason a curator gives for approving frames that fail the flash check: from Check & bake (bake.tsx) and the
// gallery's Approve (approve.tsx).
import { useState } from 'preact/hooks';

import { Field, openDialog } from './kit.tsx';

/** A curator's reason for approving frames that fail the flash check (3–500 characters), or undefined. */
export function askWhy(found: string) {
  return openDialog<string>({ title: 'Approve despite flashing?', body: (close) => {
    const [text, setText] = useState('');
    return <form class="details-form" onSubmit={(e) => { e.preventDefault(); close(text.trim()); }}>
      <p class="dialog-text">{found} Approving it lets it play on the Folly. Your reason stays on the look, with your
        name.</p>
      <Field label="Why is this flashing acceptable?" stack>{(id) => <textarea id={id} rows={3} required
        minlength={3} maxlength={500} value={text} onInput={(e) => setText(e.currentTarget.value)} />}</Field>
      <div class="dialog-actions">
        <button class="btn ghost" type="button" onClick={() => close()}>Cancel</button>
        <button class="btn primary" type="submit">Approve</button>
      </div>
    </form>;
  } });
}
