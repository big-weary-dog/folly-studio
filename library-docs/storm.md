---
looks: Forked lightning striking out of dim rolling clouds; strikes come oftener as energy rises.
---
Dim clouds in the `accent` colour roll across a nearly dark sky, and forked bolts in `accent` and `high` strike
down through them with a short glow, from one strike every five seconds at low energy to one every second and a half
at high: a dim **colour-wash** shaped by **mask** with **clouds** as its input, and **lightning** drawn over. Drama,
tension, a breakdown. **rain** and **snowstorm** are steady weather; **strobe** is rhythmic, not natural.

## Overrides
- lightning.speed: strikes a second (0.1–0.8); bound to energy 0.2→0.7. A number fixes the rate.
- lightning.width, lightning.jag and lightning.glow: bolt thickness, zigzag and the halo round it.
- lightning.direction: `up` for strikes from the ground; `right` or `left` for sideways bolts.
- lightning.colours: glow to core; the last is the core.
- clouds.cover, clouds.speed and clouds.size: how much cloud, how fast it rolls, how big.
- mask.amount: 1 makes the clear sky black; 0.5 flattens it.
- colour-wash.colours and colour-wash.brightness: the cloud colour and how dim.

## Pairings
- Under a **rain** layer on the whole rig, with energy automation building.
- Put the storm on the `spire` group for strikes on the spires alone.

## Pitfalls
- A bolt is one zigzag across the layer: on the whole rig most strikes miss the towers. Use one layer per tower for
  strikes everywhere.
- Lightning is built to stay under one strike a second; don't stack several storm layers to get more.
- The mask reads the clouds' palette brightness: a dark palette thins the clouds.
