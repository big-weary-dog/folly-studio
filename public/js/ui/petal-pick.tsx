// A `petals` text param (SPEC "Pattern code"): the rose window, each petal clicked in or out, beside its text, which
// takes numbers and runs typed. Petal 1 is the top one, on clockwise, as the rig's sectors run.
import { readText, TEXT_MAX } from '../core/globals.ts';
import { petalText, readPetals } from './bindings.ts';
import { Rose } from './rose.tsx';

export function PetalPick({ id, value, put }: { id: string; value: string; put: (v: string) => void }) {
  const on = readPetals(value);
  const flip = (i: number) => put(petalText(on.map((o, j) => (j === i ? !o : o))));
  return <div class="petal-pick">
    <Rose detail="full" class="rose-pick" pick={{ on, flip }} label="Petals shown: click one in or out" />
    <input type="text" id={id} class="param-text" value={value} maxLength={TEXT_MAX} spellcheck={false}
      autocomplete="off" onChange={(e) => {
        const v = readText(e.currentTarget.value);
        if (v === null) e.currentTarget.value = value; else put(v);
      }} />
  </div>;
}
