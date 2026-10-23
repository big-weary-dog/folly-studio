// One code-entry form for the locked landing page and the account menu.
import { openDialog } from './kit.tsx';
import { redeem } from './invite.ts';

export const enterInvite = () => openDialog<string>({ title: 'Invite code', body: (close) => <form method="dialog"
  onSubmit={(e) => { e.preventDefault(); close(new FormData(e.currentTarget).get('code') as string); }}>
  <p class="dialog-text">An invite code turns on the AI: ideas, refining and fixes.</p>
  <div class="field stack"><label>Code <input name="code" required autocomplete="off" autocapitalize="characters"
    spellcheck={false} maxlength={40} placeholder="XXXX-XXXX-XXXX" /></label></div>
  <div class="dialog-actions"><button class="btn ghost" type="button" onClick={() => close()}>Cancel</button>
    <button class="btn primary" type="submit">Redeem</button></div></form> })
  .then((code) => (code?.trim() ? redeem(code.trim()) : false));
