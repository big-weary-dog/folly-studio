---
looks: A lub-dub glow swelling out from the centre, two beats of the tempo per heartbeat.
---
The layer beats like a heart: a strong swell and a softer echo just after, lub-dub, once every two beats of the look's
tempo (60 a minute at 120 bpm), each spreading out from the centre and peaking in the last colour of the pick, clear
between beats. It is locked to the look's bpm and has no speed of its own. Reach for it for tension, love themes and
music-synced pulsing. **strobe** flashes hard rather than swelling; **shockwave** bursts a travelling front on its own
clock; **spot** with its size on an lfo is a slow breathing glow.

## Params
- colours: `low body high` or reds to white.
- direction: With `anchor`, `out` starts from the rose. Up, down, right, left, back and front sweep across.
- spread: In seconds. 0.2–0.4 is a visible swell outward; near 1 at 120 bpm the far edge is a full heartbeat behind, so
  the next beat starts as the last one reaches it.

## Pairings
- Over a dark `colour-wash` bed (`blend: "over"`) so the pause between beats keeps a colour.
- Then `anchor` (tag `rose`) to beat from the rose window; shape `sphere` to swell through the towers too.
- Target the rose alone with spread 0.3 as a heart over a calmer whole-rig look.

## Pitfalls
- The rate comes only from the look's bpm; to slow the heart, lower the tempo.
- Spread 0 at fast tempos (above ~180 bpm) pulses the whole layer near 3 times a second: flash risk.
