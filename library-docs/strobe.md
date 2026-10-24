---
looks: The whole layer flashing on and off, each flash the next colour; or scattered flashes.
---
Drops, hits and rave peaks, briefly. **heartbeat** is a soft tempo pulse; **lightning** strikes now and then.

## Params
- colours: `high` for palette highlights, `#ffffff` for white hits; `all` includes dim colours.
- speed: 0.25–8 flashes a second; `{ "mod": "beats", "per": 1 }` follows the look's bpm.
- length: Lit share of the complete cycle, not seconds or a share of the lit flash.
- fade: Fade share of the complete cycle, capped at length; at the default a flash is all fade.

## Pairings
- Over the main element, its brightness bound to a `square` LFO in beats so it plays only on the hit.
- Scatter 0.6–0.9 over a **colour-wash** bed for paparazzi flicker.

## Pitfalls
- Full-rig flashes fatigue; keep to short moments.
