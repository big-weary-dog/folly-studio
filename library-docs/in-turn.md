---
looks: Groups lighting one after another, or drops spreading at random, each playing its own copy.
---
Plays what is above it once per instance, each on its own clock from its own start: every arch filling in turn, rings
spreading from random drops. Each is the parts of Tag (each group tagged it, or each smallest group of the one that
is) or Drops, each in its own round frame out to Reach, so bars on `in` above it ring each drop. Starts come Every
seconds, forward, back, at random or together; a gate opens each over Attack, holds and fades over Release. A warp:
put it below the sources it times (presets arch-chase, ripple). **anchor** with `nearest` gives every group a copy at
the same moment; **strobe** flashes the whole layer; **single-strand** chases along every strand at once.

## Params
- each: `drops` re-frames the modules above it round each drop (`out`, `in` and `round` measure from it); `groups`
  keeps the layer's frame.
- tag: `arch` steps through each arch of the arches; LEDs in none of the tag's groups stay dark.
- start: one instance starts every Every seconds, so forward round 8 arches at 1 s is an 8 s cycle; `together` starts
  them all at once, every Every seconds; `random` gives each a fixed random place in the cycle.
- gate: `flash` fades the whole instance in and out; `wipe` sweeps it in along Direction over Attack, then fades it
  over Release; `pass` sends a band through, its tail crossing over Release.
- attack, hold, release: seconds, an envelope on each instance's age. A turn longer than the cycle is cut short when
  the instance starts again.
- drops: each drop covers its frame out to as far as its cycle has run, so a newer drop cuts an older one only where
  it has spread; set the source's speed so its ring reaches the edge as the drop ends (Ripple: bars `in` at speed
  −1 ÷ (drops × every)).

## Pairings
- Bars `along` (smooth, 8) above it, groups `arch`, gate `wipe` along: each arch fills along its wire (arch-chase).
- Bars `in` (pulse) above it, each `drops`, gate `flash` with Release the drop's life: rain on a pond (ripple).
- Sparkle above it, groups `tower`, `together` with a long Hold: the towers glitter and rest in step.

## Pitfalls
- Above it, motion comes from each module's speed and `t`, which start with the instance; LFOs and bound params
  still run on show time, the same for every instance.
- A module's `frame()` runs once a frame on show time, not per instance: sources that draw from `frame()` state
  (fireworks, lightning) play the same in every instance.
- One in-turn a stage: a second in-turn above the first starts its drops on show time.
- `up` and `down` gates cross the whole layer, not each group: a wipe up the arches reaches the short ones late.
