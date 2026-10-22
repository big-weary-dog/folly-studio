---
looks: A plain field of noise over the whole layer: soft blobs, rough fractal, bright creases, round cells or per-LED grain.
---
Plain noise that covers the layer, a building block: a textured bed, or the input of **mask** or **recolour**.
**clouds** drifts and leaves clear sky; **turbulence** pushes an existing pattern instead; **sparkle** is single
LEDs flashing on dark.

## Params
- kind: `smooth` soft blobs; `layered` fractal, rougher with Detail; `ridged` thin bright creases (veins,
  lightning-like cracks, marble); `cells` round cells, bright in their middles; `static` each LED its own value,
  no shapes: TV snow, glitter, a per-LED dissolve under **mask**.
- colours: Read low to high. Dark to bright reads as a mask; `all` gives a palette texture.
- size: 0.2–0.5 reads on the façade; below 0.1 is grain. Keep ≥ 0.25 on spires and globe strands. Static ignores it.
- speed: 0.05–0.3 calm; above 1 boils. Static changes ten times as fast: 0.1–0.5 twinkles.
- detail: Layered and ridged only. 2–4 is usual; 6 is rough.
- contrast: 1 keeps the soft field; 2–4 makes crisp shapes for a mask.

## Pairings
- `as: "input"` to **mask**, with contrast 2+, for shapes that cut a chase or a wash.
- Under **recolour**, or as a dim bed under a chase (`blend: "over"` on top).

## Pitfalls
- It covers every LED: dim it (brightness or layer level) as a bed, or the element on top is lost.
- Large size, fast speed and high contrast flash big areas.
