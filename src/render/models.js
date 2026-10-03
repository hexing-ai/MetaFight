/**
 * Everything that moves, as boxes.
 *
 * The arena is boxes because that is what the simulation collides against. The
 * bodies are boxes because that is what the arena is: a fighter built out of
 * fourteen of them, standing in a room built out of two hundred, looks like it
 * lives there, and a smooth character model would look like it had wandered in
 * from a different game.
 *
 * A body is built once and drawn in pieces, because the pieces move: the legs
 * swing from the hip, the arms from the shoulder, the head follows where the
 * player is looking, and the whole thing leans a little into a run. Each piece
 * carries the point it turns about, which is all the animation there is.
 */

/** A little builder: push boxes into it, take arrays out. */
class Mesh {
  constructor() {
    this.verts = [];
    this.indices = [];
    this.count = 0;
    this.parts = [];
  }

  part(name, pivot) {
    this.parts.push({ name, pivot, offset: this.indices.length, count: 0 });
    return this;
  }

  endPart() {
    const part = this.parts[this.parts.length - 1];
    part.count = this.indices.length - part.offset;
    return this;
  }

  box(x0, y0, z0, x1, y1, z1, colour, opts = {}) {
    const [r, g, b] = colour;
    const faces = [
      { n: [0, 0, 1], v: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] },
      { n: [0, 0, -1], v: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]] },
      { n: [1, 0, 0], v: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]] },
      { n: [-1, 0, 0], v: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]] },
      { n: [0, 1, 0], v: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]] },
      { n: [0, -1, 0], v: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]] },
    ];
    for (const face of faces) {
      const base = this.count;
      // A touch of shade per face, so a white box still reads as a box in flat
      // light. Up is brightest, down darkest, the sides in between.
      const k = face.n[1] > 0 ? 1.14 : face.n[1] < 0 ? 0.62 : (face.n[0] !== 0 ? 0.92 : 1.02);
      for (const p of face.v) {
        this.verts.push(p[0], p[1], p[2], face.n[0], face.n[1], face.n[2],
          r * k, g * k, b * k, opts.glow || 0);
        this.count++;
      }
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return this;
  }

  done() {
    return {
      vertices: new Float32Array(this.verts),
      indices: new Uint16Array(this.indices),
      parts: this.parts,
      count: this.indices.length,
    };
  }
}

export const STRIDE = 10; // pos 3, normal 3, colour 3, glow 1

const SUIT = [0.34, 0.36, 0.40];
const DARK = [0.16, 0.17, 0.20];
const METAL = [0.55, 0.58, 0.64];
const VISOR = [0.35, 0.85, 1.0];

/**
 * A fighter, facing +x, feet at the origin, 1.8 m tall.
 *
 * The team colour goes on as a tint at draw time - the same mesh is red and
 * blue - and the parts marked `team` are the ones it lands on. In a free for
 * all every body gets its own colour instead, so you can tell four identical
 * suits apart at forty metres.
 */
export function buildBody() {
  const m = new Mesh();

  m.part('torso', [0, 1.05, 0]);
  m.box(-0.14, 0.86, -0.24, 0.16, 1.42, 0.24, SUIT);
  m.box(-0.17, 1.28, -0.27, 0.19, 1.44, 0.27, DARK, {}); // collar
  m.box(-0.26, 0.98, -0.15, -0.14, 1.34, 0.15, DARK); // backpack
  m.box(-0.28, 1.06, -0.06, -0.24, 1.24, 0.06, METAL, { glow: 0.5 }); // its light
  m.box(0.16, 1.02, -0.13, 0.2, 1.22, 0.13, [1, 1, 1]); // chest plate, tinted
  m.endPart();

  m.part('head', [0, 1.5, 0]);
  m.box(-0.11, 1.44, -0.13, 0.13, 1.72, 0.13, SUIT);
  m.box(0.09, 1.52, -0.1, 0.16, 1.64, 0.1, VISOR, { glow: 0.75 });
  m.box(-0.13, 1.66, -0.14, 0.05, 1.76, 0.14, DARK);
  m.endPart();

  m.part('armR', [0, 1.36, -0.28]);
  m.box(-0.09, 0.94, -0.36, 0.11, 1.4, -0.22, SUIT);
  m.endPart();

  m.part('armL', [0, 1.36, 0.28]);
  m.box(-0.09, 0.94, 0.22, 0.11, 1.4, 0.36, SUIT);
  m.endPart();

  m.part('legR', [0, 0.88, -0.12]);
  m.box(-0.1, 0.0, -0.22, 0.12, 0.9, -0.02, DARK);
  m.box(-0.12, 0.0, -0.23, 0.16, 0.09, -0.01, METAL);
  m.endPart();

  m.part('legL', [0, 0.88, 0.12]);
  m.box(-0.1, 0.0, 0.02, 0.12, 0.9, 0.22, DARK);
  m.box(-0.12, 0.0, 0.01, 0.16, 0.09, 0.23, METAL);
  m.endPart();

  // What they are carrying, held out in front of the right shoulder.
  m.part('gun', [0, 1.2, -0.2]);
  m.box(0.1, 1.14, -0.3, 0.62, 1.26, -0.16, METAL);
  m.box(0.0, 1.06, -0.29, 0.18, 1.2, -0.17, DARK);
  m.box(0.58, 1.16, -0.28, 0.66, 1.24, -0.18, [1, 0.7, 0.3], { glow: 0.35 });
  m.endPart();

  return m.done();
}

