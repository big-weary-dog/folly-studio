---
looks: Groups lighting one after another, or drops spreading at random, each playing its own copy.
---
Plays the modules above it once per group (or per random drop), each on its own clock: arches filling in turn, rings
from drops. Put it below the sources it times (presets **arch-chase**, **ripple**). **anchor** with `nearest` gives
every group a copy at the same moment; **single-strand** chases every strand at once.

## Params
- each: `drops` re-frames the modules above round each drop (`out`, `in`, `clockwise`, `counterclockwise`
  measure from it).
- tag: LEDs in none of the tag's groups stay dark.
- start: forward round 8 arches at every 1 s is an 8 s cycle; `random` gives each a fixed place in the cycle.
- attack: A turn longer than the cycle is cut short when it starts again.
- drops: A newer drop cuts an older one only where it has spread. Set the source's speed so its ring reaches the edge
  as the drop ends (bars `in` at speed −1 ÷ (drops × every)).

## Pairings
- **bars** `along` above, tag `arch`, gate `wipe` along: each arch fills along its wire.
- **sparkle** above, tag `tower`, `together` with a long hold: towers glitter and rest in step.

## Pitfalls
- Speeds and `t` above it restart per instance; LFOs, bound params and `frame()` state (**fireworks**,
  **lightning**) run on show time, the same in every instance.
- One in-turn per layer: a second one above starts on show time.
- `up`/`down` gates cross the whole layer, not each group.
