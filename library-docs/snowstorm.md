---
looks: Snow streaks blown slantwise and swirling over a dim bed; heavier with energy.
---
Fine streaks of snow (`high` heads, `accent` tails) blow down and across the layer at about 45° in 60 lanes,
pushed into swirls by noise, over a dim `low` bed; at low energy a quarter of the lanes run, at full energy nearly
all: **streaks** at an angle over a **colour-wash**, bent by **turbulence**. A blizzard, wind, a cold build.
**rain** falls straight; **snowflakes** drifts slow dots and settles.

## Overrides
- streaks.angle: the wind, in turns off straight down; 0 falls straight, ±0.25 blows sideways, the sign its side.
- streaks.speed: layers a second; 0.6 gusty, 1.5 a gale.
- streaks.density: share of lanes in use, bound to energy 0.25→0.95.
- streaks.tail: streak length; 0.05 for flecks, 0.3 for long smears.
- streaks.lanes: lane count; fewer, fatter streaks on sparse groups.
- streaks.colours: tail to head.
- turbulence.amount: how much the snow swirls; 0 straight lines, 0.15 eddies.
- turbulence.size and turbulence.speed: eddy size and how fast they shift.

## Pairings
- Automate energy from 0.3 to 1 over a section for a storm that builds.
- With **snowflakes** on a layer below for calm before the storm, crossfaded.

## Pitfalls
- 60 lanes is finer than most of the rig's LED spacing: many lanes catch no LEDs; lower lanes on sparse groups.
- Turbulence above ~0.2 breaks the streaks into noise.
