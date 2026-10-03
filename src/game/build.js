/**
 * The bricks the arenas are laid with.
 *
 * Everything solid in this game is an axis-aligned box or a wedge, and there are
 * two good reasons for that and one bad one. The good ones: a box against a box
 * needs no tolerances, never wedges a player into a corner and never disagrees
 * with itself about which side of a wall somebody is on; and a box is four
 * numbers, so a whole arena fits in a file you can read. The bad one is that you
 * cannot build a cathedral out of them - which is why `mesh.js` is allowed to
 * cut the boxes into a great many small polygons and light them properly, and
 * why the arenas are foundries and cisterns rather than cathedrals.
 *
 * A builder is handed to every map. It collects solids, lights, spawns, items
 * and flags, and it can mirror everything it has been given so far - which is
 * how a capture-the-flag map that is fair by construction costs no more to write
 * than half of one.
 */

import { P_STEP } from '../constants.js';

export const MAT = {
  concrete: 0,
  panel: 1,
  rust: 2,
  floor: 3,
  trim: 4,
  red: 5,
  blue: 6,
  rock: 7,
};

export class Builder {
  constructor() {
    this.solids = [];
    this.lights = [];
    this.spawns = [];
    this.items = [];
    this.flags = [];
    this.pads = [];
    this.decals = [];
    this.marks = [];
    this.mirrorFrom = null;
  }

  /**
   * A solid box. `mat` picks the surface, and `opts.skip` hides faces that are
   * buried in another box - not for the look of it, but because a face nobody
   * can see still costs the light bake a few hundred shadow rays.
   */
  box(x0, y0, z0, x1, y1, z1, mat = MAT.concrete, opts = {}) {
    const solid = {
      type: 'box',
      x0: Math.min(x0, x1), x1: Math.max(x0, x1),
      y0: Math.min(y0, y1), y1: Math.max(y0, y1),
      z0: Math.min(z0, z1), z1: Math.max(z0, z1),
      mat,
      skip: opts.skip || '',
      trim: opts.trim === undefined ? null : opts.trim,
      glow: opts.glow || 0,
      nonsolid: !!opts.nonsolid,
      hazard: opts.hazard || 0,
      detail: opts.detail || 1,
    };
    this.solids.push(solid);
    return solid;
  }

  /**
   * A wedge: a box whose top slopes from one edge to the other. `axis` is the
   * direction it climbs in and `dir` which way, so ('x', 1) is low at x0 and
   * high at x1. You can walk up it; the sides of it are wall.
   */
  ramp(x0, y0, z0, x1, y1, z1, axis, dir, mat = MAT.concrete, opts = {}) {
    const solid = this.box(x0, y0, z0, x1, y1, z1, mat, opts);
    solid.type = 'ramp';
    solid.axis = axis;
    solid.dir = dir >= 0 ? 1 : -1;
    return solid;
  }

