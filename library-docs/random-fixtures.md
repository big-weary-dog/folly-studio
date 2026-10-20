---
looks: Whole fixtures switch on and off at random, each in a random colour: a slow shuffle or a glitch.
---
Each fixture (a strand, an arch's wire, a petal) is one unit: every step it is lit or dark at random, in a colour
drawn at random from the pick, so the rig reads as a field of fixtures changing places. Slow and faded it is a calm
shuffle of colour; fast with no fade it is a digital glitch. Reach for **sparkle** when single LEDs should glint
rather than whole fixtures, **groups-in-turn** when the groups should light in order, **strobe** for everything
flashing together.

## Params
- speed: 0.2–1 for a shuffle, 4+ for a glitch; on large fixtures keep it under 3 or the bake fails the flash check.
- density: 0.2–0.4 keeps it sparse; near 1 most stay lit and only the colours change.
- scatter: 0.5–1 so fixtures do not all switch on the same beat.
- fade: 0.3–0.8 turns the switches into breaths; 0 with high speed is the glitch.

## Pairings
- Blend `over` a dim `colour-wash` bed so dark fixtures are not black.
- A one-colour pick (`accent1`) with density 0.3 and fade 0.5 for a calm wink across the rig.
- Then `trails` for an afterglow on each fixture that switches off.

## Pitfalls
- Fixtures are as big as the rig makes them: a main-arch wire switching is a large area, so fast, unfaded settings
  are large-area flashing.
- On a layer with only a few fixtures (one spire) it is just a few lights blinking; place it on many.
