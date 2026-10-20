// The Playa view's GLSL (renderer.ts draws with it). Light stays linear HDR until OUT. uL: each pixel's light
// (rgb) and highlight (a), 512 a row; uHi: a highlight is on; uD: the light left outside it; uW: its warm tint; uG:
// the ghost (unlit fixtures, faintly); uK: the emission, or a pass's parameter.
const H = '#version 300 es\nprecision highp float;\nprecision highp int;\n';
const LED = `uniform highp sampler2D uL;
uniform float uHi, uD, uW, uG;
uniform mat4 uVP;
uniform vec3 uE;
vec3 B;  // set by led(): the unlit base, and a warm tint when highlighted
vec3 led(float i) {
  int k = int(i + .5);
  vec4 c = texelFetch(uL, ivec2(k & 511, k >> 9), 0);
  B = vec3(.5, .56, .72) * uG + vec3(1, .7, .3) * .08 * c.a * uHi * uW;
  return c.rgb * mix(1., mix(uD, 1., c.a), uHi);
}
`;
const LIGHTS = 'uniform vec4 uLP[16];\nuniform vec3 uLC[16];\nuniform int uN;\n';
const FS = (body: string, ins = '') => `${H}${ins}uniform float uK;\nout vec4 o;\nvoid main() {\n${body}\n}`;
const SCREEN = `${H}out vec2 vU;
void main() {
  vec2 q = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vU = q;
  gl_Position = vec4(q * 2. - 1., 0, 1);
}`;
const SAMPLE = `uniform sampler2D uT;
uniform vec2 uH;
in vec2 vU;
vec3 t(vec2 d) { return texture(uT, vU + d * uH).rgb; }
`;

// A ribbon facing the camera, at least ~1 px wide (dimmed to keep its energy); its colour steps pixel to pixel,
// blending into each neighbour over a fifth of a pixel (LITE: no blend), and shades round like a tube.
const STRIP = [`${H}${LED}layout(location=0) in vec4 aA;  // start xyz, pixel
layout(location=1) in vec4 aB;  // end xyz, radius
layout(location=2) in vec4 aT;  // tangent at the start, neighbours joined (1 previous, 2 next)
layout(location=3) in vec4 aU;  // tangent at the end
uniform float uPx;
flat out vec3 vC, vP, vN, vB;
out vec3 vQ;
void main() {
  float a = float((gl_VertexID & 3) >> 1), s = float(gl_VertexID & 1) * 2. - 1.;  // the quad's corner
  vec3 p = mix(aA.xyz, aB.xyz, a), v = uE - p;
  float d = length(v);
  vec3 x = cross(normalize(mix(aT.xyz, aU.xyz, a)), v / d);
  x /= max(length(x), 1e-3);
  float w = max(aB.w, uPx * d * 1.2);
  vC = led(aA.w);
  vB = B;
  vP = vC;
  vN = vC;
#ifndef LITE
  int f = int(aT.w);
  if ((f & 1) > 0) vP = led(aA.w - 1.);
  if ((f & 2) > 0) vN = led(aA.w + 1.);
#endif
  vQ = vec3(a, s, aB.w / w);
  gl_Position = uVP * vec4(p + x * s * w, 1);
}`, FS(`  float a = vQ.x, u = abs(vQ.y);
  vec3 c = vC + (vP - vC) * smoothstep(0., 1., .5 - a * 2.5) + (vN - vC) * smoothstep(0., 1., .5 - (1. - a) * 2.5);
  o = vec4((c * uK * (.72 + .28 * sqrt(1. - u * u)) + vB) * (1. - smoothstep(.8, 1., u)) * vQ.z, 1);`,
'flat in vec3 vC, vP, vN, vB;\nin vec3 vQ;\n')];

// Globes and lenses: a sprite with a bright core and a little halo, dimmed below 3 px.
const POINT = [`${H}${LED}layout(location=0) in vec4 aP;  // xyz, pixel
layout(location=1) in float aR;
uniform float uPs;
flat out vec3 vC, vB;
flat out float vK;
void main() {
  vec4 p = uVP * vec4(aP.xyz, 1);
  gl_Position = p;
  float px = aR * 6. * uPs / max(p.w, .05);
  gl_PointSize = clamp(px, 3., 96.);
  vK = min(1., px / 3.);
  vK *= vK;
  vC = led(aP.w);
  vB = B;
}`, FS(`  vec2 d = gl_PointCoord * 2. - 1.;
  float r = dot(d, d);
  if (r > 1.) discard;
  o = vec4((vC * uK * (exp(-r * 9.) + .1 * exp(-r * 3.)) + vB * exp(-r * 20.)) * vK, 1);`,
'flat in vec3 vC, vB;\nflat in float vK;\n')];

// Glass: the cell's light, a little dimmer toward its rim.
const CELL = [`${H}${LED}layout(location=0) in vec4 aP;  // xyz, pixel
layout(location=1) in vec4 aC;  // the cell's middle, radius
flat out vec3 vC, vB;
flat out float vR;
out vec3 vD;
void main() {
  vC = led(aP.w);
  vB = B;
  vD = aP.xyz - aC.xyz;
  vR = aC.w;
  gl_Position = uVP * vec4(aP.xyz, 1);
}`, FS('  o = vec4((vC * uK + vB * .6) * (1. - .5 * dot(vD, vD) / (vR * vR)), 1);',
'flat in vec3 vC, vB;\nflat in float vR;\nin vec3 vD;\n')];

