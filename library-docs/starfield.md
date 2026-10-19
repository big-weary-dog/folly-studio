---
looks: Pale blue and gold stars glinting over a dark blue sky with drifting violet haze.
---
A deep blue night with soft violet nebulae drifting slowly sideways, and half the LEDs glinting now and then as
pale blue or gold stars: a **colour-wash**, **clouds** over it and pulse **sparkle** on top. Fixed colours, ignoring
the palette. Quiet and spacious, for intros, night scenes or under a moon (**spot**). **shimmer** glitters
everywhere continuously; **meteors** adds motion along the wires.

## Overrides
- sparkle.density: share of LEDs that ever glint; 0.15 a sparse sky, 0.8 a dense one.
- sparkle.rate: glints a second per star; 0.35 calm, 1.5 busy twinkle.
- sparkle.length: how long a glint lasts; 0.05 sharp pinpricks, 0.3 slow swells.
- sparkle.colours: the stars; `high` follows the palette.
- clouds.cover: how much haze; 0 clear sky, 0.8 mostly nebula.
- clouds.speed, clouds.size and clouds.direction: drift rate, cloud size and which way they move.
- clouds.colours and colour-wash.colours: the haze and the sky; roles (`low`, `body`) follow the palette.

## Pairings
- With **meteors** on the arches in a layer above.
- Bind sparkle.density to energy for a sky that fills with stars.
- Put **water** on a layer above for a night sea.

## Pitfalls
- Hex colours ignore the look's palette and hue global; switch to roles if the palette matters.
- Spirelets and other single-LED fixtures read as whole lamps winking; drop density there or leave them out.
