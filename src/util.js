// Small helpers, a deterministic PRNG, and trigonometry that gives the same
// answer on every machine.
//
// IMPORTANT for the netcode: NEVER use Math.random() inside the simulation.
// Anything random goes through state.rng, so all four machines get the same
// result.
//
// And nothing in the simulation calls Math.sin, Math.cos or Math.atan2 either.
// Those three are the one part of IEEE 754 the standard does not pin down: two
// engines are allowed to disagree in the last bit, and in a game where a shot
// either hits a head or misses it by a centimetre, the last bit is a kill. The
// three below are built out of +, -, * and / only - which the standard does pin
// down - so a rail shot lands in the same place on a phone as on a laptop.

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function len3(x, y, z) {
  return Math.sqrt(x * x + y * y + z * z);
}

export function dist3(a, b) {
  return len3(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

// --- Angles ------------------------------------------------------------------
//
// A full turn is YAW_UNITS (65536) steps. Integers, because an angle that
// travels over the wire as a float is an angle two machines round differently.

export const YAW_UNITS = 65536;
const TABLE_BITS = 12;
const TABLE_SIZE = 1 << TABLE_BITS; // 4096 samples of a full turn
const TABLE_SHIFT = 16 - TABLE_BITS;
const TAU = Math.PI * 2;

/**
 * sin(x) by Taylor series, to fifteenth order.
 *
 * Only multiplication and addition, so it is bit-identical everywhere. Over the
 * half turn it is asked for it is good to about a billionth, which is eight
 * orders of magnitude finer than the table it fills.
 */
function seriesSin(x) {
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let n = 1; n <= 7; n++) {
    term = (-term * x2) / ((2 * n) * (2 * n + 1));
    sum += term;
  }
  return sum;
}

const SIN_TABLE = new Float64Array(TABLE_SIZE + 1);
for (let i = 0; i <= TABLE_SIZE; i++) {
  // Folded into the quarter turn the series is most accurate over.
  const q = i & (TABLE_SIZE - 1);
  const half = TABLE_SIZE >> 1;
  const quarter = TABLE_SIZE >> 2;
  let s;
  if (q <= quarter) s = seriesSin((q / TABLE_SIZE) * TAU);
  else if (q <= half) s = seriesSin(((half - q) / TABLE_SIZE) * TAU);
  else if (q <= half + quarter) s = -seriesSin(((q - half) / TABLE_SIZE) * TAU);
  else s = -seriesSin(((TABLE_SIZE - q) / TABLE_SIZE) * TAU);
  SIN_TABLE[i] = s;
}

/** sin of an angle in yaw units, interpolated between two table entries. */
export function sinA(units) {
  const a = ((units % YAW_UNITS) + YAW_UNITS) % YAW_UNITS;
  const i = a >>> TABLE_SHIFT;
  const f = (a - (i << TABLE_SHIFT)) / (1 << TABLE_SHIFT);
  const s0 = SIN_TABLE[i];
  return s0 + (SIN_TABLE[i + 1] - s0) * f;
}

export function cosA(units) {
  return sinA(units + (YAW_UNITS >> 2));
}

/** Radians in, yaw units out. For the few places outside the simulation that
 *  still think in radians - the mouse, mostly. */
export function toUnits(radians) {
  return Math.round((radians / TAU) * YAW_UNITS);
}

export function toRadians(units) {
  return (units / YAW_UNITS) * TAU;
}

/** The short way round from a to b, in yaw units: -32768..32767. */
export function angleDelta(a, b) {
  let d = (b - a) % YAW_UNITS;
  if (d > YAW_UNITS / 2) d -= YAW_UNITS;
  if (d < -YAW_UNITS / 2) d += YAW_UNITS;
  return d;
}

const ATAN_C = [0.99986607, -0.33029954, 0.18014100, -0.08513300, 0.02083510];

/** atan of |z| <= 1, to about a hundred-thousandth of a radian. */
function atanUnit(z) {
  const z2 = z * z;
  return z * (ATAN_C[0] + z2 * (ATAN_C[1] + z2 * (ATAN_C[2] + z2 * (ATAN_C[3] + z2 * ATAN_C[4]))));
}

/** atan2 in yaw units. Zero is +x, and it turns towards +z. */
export function atan2A(y, x) {
  if (x === 0 && y === 0) return 0;
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  let r;
  if (ax >= ay) r = atanUnit(ay / ax);
  else r = Math.PI / 2 - atanUnit(ax / ay);
  if (x < 0) r = Math.PI - r;
  if (y < 0) r = -r;
  return Math.round((r / TAU) * YAW_UNITS);
}

/**
 * The two directions a body can walk in, given where it is looking.
 *
 * Forward is where the eyes are pointed, flattened onto the floor. Right is
 * forward crossed with up - which, with X east, Y up and Z north, comes out as
 * (-sin, cos) and *not* as (sin, -cos).
 *
 * It lives here because three separate places need it to agree: the simulation
 * turning buttons into movement, the bots turning a direction back into buttons,
 * and the renderer building the camera. They did not agree. The camera had it
 * right and the simulation had it backwards, so pressing D walked you to the
 * left of the screen - and the test that was supposed to catch that had been
 * written from the same wrong idea, checked the same wrong direction, and
 * passed.
 */
export function walkBasis(yaw, out = {}) {
  const sn = sinA(yaw);
  const cs = cosA(yaw);
  out.fx = cs;
  out.fz = sn;
  out.rx = -sn;
  out.rz = cs;
  return out;
}

// --- Randomness --------------------------------------------------------------

// mulberry32: fast, deterministic, and the seed fits in a single integer.
export function nextRandom(state) {
  state.rng = (state.rng + 0x6d2b79f5) | 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randRange(state, lo, hi) {
  return lo + nextRandom(state) * (hi - lo);
}

export function randInt(state, n) {
  return Math.floor(nextRandom(state) * n) % n;
}

/** A number in -1..1 that clusters around zero: two draws, not one. Aim error
 *  wants this shape, because a bot that is as likely to miss by a lot as by a
 *  little does not feel like it is aiming at all. */
export function randSpread(state) {
  return (nextRandom(state) + nextRandom(state) - 1);
}