  /**
   * A flight of stairs, as boxes. Cheaper to walk than a ramp of the same
   * pitch - a stair is climbed at full speed, a ramp costs you the climb - and
   * it is the difference between a shortcut and a scenic route.
   */
  stairs(x, z, w, d, y0, y1, steps, axis, dir, mat = MAT.concrete) {
    const rise = (y1 - y0) / steps;
    // A step taller than a body can walk up is a wall with delusions, and it is
    // the one map mistake that looks fine and plays like a locked door. Caught
    // here rather than in a test, because the map is data and this is the
    // moment the data is wrong.
    if (rise > P_STEP) {
      throw new Error(`stairs rise ${rise.toFixed(2)} m per step, and a body can only manage ${P_STEP}`);
    }
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = 1;
      const top = y0 + rise * (i + 1);
      if (axis === 'x') {
        const a = dir > 0 ? x + w * t0 : x + w * (1 - t1);
        const b = dir > 0 ? x + w * t1 : x + w * (1 - t0);
        this.box(a, y0 - 0.2, z, b, top, z + d, mat);
      } else {
        const a = dir > 0 ? z + d * t0 : z + d * (1 - t1);
        const b = dir > 0 ? z + d * t1 : z + d * (1 - t0);
        this.box(x, y0 - 0.2, a, x + w, top, b, mat);
      }
    }
  }

  /**
   * Four walls, a floor and a ceiling, with holes where you asked for them.
   *
   * A doorway is given as a side and a span along that side, and the wall is
   * built as the pieces either side of it plus the lintel over it. Building the
   * hole rather than cutting it is what keeps every solid a box.
   */
  room(o) {
    const {
      x, z, w, d, y = 0, h = 6, t = 0.6,
      floor = MAT.floor, wall = MAT.concrete, ceil = MAT.panel,
      doors = [], noCeil = false, noFloor = false, omit = [],
    } = o;
    const x1 = x + w;
    const z1 = z + d;
    if (!noFloor) this.box(x - t, y - t, z - t, x1 + t, y, z1 + t, floor, { skip: 'down' });
    if (!noCeil) this.box(x - t, y + h, z - t, x1 + t, y + h + t, z1 + t, ceil, { skip: 'up' });

    for (const side of ['n', 's', 'e', 'w']) {
      // A side can be left out, and then the room next door supplies that wall.
      // Two rooms that each build the wall between them build it twice, in the
      // same place, and two faces in the same place are a stripe of flicker
      // across the middle of the map.
      if (omit.includes(side)) continue;
      const gaps = doors.filter((g) => g.side === side)
        .map((g) => ({ a: g.a, b: g.b, y0: y + (g.y0 || 0), y1: y + (g.y1 || 3.2) }))
        .sort((p, q) => p.a - q.a);
      const along = side === 'n' || side === 's' ? w : d;
      const pieces = [];
      let cursor = 0;
      for (const gap of gaps) {
        const a = Math.max(0, Math.min(along, gap.a));
        const b = Math.max(0, Math.min(along, gap.b));
        if (a > cursor) pieces.push({ a: cursor, b: a, y0: y, y1: y + h });
        if (gap.y0 > y) pieces.push({ a, b, y0: y, y1: gap.y0 });
        if (gap.y1 < y + h) pieces.push({ a, b, y0: gap.y1, y1: y + h });
        cursor = Math.max(cursor, b);
      }
      if (cursor < along) pieces.push({ a: cursor, b: along, y0: y, y1: y + h });

      for (const p of pieces) {
        if (p.b - p.a < 0.001 || p.y1 - p.y0 < 0.001) continue;
        if (side === 'n') this.box(x + p.a, p.y0, z1, x + p.b, p.y1, z1 + t, wall);
        if (side === 's') this.box(x + p.a, p.y0, z - t, x + p.b, p.y1, z, wall);
        if (side === 'e') this.box(x1, p.y0, z + p.a, x1 + t, p.y1, z + p.b, wall);
        if (side === 'w') this.box(x - t, p.y0, z + p.a, x, p.y1, z + p.b, wall);
      }
    }
    return { x, z, w, d, y, h, cx: x + w / 2, cz: z + d / 2 };
  }

  /** A square column, floor to ceiling, with a band of trim at head height. */
  pillar(cx, cz, r, y0, y1, mat = MAT.concrete) {
    this.box(cx - r, y0, cz - r, cx + r, y1, cz + r, mat);
    this.box(cx - r - 0.12, y0 + 2.4, cz - r - 0.12, cx + r + 0.12, y0 + 2.7, cz + r + 0.12, MAT.trim, { detail: 2 });
  }

  /** A light. Radius is where it has fallen to nothing, power what it is at the
   *  lamp; both are baked into the geometry and read again for the flare. */
  light(x, y, z, opts = {}) {
    const l = {
      x, y, z,
      r: opts.r ?? 1, g: opts.g ?? 0.94, b: opts.b ?? 0.85,
      radius: opts.radius ?? 14,
      power: opts.power ?? 1,
      lamp: opts.lamp !== false,
      size: opts.size ?? 0.4,
    };
    this.lights.push(l);
    if (l.lamp) {
      this.box(x - l.size, y - 0.08, z - l.size, x + l.size, y + 0.08, z + l.size, MAT.trim, { glow: 1, nonsolid: true, detail: 2 });
    }
    return l;
  }

  spawn(x, y, z, yaw = 0, team = -1) {
    this.spawns.push({ x, y, z, yaw, team });
  }

  item(type, x, y, z, opts = {}) {
    this.items.push({ type, x, y, z, weapon: opts.weapon ?? -1, amount: opts.amount ?? 0 });
  }

  flag(team, x, y, z) {
    this.flags.push({ team, x, y, z });
  }

  /** A plate that throws you into the air. `vy` is the launch, and `push` an
   *  extra shove along the floor so a pad can be a bridge as well as a lift. */
  pad(x, z, w, d, y, vy, opts = {}) {
    this.box(x, y - 0.25, z, x + w, y + 0.05, z + d, MAT.trim, { glow: 0.6, nonsolid: false, detail: 2 });
    this.pads.push({
      x0: x, x1: x + w, z0: z, z1: z + d, y, vy,
      px: opts.px || 0, pz: opts.pz || 0,
    });
    this.light(x + w / 2, y + 1.0, z + d / 2, {
      r: 0.5, g: 0.9, b: 1, radius: 7, power: 0.7, lamp: false,
    });
  }

  /** A named point of interest. The bots read these: "the high ground", "the
   *  rocket", "our flag". Nothing else does. */
  mark(name, x, y, z, opts = {}) {
    this.marks.push({ name, x, y, z, team: opts.team ?? -1, weight: opts.weight ?? 1 });
  }

  // --- Mirroring -------------------------------------------------------------

  /** Everything from here on is one half of a symmetrical map. */
  beginMirror() {
    this.mirrorFrom = {
      solids: this.solids.length,
      lights: this.lights.length,
      spawns: this.spawns.length,
      items: this.items.length,
      flags: this.flags.length,
      pads: this.pads.length,
      marks: this.marks.length,
    };
  }

  /**
   * Repeat that half, mirrored through z = 0, with the teams swapped.
   *
   * Point symmetry (through the origin) would be the other choice and it is what
   * a lot of flag maps use; this is a plain reflection, because a reflection is
   * the one a player can hold in their head. Whatever is on your left at your
   * base is on your left at theirs.
   */
  endMirror() {
    const from = this.mirrorFrom;
    if (!from) return;
    this.mirrorFrom = null;
    const swap = (team) => (team === 0 ? 1 : team === 1 ? 0 : -1);
    // Every end is taken before anything is added: the lists being read are the
    // lists being written to, and a loop that re-reads `length` mirrors its own
    // reflection until the machine runs out of memory.
    const end = {
      solids: this.solids.length,
      lights: this.lights.length,
      spawns: this.spawns.length,
      items: this.items.length,
      flags: this.flags.length,
      pads: this.pads.length,
      marks: this.marks.length,
    };

    for (let i = from.solids; i < end.solids; i++) {
      const s = this.solids[i];
      const m = { ...s, z0: -s.z1, z1: -s.z0 };
      // A wedge carries which way it climbs, and a reflection reverses that -
      // but only for the axis being reflected. Miss this and the ramp up to one
      // team's flag is built upside down: a step at the bottom and a step at
      // the top, and no way onto the stand at all.
      if (m.type === 'ramp' && m.axis === 'z') m.dir = -m.dir;
      if (m.mat === MAT.red) m.mat = MAT.blue;
      else if (m.mat === MAT.blue) m.mat = MAT.red;
      if (m.skip === 'north') m.skip = 'south';
      else if (m.skip === 'south') m.skip = 'north';
      this.solids.push(m);
    }
    for (let i = from.lights; i < end.lights; i++) {
      this.lights.push({ ...this.lights[i], z: -this.lights[i].z });
    }
    for (let i = from.spawns; i < end.spawns; i++) {
      const s = this.spawns[i];
      this.spawns.push({ ...s, z: -s.z, yaw: -s.yaw + 32768, team: swap(s.team) });
    }
    for (let i = from.items; i < end.items; i++) {
      this.items.push({ ...this.items[i], z: -this.items[i].z });
    }
    for (let i = from.flags; i < end.flags; i++) {
      const f = this.flags[i];
      this.flags.push({ ...f, z: -f.z, team: swap(f.team) });
    }
    for (let i = from.pads; i < end.pads; i++) {
      const p = this.pads[i];
      this.pads.push({ ...p, z0: -p.z1, z1: -p.z0, pz: -p.pz });
    }
    for (let i = from.marks; i < end.marks; i++) {
      const m = this.marks[i];
      this.marks.push({ ...m, z: -m.z, team: swap(m.team) });
    }
  }
}