// A flood: a beam brightest where the view crosses the most of it, fading along it; or (uSo) a lit shell.
const FLOOD = [`${H}${LED}layout(location=0) in vec4 aP;  // xyz, pixel
layout(location=1) in vec4 aN;  // normal, t along the cone
flat out vec3 vC, vB;
out vec3 vN, vV;
out float vT;
void main() {
  vC = led(aP.w);
  vB = B;
  vN = aN.xyz;
  vV = uE - aP.xyz;
  vT = aN.w;
  gl_Position = uVP * vec4(aP.xyz, 1);
}`, FS(`  float f = abs(dot(normalize(vN), normalize(vV))), t = 1. - vT;
  vec3 shell = (vC * uK + vB) * (.3 + .7 * vT) * (.75 + .25 * f);
  vec3 beam = vC * uK * f * f * t * t * smoothstep(0., .06, vT) / (1. + 3. * vT);
  o = vec4(uSo > 0. ? shell : beam, 1);`, 'flat in vec3 vC, vB;\nin vec3 vN, vV;\nin float vT;\nuniform float uSo;\n')];

// The scaffold: one dim grey wherever it stands, the same as the props' scaffold bays.
const LINE = [`${H}uniform mat4 uVP;
layout(location=0) in vec3 aP;
void main() {
  gl_Position = uVP * vec4(aP, 1);
}`, FS('  o = vec4(vec3(.19, .2, .21) * uK, 1);')];

// The playa: dust under a faint moon, lit by the spill lights (softened by uLP.w), lost in the haze far off. Lit
// per vertex (the rings are close where the pools are): soft light, cheap pixels.
const HZ = 'vec3(.0033, .0048, .0116)';
const GROUND = [`${H}${LIGHTS}uniform mat4 uVP;
uniform vec3 uE;
uniform float uK, uY;  // the playa's light, its height
layout(location=0) in vec2 aP;
out vec3 vC;
void main() {
  vec3 w = vec3(aP.x, uY, aP.y), c = vec3(0);
  for (int i = 0; i < 16; i++) {
    if (i >= uN) break;
    vec3 l = uLP[i].xyz - w;
    float d = dot(l, l) + uLP[i].w;
    c += uLC[i] * max(l.y, 0.) * inversesqrt(d) / d;
  }
  float haze = 1. - exp(-length(w.xz - uE.xz) * .006);
  vC = mix(c * uK + vec3(.011, .0105, .0102), ${HZ}, haze);
  gl_Position = uVP * vec4(w, 1);
}`, FS('  o = vec4(vC, 1);', 'in vec3 vC;\n')];

// Bloom, a dual-filter blur: down keeps what is over uK, up spreads a tent of the level below.
const DOWN = [SCREEN, FS(`  vec3 c = t(vec2(0)) * 4. + t(vec2(-1)) + t(vec2(1)) + t(vec2(1, -1)) + t(vec2(-1, 1));
  c = clamp(c / 8., 0., 64.);
  float b = max(c.r, max(c.g, c.b));
  o = vec4(b > uK ? c * (b - uK) / b : vec3(0), 1);`, SAMPLE)];
const UP = [SCREEN, FS(`  vec3 c = t(vec2(-2, 0)) + t(vec2(2, 0)) + t(vec2(0, -2)) + t(vec2(0, 2));
  c += 2. * (t(vec2(-1)) + t(vec2(1)) + t(vec2(1, -1)) + t(vec2(-1, 1)));
  o = vec4(c / 12., 1);`, SAMPLE)];

// Out: Mirage's night sky (zenith to horizon, a faint band at the horizon) where nothing solid is (the scene's
// alpha), the scene and its bloom; the tone map, on the peak only, so saturated colours stay saturated: as is up to
// .7 (a lone colour shows as its swatch), a soft shoulder to 1, burning to white far past it, and a toe that keeps
// the night dark; then sRGB, dither. vD: the view ray, from the projection (and its lens shift).
const OUT = [`${H}uniform mat4 uV, uP;
out vec2 vU;
out vec3 vD;
void main() {
  vU = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vec2 q = vU * 2. - 1.;
  vD = vec3(q.x / uP[0][0], (q.y + uP[2][1]) / uP[1][1], -1) * mat3(uV);
  gl_Position = vec4(q, 0, 1);
}`, FS(`  vec4 s = texture(uS, vU);
  float y = normalize(vD).y;
  vec3 sky = mix(${HZ}, vec3(.0003, .0006, .0021), sqrt(max(y, 0.))) + ${HZ} * .8 * exp(-abs(y) * 60.);
  vec3 c = s.rgb + sky * (1. - min(s.a, 1.)) + texture(uB, vU).rgb * uK;
  float p = max(c.r, max(c.g, c.b));
  float film = p < .7 ? p : 1. - .3 * exp((.7 - p) / .3);
  film *= film / (film + .005);
  c = p > 1e-6 ? film * mix(c / p, vec3(1), .35 * smoothstep(1.5, 16., p)) : vec3(0);
  vec3 s1 = sqrt(c), s2 = sqrt(s1);  // sRGB, closely (Ian Taylor's fit): a software renderer's pow is slow
  c = mix(12.92 * c, .662 * s1 + .684 * s2 - .3236 * sqrt(s2) - .02254 * c, step(.0031308, c));
  o = vec4(c + (fract(52.98 * fract(dot(gl_FragCoord.xy, vec2(.06711, .00584)))) - .5) / 255., 1);`,
'uniform sampler2D uS, uB;\nin vec2 vU;\nin vec3 vD;\n')];

export const GLSL = { strip: STRIP, stripLite: [STRIP[0].replace('\n', '\n#define LITE\n'), STRIP[1]], point: POINT,
  cell: CELL, flood: FLOOD, line: LINE, ground: GROUND, down: DOWN, up: UP, out: OUT };
