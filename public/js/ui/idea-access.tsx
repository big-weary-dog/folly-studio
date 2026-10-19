// The idea form's gate on the paid models (SPEC "Access"): a locked account sees why, a box for an invite code and
// Sketch, which is free; an unlocked one sees what it has left, and at a limit when the next idea may go.
import { useState } from 'preact/hooks';

import { api, statusOf } from '../api.ts';
import type { Access } from '../../../shared/schemas/access.ts';
import type { ModelChoice } from '../../../shared/schemas/models.ts';
import { cx, toast } from './kit.tsx';
import { signedOut } from './session.ts';

export type Gate = { kind: 'free' | 'exempt' } | { kind: 'locked' } | { kind: 'open', text: string }
  | { kind: 'wait', text: string };

/** When `at` is, in words: "at 14:32", or "tomorrow at 09:10". */
export function whenText(at: string, now = new Date()) {
  const d = new Date(at), time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? `at ${time}` : `tomorrow at ${time}`;
}

/** What the form shows for `model` with this access: nothing (free, exempt), the lock, what is left, or the wait. */
export function gateOf(access: Access | null, model: ModelChoice | undefined, now = new Date()): Gate {
  if (!access || !model?.paid) return { kind: 'free' };
  if (!access.unlocked) return { kind: 'locked' };
  if (access.exempt) return { kind: 'exempt' };
  const { left } = access, own = access.models?.[model.id] ?? {};
  const next = access.nextAt ? ` Next idea ${whenText(access.nextAt, now)}.` : '';
  const caps = access.limits;
  if (!caps.perHour || !caps.perDay || !caps.concurrent) {
    return { kind: 'wait', text: 'Your allowance for the AI models is 0: ask an admin.' };
  }
  if (access.full) return { kind: 'wait', text: `The AI models have done all they can for today.${next}` };
  if (left.running === 0) return { kind: 'wait', text: 'Your ideas are being made. Send the next when one is done.' };
  if (left.hour === 0) return { kind: 'wait', text: `That's all your ideas for this hour.${next}` };
  if (left.day === 0) return { kind: 'wait', text: `That's all your ideas for today.${next}` };
  if (own.hour === 0 || own.day === 0) return { kind: 'wait', text: `That's all on ${model.label} for now.` };
  const hour = Math.min(left.hour, own.hour ?? Infinity), day = Math.min(left.day, own.day ?? Infinity);
  return { kind: 'open', text: `${hour} left this hour · ${day} today` };
}

/** The gate under the idea form's actions; `sketch` switches the form to the free model, when there is one. */
export function AccessGate({ gate, model, paidLabels, sketch, onAccess }: { gate: Gate, model?: ModelChoice,
  paidLabels: string, sketch?: () => void, onAccess: (a: Access) => void }) {
  const [code, setCode] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (gate.kind === 'free' || gate.kind === 'exempt') return null;
  const useSketch = sketch && <button class="btn ghost small" type="button" onClick={sketch}>Use Sketch</button>;
  if (gate.kind === 'open') return <p class="gate-left" aria-live="polite">{gate.text}</p>;
  if (gate.kind === 'wait') {
    return <div class="gate gate-wait" role="status"><p>{gate.text}</p>{useSketch}</div>;
  }
  async function redeem() {
    if (!code.trim()) return setError('Enter the code you were given.');
    setBusy(true);
    try {
      const { access } = await api.redeem(code);
      setCode('');
      setError('');
      onAccess(access);
      toast(`Unlocked: ${paidLabels} are yours to use.`, { kind: 'ok' });
    } catch (err) {
      if (statusOf(err) === 401) return signedOut();
      setError((err as Error).message);
    } finally { setBusy(false); }
  }
  return (
    <div class="gate gate-locked" role="group" aria-labelledby="gate-why">
      <p id="gate-why"><strong>{model?.label} needs an invite code.</strong>{` ${paidLabels} are invite only; `}
        Sketch is free for everyone.</p>
      <div class="gate-row">
        <label for="invite-code" class="sr-only">Invite code</label>
        <input id="invite-code" type="text" class="gate-code" value={code} placeholder="XXXX-XXXX-XXXX" maxlength={64}
          autocomplete="off" spellcheck={false} onInput={(e) => setCode(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); redeem(); } }} />
        <button class={cx('btn primary small', busy && 'busy')} type="button" disabled={busy} onClick={redeem}>
          Unlock</button>
        {useSketch}
      </div>
      <p class="form-error" role="alert" hidden={!error}>{error}</p>
    </div>);
}
