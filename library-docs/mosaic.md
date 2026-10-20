---
looks: Each strand broken into flat runs of LEDs, one colour a run: a chunky, 8-bit look.
---
Snaps what is above it in its layer to runs along each strand: every LEDs per run LEDs share the colour at the run's
middle, so smooth sources step down the wire rather than glide. A strand look: on the rose's one-LED panes a run is
the whole pane and it does nothing. A warp: it bends the modules above it up to a blur or trails, so it goes after the
source. **recolour** with Steps flattens colours instead of space; **mirror** folds instead.

## Params
- leds: 4–8 on 40-LED strands; on short strands (rose panes, globes) a run is the whole strand.

## Pairings
- After clouds or bars (smooth profile): moving colour in runs that change step by step.
- Then **hue-shift** or **recolour**: each run a different colour.
- With **recolour** Steps: runs in a few hard colours, pixel art.

## Pitfalls
- Long runs on a fast source make many LEDs change colour at once; keep the source slow to stay clear of the 3 Hz
  flash check.
- Snapped motion stutters; it is the look, but it fights smooth bindings to the beat.