/** The gun you are holding, in view space: +x is forward, +y up, +z right. */
export function buildViewModels() {
  const models = [];

  // 0 autogun
  {
    const m = new Mesh();
    m.part('gun', [0, 0, 0]);
    m.box(0.10, -0.10, -0.05, 0.95, 0.02, 0.05, [0.22, 0.24, 0.27]);
    m.box(0.30, 0.02, -0.035, 0.72, 0.09, 0.035, [0.16, 0.18, 0.21]);
    m.box(0.05, -0.30, -0.045, 0.24, -0.06, 0.045, [0.2, 0.21, 0.24]);
    m.box(0.90, -0.07, -0.028, 1.02, 0.0, 0.028, [0.32, 0.34, 0.37]);
    m.box(0.62, 0.09, -0.02, 0.70, 0.13, 0.02, [0.9, 0.5, 0.2], { glow: 0.4 });
    m.endPart();
    models.push(m.done());
  }
  // 1 scattergun
  {
    const m = new Mesh();
    m.part('gun', [0, 0, 0]);
    m.box(0.08, -0.12, -0.07, 0.86, 0.04, 0.07, [0.20, 0.17, 0.15]);
    m.box(0.80, -0.10, -0.09, 1.00, 0.03, 0.09, [0.30, 0.31, 0.33]);
    m.box(0.04, -0.32, -0.055, 0.22, -0.08, 0.055, [0.22, 0.18, 0.15]);
    m.box(0.30, -0.16, -0.05, 0.66, -0.10, 0.05, [0.16, 0.14, 0.12]);
    m.endPart();
    models.push(m.done());
  }
  // 2 rocket launcher
  {
    const m = new Mesh();
    m.part('gun', [0, 0, 0]);
    m.box(0.02, -0.13, -0.10, 1.05, 0.07, 0.10, [0.20, 0.22, 0.20]);
    m.box(1.00, -0.15, -0.12, 1.12, 0.09, 0.12, [0.29, 0.29, 0.27]);
    m.box(0.20, 0.07, -0.06, 0.55, 0.16, 0.06, [0.15, 0.17, 0.15]);
    m.box(0.06, -0.34, -0.05, 0.24, -0.10, 0.05, [0.2, 0.2, 0.19]);
    m.box(0.60, 0.08, -0.03, 0.68, 0.14, 0.03, [1.0, 0.45, 0.2], { glow: 0.55 });
    m.endPart();
    models.push(m.done());
  }
  // 3 rail rifle
  {
    const m = new Mesh();
    m.part('gun', [0, 0, 0]);
    m.box(0.10, -0.09, -0.045, 1.20, 0.01, 0.045, [0.18, 0.20, 0.25]);
    m.box(0.34, 0.01, -0.06, 0.78, 0.10, 0.06, [0.13, 0.15, 0.20]);
    m.box(0.05, -0.30, -0.04, 0.23, -0.06, 0.04, [0.18, 0.2, 0.24]);
    m.box(0.80, 0.02, -0.02, 1.16, 0.06, 0.02, [0.4, 0.85, 1.0], { glow: 0.7 });
    m.endPart();
    models.push(m.done());
  }
  // 4 instagib rifle
  {
    const m = new Mesh();
    m.part('gun', [0, 0, 0]);
    m.box(0.10, -0.08, -0.05, 1.30, 0.02, 0.05, [0.15, 0.18, 0.22]);
    m.box(0.30, 0.02, -0.07, 0.70, 0.12, 0.07, [0.18, 0.22, 0.3]);
    m.box(0.05, -0.30, -0.04, 0.23, -0.05, 0.04, [0.16, 0.2, 0.26]);
    m.box(0.72, -0.02, -0.03, 1.34, 0.04, 0.03, [0.55, 0.95, 1.0], { glow: 0.95 });
    m.endPart();
    models.push(m.done());
  }
  return models;
}

