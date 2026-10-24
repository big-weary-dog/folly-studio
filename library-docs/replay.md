---
looks: The last moments again: a stuttering loop, a rewind, a bounce, held snapshots on the beat.
---
Replays what is above it: every Hold it jumps to the newest frames and, until the next jump, loops the Length before
it, runs it backwards, bounces through it, or holds one frame. Unlike a speed, it can run time backwards and repeat
anything random exactly: a **lightning** strike plays back and forth, **sparkle** freezes into snapshots, **fire**
runs down in reverse. **delay** replays later in another place; **trails** only fades.

## Params
- play: `loop` stutters for build-ups; `reverse` rewinds; `bounce` rocks back and forth; `hold` freezes.
- length: short stutters; 1–2 replays a whole gesture. Hidden for hold.
- hold: how often it moves on; at Length it just lags.
- beats: on counts beats at the look's tempo; off counts seconds. Timing is bounded below.
- amount: 0.5 ghosts the replay over the live pattern.

## Pairings
- lightning → replay `bounce`, length 1, hold 4: each strike rocks back and forth.
- sparkle → replay `hold`, hold 1: snapshots each beat at 120 bpm.

## Pitfalls
- It ends a stage: warps below it don't bend what is above; put warps above it.
- A still or slow pattern looks unchanged: it needs something that moves.
- Every jump is a cut: on bright looks keep Hold and Length long; cuts never come faster than 4 a second.
- Length is held to 0.25–2 seconds. Hold is held between Length and 4 seconds minus Length (hold mode: 0.35–4
  seconds). Beat values outside those limits lose beat alignment; at 120 bpm Length 0.5–2 beats stays exact.
- Seeking back or jumping half a second starts it again; until it has frames it shows the oldest it holds.
