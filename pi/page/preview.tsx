// A look's preview before it is added (SPEC-liveplay "The page"): a modal playing its gallery preview (SPEC "Gallery
// previews", its still under reduced motion), or the card's glass when it has none, with who made it, how long and
// how it plays, then the actions it is given. × or Esc closes it.
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

import { cx, jewelGradient } from '../../public/js/ui/kit.tsx';
import type { Tile } from './add.tsx';
import { clock, kindWord } from './model.ts';

export function Preview({ tile, onClose, children }: { tile: Tile, onClose: () => void,
  children: ComponentChildren }) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} class="dialog lp-preview" aria-labelledby="lp-preview-title" onClose={onClose}>
      <header class="dialog-head">
        <h2 id="lp-preview-title">{tile.title}</h2>
        <button class="icon-btn" type="button" aria-label="Close" onClick={() => ref.current?.close()}>×</button>
      </header>
      <div class="dialog-body">
        <div class={cx('lp-art', tile.preview && 'has-preview')}
          style={{ '--art': jewelGradient(tile.id + tile.title) }}>
          {tile.preview ? <picture>
            <source media="(prefers-reduced-motion: reduce)" srcset={`${tile.preview}-still.webp`} />
            <img src={`${tile.preview}.webp`} alt={`${tile.title}, its gallery preview`} decoding="async" />
          </picture> : <span>No preview{tile.by === 'the lights\' own' ? ': the lights\' own looks have none' : ' yet'}
          </span>}
        </div>
        <p class="lp-note">{tile.by}{tile.duration != null && ` · ${clock(tile.duration)}`}{tile.kind
          && tile.kind !== 'look' && <> · <span class="lp-tag">{kindWord(tile as { kind: 'live' | 'baked' })}</span></>}
        </p>
        {children}
      </div>
    </dialog>);
}
