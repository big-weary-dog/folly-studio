---
looks: The whole layer flashing on and off, each flash the next colour; or scattered flashes.
---
Drops, hits and rave peaks, briefly. **heartbeat** is a soft tempo pulse; **lightning** strikes now and then.

## Params
- colours: `high` for palette highlights, `#ffffff` for white hits; `all` includes dim colours.
- speed: `{ "mod": "beats", "per": 1 }` for one a beat at the look's bpm. Over 3 only on small groups;
  scatter does not make it safe.
- fade: capped at length; at the default a flash is all fade.

## Pairings
- Over the main element, its brightness bound to a `square` LFO in beats so it plays only on the hit.
- Scatter 0.6–0.9 over a **colour-wash** bed for paparazzi flicker.

## Pitfalls
- Full-rig flashes fatigue; keep to short moments.
