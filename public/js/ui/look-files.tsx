// My looks' and the Gallery's file buttons (SPEC-offline "Look files"): Export all as one file, and on My looks
// Import from look files, so looks move between the hosted Studio and the Pi's.
import { useRef, useState } from 'preact/hooks';

import type { Listed } from '../../../shared/schemas/api.ts';
import { api } from '../api.ts';
import { download, openDialog, toast } from './kit.tsx';
import { fileText, fullLooks, importActions, importFiles, manyName } from './look-file.ts';

export function LookFiles({ looks, gallery, reload }: { looks: Listed[] | null; gallery: boolean;
  reload: () => void }) {
  const [busy, setBusy] = useState(''), pick = useRef<HTMLInputElement>(null);

  async function exportAll() {
    const listed = looks || [];
    setBusy(`Exporting 0 of ${listed.length}…`);
    try {
      const all = await fullLooks(listed, (n) => setBusy(`Exporting ${n} of ${listed.length}…`));
      download(fileText({ looks: all }), manyName(gallery ? 'gallery' : 'mine'), 'application/json');
      toast(`Exported ${all.length} look${all.length === 1 ? '' : 's'}.`);
    } catch (err) {
      toast(`Nothing exported. ${(err as Error).message.replace(/\.?$/, '.')}`, { kind: 'error', timeout: 9000 });
    } finally {
      setBusy('');
    }
  }

  async function importAll(files: FileList | null) {
    if (!files?.length) return;
    setBusy('Importing…');
    try {
      const { failed, ...counts } = await importFiles([...files], async (incoming) => {
        const listed = (await api.looks()).looks ?? [];
        const own = await Promise.all(listed.map((l) => api.look(l.id).then((r) => r.look)));
        const actions = importActions(incoming, own);
        return openDialog<'update' | 'copy'>({ title: 'Import looks', body: (close) => <>
          <p class="dialog-text">Replacements overwrite current contents. Previous versions stay in History.
            Import as copies keeps your existing looks.</p>
          <ul>{incoming.map((l, i) => <li>{typeof l.title === 'string' && l.title ? l.title : 'Untitled look'}:
            {' '}{actions[i]}</li>)}</ul>
          <div class="dialog-actions">
            <button class="btn ghost" type="button" onClick={() => close()}>Cancel</button>
            <button class="btn" type="button" onClick={() => close('copy')}>Import as copies</button>
            <button class="btn primary" type="button" onClick={() => close('update')}>Import looks</button>
          </div></> });
      });
      const said = Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`);
      if (said.length) toast(`Imported: ${said.join(', ')}.`);
      for (const f of failed) toast(`Not imported: ${f.name}: ${f.error}`, { kind: 'error', timeout: 9000 });
      if (counts.added || counts.updated) reload();
    } catch (err) {
      toast(`Import stopped: ${(err as Error).message}`, { kind: 'error' });
    } finally {
      setBusy('');
      if (pick.current) pick.current.value = '';
    }
  }

  return (
    <>
      {busy && <span class="busy-note" role="status">{busy}</span>}
      {!gallery && <>
        <input ref={pick} type="file" accept=".json,application/json" multiple hidden
          onChange={(e) => importAll(e.currentTarget.files)} />
        <button type="button" class="btn" disabled={!!busy} onClick={() => pick.current?.click()}>Import</button>
      </>}
      <button type="button" class="btn" disabled={!!busy || !looks?.length} onClick={exportAll}>Export all</button>
    </>);
}
