// `petals` and `cells` text params (SPEC "Pattern code"): the rose window, each petal clicked in or out, and one petal
// drawn large, each cell clicked in or out, each above its text, which takes numbers and runs typed. Petal 1 is the
// top one, on clockwise, as the rig's sectors run; cell 1 is at the heart, ring by ring out.
import { readText, TEXT_MAX } from '../core/globals.ts';
import { pickText, readPicks } from './bindings.ts';
import { PetalCells, Rose, type RosePick } from './rose.tsx';

type Props = { id: string; value: string; put: (v: string) => void };

export const PetalPick = (props: Props) => <Pick {...props} n={16} draw={(pick) =>
  <Rose detail="full" class="rose-pick" pick={pick} label="Petals shown: click one in or out" />} />;

export const CellPick = (props: Props) => <Pick {...props} n={14} draw={(pick) =>
  <PetalCells pick={pick} label="Cells shown in every petal: click one in or out" />} />;

function Pick({ id, value, put, n, draw }: Props & { n: number; draw: (pick: RosePick) => preact.JSX.Element }) {
  const on = readPicks(value, n);
  const flip = (i: number) => put(pickText(on.map((o, j) => (j === i ? !o : o))));
  return <div class="petal-pick">
    {draw({ on, flip })}
    {/* Uncontrolled, new for each value: a re-render while typing (the sandbox reporting a click) keeps the text. */}
    <input key={value} type="text" id={id} class="param-text" defaultValue={value} maxLength={TEXT_MAX}
      spellcheck={false} autocomplete="off" onChange={(e) => {
        const v = readText(e.currentTarget.value);
        if (v === null) e.currentTarget.value = value; else put(v);
      }} />
  </div>;
}
