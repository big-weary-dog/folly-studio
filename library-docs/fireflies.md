---
looks: Lights blinking out of step that drift into step, until the swarm is scattered and starts again.
---
Each light blinks on its own rhythm, and its neighbours on the rig's neighbour map pull it toward theirs, so clusters
fall into step, then strands, then whole arches, until the map pulses as one; every Scatter seconds it is shaken back
into disorder. By a tag, each group (each arch, each spire) is one firefly, linked where its LEDs touch another's.
Calm and alive; reads as fireflies, a heartbeat finding itself or a crowd learning a clap. **sparkle** twinkles at
random and never agrees.

## Params
- pull: 0.1 drifts into step over half a minute; 0.2 in seconds; 0.4+ almost at once.
- rate: 20–40 blinks a minute is calm; in step the whole layer blinks this often, so keep it low.
- spread: 0 alike rhythms sync cleanly; 0.15+ keeps a ragged edge that never quite agrees.
- scatter: 20–40 s replays the drift into step; 0 lets it stay in step.
- by: `led` for a swarm of points; `arch` or `spire` for whole pieces blinking and syncing.
- flash: 0.1–0.2 s sparks; 0.5+ soft glows.

## Pairings
- Over a dark **colour-wash** (brightness 0.1); a warm Colours pick (`#c8ff40 #ffd040`) reads as fireflies.
- **blur** (space) with flash 0.4 turns points into soft orbs.
- Bind pull to energy: a build that brings the swarm into step.

## Pitfalls
- It follows the wiring: pieces the map leaves apart never fall into step with each other.
- In step at a high rate and long flash the whole rig blinks together: the flash check holds it, but keep rate under 60.
- By a tag the layer must hold that tag's groups; LEDs outside them stay dark.
