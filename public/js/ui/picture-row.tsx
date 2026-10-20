// A picture param's row (SPEC-library "Pictures"): a thumbnail of its first frame in the look's palette, and an Edit
// dialog of its JSON, checked as it is typed (the core's pictureProblem), so only a picture is ever saved.
import { useState } from 'preact/hooks';

import type { ParamValue } from '../../../shared/schemas/look.ts';
import { type Picture, pictureProblem } from '../core/picture.ts';
import type { PaletteHex } from '../core/stdlib.ts';
import { cx, Field, openDialog } from './kit.tsx';
import type { Help } from './picks.tsx';

const TOKEN = /^(#[0-9a-f]{6}|(low|body|accent|high)(\d*))(?: (\d+)%)?$/i;
const SIZE = 56, R = SIZE / 2;

/** A key's colour as CSS: a palette role's first colour or a slot (wrapping), or #hex; dimmed by its N%. */
export function keyColour(token: string, palette: PaletteHex) {
  const m = TOKEN.exec(token);
  if (!m) return 'transparent';
  const list = m[1]!.startsWith('#') ? [m[1]!] : palette[m[2]!.toLowerCase() as 'body'] ?? palette.body ?? ['#ffffff'];
  const hex = list[(m[3] ? Number(m[3]) - 1 : 0) % list.length] ?? '#ffffff';
  return m[4] === undefined ? hex : `color-mix(in srgb, ${hex} ${Math.min(100, Number(m[4]))}%, black)`;
}

/** An annulus sector as an SVG path: radii r0..r1, turns a0..a1 clockwise from 12 o'clock. */
function sector(r0: number, r1: number, a0: number, a1: number) {
  const at = (r: number, a: number) => `${(R + r * Math.sin(a * 2 * Math.PI)).toFixed(2)} ${
    (R - r * Math.cos(a * 2 * Math.PI)).toFixed(2)}`;
  return `M${at(r0, a0)}L${at(r1, a0)}A${r1} ${r1} 0 0 1 ${at(r1, a1)}L${at(r0, a1)}A${r0} ${r0} 0 0 0 ${at(r0, a0)}Z`;
}

/** The first frame drawn small: a rose grid as rings (heart out, from the top petal's left edge), a square as cells. */
export function PictureThumb({ pic, palette }: { pic: Picture, palette: PaletteHex }) {
  const rows = pic.frames[0]?.rows ?? [], cells: preact.JSX.Element[] = [];
  const fill = (ch: string) => (pic.key[ch] ? keyColour(pic.key[ch], palette) : null);
  const wide = Math.max(...rows.map((r) => r.length), 1), step = Math.ceil(Math.max(wide, rows.length) / 32);
  rows.forEach((row, j) => [...row].forEach((ch, c) => {
    const f = fill(ch);
    if (!f) return;
    if (pic.grid === 'square') {      // at most 32 by 32 cells: every step-th row and column
      if (j % step || c % step) return;
      const w = SIZE / wide, h = SIZE / rows.length;
      cells.push(<rect x={c * w} y={j * h} width={w * step + 0.3} height={h * step + 0.3} fill={f} />);
      return;
    }
    if (j > 6) return;
    for (let s = 0; s < pic.repeat; s++) {
      const a0 = (s + c / row.length) / pic.repeat - 1 / 32, a1 = (s + (c + 1) / row.length) / pic.repeat - 1 / 32;
      cells.push(<path d={sector(4 + j * 3.4, 4 + (j + 1) * 3.4, a0, a1 - 1e-4)} fill={f} />);
    }
  }));
  return <svg class={cx('picture-thumb', pic.grid)} width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}
    role="img" aria-label="Picture, first frame">{cells}</svg>;
}

/** The row: label, thumbnail, Edit (its JSON in a dialog) and reset. */
export function PictureRow({ label, value, dflt, palette, help, put }: { label: string, value: ParamValue | undefined,
  dflt: Picture, palette: PaletteHex, help: Help, put: (v: Picture | undefined) => void }) {
  const pic = value !== undefined && !pictureProblem(value) ? value as Picture : dflt;
  return (
    <Field label={label} class="param end picture" title={help.title} hint={help.hint}>
      {(id) => <>
        <PictureThumb pic={pic} palette={palette} />
        <button type="button" id={id} class="btn small ghost" onClick={() => edit(label, pic, put)}>Edit</button>
        {help.button}
        <button type="button" class={cx('param-reset', pic === dflt && 'unused')} title="Reset to default"
          aria-label={`Reset ${label} to default`} onClick={() => put(undefined)}>↺</button></>}
    </Field>);
}

function edit(label: string, pic: Picture, put: (v: Picture) => void) {
  return openDialog({ title: label, className: 'picture-dialog', body: (close) => {
    const [text, setText] = useState(() => JSON.stringify(pic, null, 1));
    let parsed: unknown, problem = '';
    try { parsed = JSON.parse(text); problem = pictureProblem(parsed); } catch { problem = 'not JSON yet.'; }
    return <>
      <textarea class="picture-text" spellcheck={false} rows={16} value={text} aria-label="Picture JSON"
        onInput={(e) => setText(e.currentTarget.value)} />
      <p class={cx('dialog-text', problem && 'error')} role="status">{problem || 'A picture.'}</p>
      <div class="dialog-actions">
        <button type="button" class="btn ghost" onClick={() => close()}>Cancel</button>
        <button type="button" class="btn primary" disabled={!!problem}
          onClick={() => { close(); put(parsed as Picture); }}>Apply</button>
      </div>
    </>;
  } });
}
