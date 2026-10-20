---
looks: A bright front bursting out from the centre, fast then slowing, leaving a fading glow.
---
Again and again a bright front bursts out in Direction, racing at first and easing as it goes, the last colour of the
pick at the front and a long glow behind it fading back through the earlier colours; each burst dims to nothing before
the next begins. From the centre (`out`) it is an expanding ring; along up or right it is a wall sweeping across. Reach
for it for impacts, drops and booms. **ripple** spreads many thin rings from random spots; **heartbeat** swells in
place to the tempo; **bars** on `in` with a negative speed gives steady, evenly spaced rings.

## Params
- direction: Put `anchor` after it to burst `out` from the rose; with shape `sphere` it becomes a 3D shell.
- speed: Bursts a second; 0.5 is one every two seconds. For one a beat set it to the tempo ÷ 60.
- width: 0.05 is a crisp ring, 0.3 a broad wave of light.

## Pairings
- Over a `colour-wash` bed with `blend: "over"`; then `anchor` (tag `rose`) to burst from the rose window.
- Two shockwaves at different speeds and colours, the second `blend: "add"`, for overlapping booms.
- Bind speed to the `energy` global (0.2 to 1) for bursts that come faster as the show builds.

## Pitfalls
- Every burst lights most of the layer at once; at speed 2 on the whole rig it nears the 3 Hz flash limit.
- The front leaves the layer about halfway through each burst and its short wake fades behind it; at low speed the
  layer then waits dark for the next burst.
- It runs on its own clock, not locked to the beat; heartbeat is the one tied to the tempo.