/** The things lying about: one mesh each, all drawn spinning. */
export function buildPickups() {
  const out = {};

  const cross = new Mesh();
  cross.part('item', [0, 0, 0]);
  cross.box(-0.32, -0.32, -0.32, 0.32, 0.32, 0.32, [0.42, 0.47, 0.52]);
  cross.box(-0.12, -0.40, -0.12, 0.12, 0.40, 0.12, [0.3, 1.0, 0.45], { glow: 0.8 });
  cross.box(-0.40, -0.12, -0.12, 0.40, 0.12, 0.12, [0.3, 1.0, 0.45], { glow: 0.8 });
  cross.endPart();
  out.health = cross.done();

  const big = new Mesh();
  big.part('item', [0, 0, 0]);
  big.box(-0.42, -0.30, -0.42, 0.42, 0.34, 0.42, [0.46, 0.5, 0.55]);
  big.box(-0.16, -0.46, -0.16, 0.16, 0.5, 0.16, [0.3, 1.0, 0.5], { glow: 0.9 });
  big.box(-0.5, -0.14, -0.16, 0.5, 0.16, 0.16, [0.3, 1.0, 0.5], { glow: 0.9 });
  big.endPart();
  out.bighealth = big.done();

  const armour = new Mesh();
  armour.part('item', [0, 0, 0]);
  armour.box(-0.28, -0.44, -0.36, 0.28, 0.18, 0.36, [0.55, 0.72, 1.0], { glow: 0.35 });
  armour.box(-0.20, 0.14, -0.30, 0.20, 0.40, 0.30, [0.45, 0.6, 0.85], { glow: 0.5 });
  armour.box(-0.06, -0.34, -0.40, 0.06, 0.30, 0.40, [0.2, 0.4, 0.9]);
  armour.endPart();
  out.armour = armour.done();

  const ammo = new Mesh();
  ammo.part('item', [0, 0, 0]);
  ammo.box(-0.30, -0.22, -0.20, 0.30, 0.20, 0.20, [0.45, 0.42, 0.30]);
  ammo.box(-0.32, 0.20, -0.22, 0.32, 0.28, 0.22, [0.6, 0.56, 0.4]);
  ammo.box(-0.18, 0.28, -0.06, 0.18, 0.34, 0.06, [1.0, 0.8, 0.3], { glow: 0.5 });
  ammo.endPart();
  out.ammo = ammo.done();

  const flag = new Mesh();
  flag.part('flag', [0, 0, 0]);
  flag.box(-0.04, -0.9, -0.04, 0.04, 0.9, 0.04, [0.7, 0.72, 0.78]);
  flag.box(-0.02, 0.18, 0.04, 0.02, 0.86, 0.92, [1, 1, 1], { glow: 0.45 });
  flag.endPart();
  out.flag = flag.done();

  const rocket = new Mesh();
  rocket.part('rocket', [0, 0, 0]);
  rocket.box(-0.22, -0.09, -0.09, 0.16, 0.09, 0.09, [0.5, 0.5, 0.52]);
  rocket.box(0.16, -0.06, -0.06, 0.28, 0.06, 0.06, [0.8, 0.3, 0.2]);
  rocket.box(-0.30, -0.05, -0.05, -0.22, 0.05, 0.05, [1.0, 0.65, 0.25], { glow: 1 });
  rocket.endPart();
  out.rocket = rocket.done();

  // The stand a flag lives on, and the marker over a spawn point.
  const spark = new Mesh();
  spark.part('spark', [0, 0, 0]);
  spark.box(-0.06, -0.06, -0.06, 0.06, 0.06, 0.06, [1, 1, 1], { glow: 1 });
  spark.endPart();
  out.spark = spark.done();

  return out;
}

/** A flat square, used for everything additive: flashes, blasts, trails. */
export function buildQuad() {
  const m = new Mesh();
  m.part('quad', [0, 0, 0]);
  const verts = [];
  const push = (x, y, u, v) => verts.push(x, y, 0, 0, 0, 1, u, v, 1, 1);
  push(-0.5, -0.5, 0, 0);
  push(0.5, -0.5, 1, 0);
  push(0.5, 0.5, 1, 1);
  push(-0.5, 0.5, 0, 1);
  return {
    vertices: new Float32Array(verts),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    count: 6,
  };
}
