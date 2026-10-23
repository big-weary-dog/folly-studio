// Jukebox's auto picks (SPEC-liveplay "Modes"): the engine's own looks but the safe one, a seeded shuffle each round.
import { rand } from '../../public/js/core/stdlib.ts';
import type { PiLook } from './library.ts';

type Looks = () => Map<string, { look: PiLook | null }>;

export function createPicks(looks: Looks, safe: string, seed: number) {
  let bag: string[] = [], rounds = 0;
  /** The looks that play, in a shuffled order of their own each round. */
  function shuffled() {
    const ids = [...looks()].filter(([id, l]) => l.look && id !== safe).map(([id]) => id).sort();
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(rand(seed, rounds, i) * (i + 1));
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    }
    rounds++;
    return ids;
  }
  /** The next look of the rounds that is not `playing` (so none plays twice in a row: it goes to the round's end);
   * null when there is none other, and what plays loops on. */
  return function pick(playing: string | undefined): string | null {
    for (let round = 0; round < 2; round++) {
      if (!bag.length) bag = shuffled();
      while (bag.length) {
        const id = bag.shift()!;
        if (id === playing) { if (bag.length) bag.push(id); continue; }
        if (looks().get(id)?.look) return id;
      }
    }
    return null;
  };
}
