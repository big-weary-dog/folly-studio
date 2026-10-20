---
looks: The whole layer flashing on and off, each flash the next colour; or scattered flashes.
---
The layer flashes at Speed, each flash snapping full on in the next colour of the pick and fading out by the end of
Length, dark (clear) between flashes; Scatter lights only a random part of the layer on each flash, a different part
each time, for a glittering crowd-camera look. Reach for it for drops, hits and rave peaks, briefly. **heartbeat** is
a soft swelling pulse locked to the tempo; **sparkle** glints single LEDs continuously; **lightning** strikes now and
then.

## Params
- colours: one per flash in turn; `high` or a hex for white-hot hits. The default `all` cycles the whole palette,
  dim colours included.
- speed: flashes per second. 2 is the default; above 3 on a large area fails the flash check. For one per beat use the
  tempo ÷ 60 (2 at 120 bpm).
- length: the lit share of each flash; 0.05–0.15 a crisp strobe, 0.5 half on, half off.
- scatter: the share of LEDs skipped on each flash, chosen anew per flash; 0 every LED, 1 leaves about one in ten.
- fade: how much of each flash fades out at its end (capped at length); 0 cuts off hard.

## Pairings
- Over the look's main element (`blend: "over"` or `add`), with its level bound to an lfo or the clip envelope so it
  plays only at the hit.
- Scatter 0.6–0.9 over a `colour-wash` bed for a paparazzi flicker that keeps the bed lit.
- Target a small group (the rose, the spirelets) rather than the whole rig to stay clear of the flash check.

## Pitfalls
- Speed over 3 on a large area fails the flash check; above 3 only on small groups, and scatter does not make it safe.
- Bright full-rig flashes are fatiguing; keep strobe to short moments, not a whole look.
