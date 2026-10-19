---
looks: Rain-like streaks falling in lanes with fading tails, or swaying round snowflakes.
---
Streaks fall through the layer in Direction in narrow lanes, each with a bright head of the last colour and a tail
fading back through the others; every streak runs at its own pace from its own start. Flake profile draws round dots
that sway side to side instead: snow. Depth slots split the layer front to back so arches at different depths get
different streaks. Rain, snow, embers rising, data falling. Reach for **single-strand** comets for orderly runs along
each wire, **sparkle** for points that stay put, **lightning** for one dramatic bolt.

## Params
- colours: tail end (first) to head (last); `"accent high"` gives blue tails with white heads.
- direction: which way they fall; `down` for rain, `up` for embers, `along` drips along each wire, `out` spokes from the
  centre, `round` streaks circling it.
- angle: tilts the lanes off direction, in turns; 0.1–0.15 for wind-driven rain or snow.
- speed: roughly layers a second (each streak ±40%). 0.1–0.2 for flakes, 0.6–1 for rain, 2+ for a downpour; 0 freezes.
- lanes: how many lanes across. 20–40 for rain on the whole rig; fewer lanes make bigger flakes.
- density: share of lanes in use (up to 3 streaks a lane). 0.2 is a drizzle, 1 a downpour.
- tail: streak tail as a share of the layer (streak only). 0.05 for short drops, 0.3 for long trails.
- depth: front-to-back slots, each with its own streaks. 3–6 on a deep rig; 1 if the layer is flat.
- profile: `streak` (a head with a tail) or `flake` (a round dot, a lane wide, swaying).
- sway: how far flakes swing side to side (flake only).

## Pairings
- Blend `over` a dim `colour-wash` bed (rain); bind density to the `energy` global for weather that builds.
- Then `turbulence` to swirl them on the wind (snowstorm).
- Flakes over an accent bed with a slow rising `bars` drift at the foot (snowflakes).

## Pitfalls
- The head is a hard edge; with few lanes on sparse LEDs it hops from LED to LED. More lanes and a longer tail help.
- tail does nothing on flake; sway does nothing on streak. angle is meant for the straight directions; on `out`,
  `round` or `along` it mixes unlike coordinates.
- A thin layer with many lanes leaves most lanes on no LEDs at all: match lanes to how many LEDs lie across.
