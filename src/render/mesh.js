/**
 * The arena, turned into triangles, and lit before anybody arrives.
 *
 * This is where the game stops looking like the game before it. WebTrack's world
 * was flat-shaded polygons with a colour per surface; this one is the same boxes
 * cut into a great many small quads, with the light worked out at every corner
 * of every one of them - including whether anything is in the way.
 *
 * Three things are baked in, and all three are just rays against the geometry
 * the simulation already uses:
 *
 *   direct light   every lamp within reach, attenuated, angled to the surface,
 *                  and blocked if there is a wall between the two
 *   occlusion      a short fan of rays off the surface: how much of the room can
 *                  this corner see? It is what darkens the inside of corners and
 *                  under the walkways, and it is most of why the picture reads
 *                  as a place rather than a diagram
 *   emission       lamps, rails and pad plates lighting themselves
 *
 * It costs a fraction of a second per arena and it is done once. Nothing about
 * it moves, so the only lights the graphics card ever computes are the four or
 * five things actually on fire at that moment.
 */

import { traceRay } from '../game/world.js';

/** How finely a face is cut up. Smaller means better light and more triangles. */
const QUAD = 1.6;
/** Metres of wall per repeat of a texture. */
const TEX_SCALE = 2.6;
const AO_RAYS = 6;
const AO_REACH = 2.6;

// `flip` is whether the grid's own two axes wind the wrong way round for this
// face: u cross v points along the normal for three of the six, and against it
// for the other three.
const FACES = [
  { key: 'east', n: [1, 0, 0], axis: 0, flip: true },
  { key: 'west', n: [-1, 0, 0], axis: 0, flip: false },
  { key: 'up', n: [0, 1, 0], axis: 1, flip: true },
  { key: 'down', n: [0, -1, 0], axis: 1, flip: false },
  { key: 'north', n: [0, 0, 1], axis: 2, flip: false },
  { key: 'south', n: [0, 0, -1], axis: 2, flip: true },
];

export function buildMesh(world, map) {
  const t0 = Date.now();
  const verts = [];
  const perMaterial = [];
  for (let i = 0; i < 8; i++) perMaterial.push([]);

  const ambient = map.ambient;
  const lights = map.lights;
  let vertexCount = 0;

  for (const solid of map.faces) {
    if (solid.type === 'ramp') {
      // A wedge is a box with one corner taken off, so it is drawn as: the
      // underside, the tall end, the sloping top, and two triangles for the
      // sides. The short end has no height at all and is not drawn.
      const lowEnd = solid.axis === 'x' ? (solid.dir > 0 ? 'west' : 'east')
        : (solid.dir > 0 ? 'south' : 'north');
      for (const face of FACES) {
        if (face.key === 'up' || face.key === lowEnd) continue;
        if (solid.axis === 'x' && (face.key === 'north' || face.key === 'south')) continue;
        if (solid.axis === 'z' && (face.key === 'east' || face.key === 'west')) continue;
        if (solid.skip === face.key) continue;
        emitFace(solid, face);
      }
      emitRampSides(solid);
      emitSlope(solid);
      continue;
    }
    for (const face of FACES) {
      if (solid.skip === face.key) continue;
      emitFace(solid, face);
    }
  }

  /** One flat side of a box, cut into a grid and lit at every corner. */
  function emitFace(solid, face) {
    const { n } = face;
    // The two axes that run across this face, and where the face sits on the
    // third. `u` and `v` are world axes, so two boxes that meet keep their
    // texture in step - which is the whole reason the coordinates are not
    // per-face.
    let uAxis;
    let vAxis;
    let at;
    if (face.axis === 0) { uAxis = 2; vAxis = 1; at = n[0] > 0 ? solid.x1 : solid.x0; } else if (face.axis === 1) { uAxis = 0; vAxis = 2; at = n[1] > 0 ? solid.y1 : solid.y0; } else { uAxis = 0; vAxis = 1; at = n[2] > 0 ? solid.z1 : solid.z0; }

    const lo = [solid.x0, solid.y0, solid.z0];
    const hi = [solid.x1, solid.y1, solid.z1];
    const u0 = lo[uAxis];
    const u1 = hi[uAxis];
    const v0 = lo[vAxis];
    const v1 = hi[vAxis];
    const du = u1 - u0;
    const dv = v1 - v0;
    if (du < 0.001 || dv < 0.001) return;

    const step = QUAD / (solid.detail || 1);
    const nu = Math.max(1, Math.min(24, Math.round(du / step)));
    const nv = Math.max(1, Math.min(24, Math.round(dv / step)));

    const base = vertexCount;
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const u = u0 + (du * i) / nu;
        const v = v0 + (dv * j) / nv;
        const p = [0, 0, 0];
        p[uAxis] = u;
        p[vAxis] = v;
        p[face.axis] = at;
        pushVertex(p, n, solid.decal ? (u-u0)/du : u / TEX_SCALE, solid.decal ? (v-v0)/dv : v / TEX_SCALE, solid);
      }
    }

    const indices = perMaterial[solid.mat] || perMaterial[0];
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        // A quad whose middle is inside something else is a quad nobody can
        // see: two boxes that meet bury a face each, and drawing them both is
        // how a wall ends up flickering.
        const cu = u0 + (du * (i + 0.5)) / nu;
        const cv = v0 + (dv * (j + 0.5)) / nv;
        const c = [0, 0, 0];
        c[uAxis] = cu;
        c[vAxis] = cv;
        c[face.axis] = at + n[face.axis] * 0.02;
        if (buried(c[0], c[1], c[2], solid)) continue;

        const a = base + j * (nu + 1) + i;
        const b = a + 1;
        const d = a + (nu + 1);
        const e = d + 1;
        // Wound so the front of the face is the side the normal points at.
        if (face.flip) indices.push(a, e, b, a, d, e);
        else indices.push(a, b, e, a, e, d);
      }
    }
  }

  /** The two triangular cheeks of a wedge. */
  function emitRampSides(solid) {
    const along = solid.axis === 'x' ? 0 : 2;
    const across = along === 0 ? 2 : 0;
    const lo = [solid.x0, solid.y0, solid.z0];
    const hi = [solid.x1, solid.y1, solid.z1];
    const lowAt = solid.dir > 0 ? lo[along] : hi[along];
    const highAt = solid.dir > 0 ? hi[along] : lo[along];
    const indices = perMaterial[solid.mat] || perMaterial[0];

    for (const side of [0, 1]) {
      const w = side === 0 ? lo[across] : hi[across];
      const n = [0, 0, 0];
      n[across] = side === 0 ? -1 : 1;
      const corner = (a, y) => {
        const p = [0, 0, 0];
        p[along] = a;
        p[across] = w;
        p[1] = y;
        pushVertex(p, n, a / TEX_SCALE, y / TEX_SCALE, solid);
      };
      const base = vertexCount;
      corner(lowAt, solid.y0);
      corner(highAt, solid.y0);
      corner(highAt, solid.y1);
      // Which way round depends on which cheek and which way the wedge climbs.
      const cw = (side === 0) === ((solid.dir > 0) === (along === 0));
      if (cw) indices.push(base, base + 1, base + 2);
      else indices.push(base, base + 2, base + 1);
    }
  }

  /** The sloping top of a wedge: the same grid, tilted. */
  function emitSlope(solid) {
    const along = solid.axis === 'x' ? 0 : 2;
    const across = along === 0 ? 2 : 0;
    const lo = [solid.x0, solid.y0, solid.z0];
    const hi = [solid.x1, solid.y1, solid.z1];
    const run = hi[along] - lo[along];
    const rise = solid.y1 - solid.y0;
    const width = hi[across] - lo[across];
    const slope = rise / run;

    const n = [0, 0, 0];
    n[1] = 1;
    n[along] = -slope * solid.dir;
    const nl = Math.sqrt(n[0] * n[0] + 1 + n[2] * n[2]);
    n[0] /= nl; n[1] /= nl; n[2] /= nl;

    const nu = Math.max(1, Math.min(24, Math.round(run / QUAD)));
    const nv = Math.max(1, Math.min(24, Math.round(width / QUAD)));
    const base = vertexCount;
    const heightAt = (t) => solid.y0 + rise * (solid.dir > 0 ? t : 1 - t);

    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const t = i / nu;
        const p = [0, 0, 0];
        p[along] = lo[along] + run * t;
        p[across] = lo[across] + (width * j) / nv;
        p[1] = heightAt(t);
        pushVertex(p, n, p[along] / TEX_SCALE, p[across] / TEX_SCALE, solid);
      }
    }
    const indices = perMaterial[solid.mat] || perMaterial[0];
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = base + j * (nu + 1) + i;
        const b = a + 1;
        const d = a + (nu + 1);
        const e = d + 1;
        if (along === 0) indices.push(a, e, b, a, d, e);
        else indices.push(a, b, e, a, e, d);
      }
    }
  }

  function pushVertex(p, n, u, v, solid) {
    const light = shade(p[0], p[1], p[2], n[0], n[1], n[2], solid);
    verts.push(p[0], p[1], p[2], n[0], n[1], n[2], u, v, light[0], light[1], light[2]);
    vertexCount++;
  }

  const scratch = [];
  function buried(x, y, z, self) {
    for (const s of map.solids) {
      if (s === self || s.nonsolid) continue;
      if (x > s.x0 + 0.001 && x < s.x1 - 0.001 && y > s.y0 + 0.001 && y < s.y1 - 0.001
        && z > s.z0 + 0.001 && z < s.z1 - 0.001) {
        if (s.type === 'ramp') {
          const t = s.axis === 'x' ? (x - s.x0) / (s.x1 - s.x0) : (z - s.z0) / (s.z1 - s.z0);
          const tt = s.dir > 0 ? t : 1 - t;
          if (y > s.y0 + (s.y1 - s.y0) * tt) continue;
        }
        return true;
      }
    }
    return false;
  }

  /** What colour this corner of the world is, before anything is drawn on it. */
  function shade(x, y, z, nx, ny, nz, solid) {
    // Off the surface a little, or every ray starts inside the wall it is on.
    const ox = x + nx * 0.03;
    const oy = y + ny * 0.03;
    const oz = z + nz * 0.03;

    let r = ambient[0];
    let g = ambient[1];
    let b = ambient[2];

    // Occlusion: how much of the room can this corner see? A fan around the
    // normal rather than a proper hemisphere, because six rays is the budget.
    let open = 0;
    for (let i = 0; i < AO_RAYS; i++) {
      const a = (i / AO_RAYS) * Math.PI * 2 + (x + z) * 0.7;
      const tilt = 0.62;
      let dx = nx + (nz === 0 && nx === 0 ? Math.cos(a) : (nz !== 0 ? Math.cos(a) : 0)) * tilt;
      let dy = ny + (ny === 0 ? Math.sin(a) * tilt : 0);
      let dz = nz + (nx !== 0 ? Math.cos(a) * tilt : 0) + (ny !== 0 ? Math.sin(a) * tilt * 0 : 0);
      if (ny !== 0) { dx = nx + Math.cos(a) * tilt; dz = nz + Math.sin(a) * tilt; }
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const hit = traceRay(world, ox, oy, oz, dx / l, dy / l, dz / l, AO_REACH);
      open += hit.solid ? Math.min(1, hit.dist / AO_REACH) : 1;
    }
    const ao = 0.16 + 0.84 * (open / AO_RAYS);

    // The sky, for the arenas that have one. Straight up, and blocked by a roof.
    if (map.outdoor && ny > -0.2) {
      const up = traceRay(world, ox, oy, oz, 0, 1, 0, 60);
      if (!up.solid) {
        const face = 0.3 + 0.7 * Math.max(0, ny);
        r += map.sky[0] * face * 0.42;
        g += map.sky[1] * face * 0.42;
        b += map.sky[2] * face * 0.42;
      }
    }

    if (map.daylight) {
      const lam=Math.max(0,nx*-.46+ny*.82+nz*.34);
      if(lam>0 && !traceRay(world,ox,oy,oz,-.46,.82,.34,90).solid){
        r+=lam*.64;g+=lam*.59;b+=lam*.49;
      }
    }
    for (const light of lights) {
      const dx = light.x - ox;
      const dy = light.y - oy;
      const dz = light.z - oz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > light.radius * light.radius) continue;
      const d = Math.sqrt(d2) || 0.0001;
      const lambert = (dx * nx + dy * ny + dz * nz) / d;
      if (lambert <= 0.01) continue;
      const fall = 1 - d / light.radius;
      const power = fall * fall * light.power * lambert * 1.6;
      if (power < 0.004) continue;
      const hit = traceRay(world, ox, oy, oz, dx / d, dy / d, dz / d, d - 0.05);
      if (hit.solid) continue;
      r += light.r * power;
      g += light.g * power;
      b += light.b * power;
    }

    r *= ao; g *= ao; b *= ao;

    // Something that lights itself is not shadowed by anything, so it is added
    // afterwards: a lamp in a dark corner is still a lamp.
    // Enough to read as "this is lit from inside" and not enough to blow the
    // texture off it: a jump pad should look like a plate with a light under it,
    // not like a hole in the floor.
    if (solid.glow) {
      r += solid.glow * 0.62;
      g += solid.glow * 0.62;
      b += solid.glow * 0.6;
    }
    return [r, g, b];
  }

  // --- one buffer, one index range per material ---
  const groups = [];
  let total = 0;
  for (const list of perMaterial) total += list.length;
  const indices = new Uint32Array(total);
  let at = 0;
  perMaterial.forEach((list, mat) => {
    if (!list.length) return;
    indices.set(list, at);
    groups.push({ mat, offset: at, count: list.length });
    at += list.length;
  });

  return {
    vertices: new Float32Array(verts),
    indices,
    groups,
    vertexCount,
    triangles: total / 3,
    ms: Date.now() - t0,
  };
}

/**
 * The light at a point in mid air, for the things that move through it.
 *
 * The world's light is baked into the walls, so a body walking past a lamp would
 * be lit by nothing at all unless somebody asked. This is that question, and it
 * is asked a few times a second per body rather than per pixel.
 */
export function sampleLight(world, map, x, y, z, out = [0, 0, 0]) {
  out[0] = map.ambient[0] * 3.0;
  out[1] = map.ambient[1] * 3.0;
  out[2] = map.ambient[2] * 3.0;
  if (map.outdoor) {
    const up = traceRay(world, x, y, z, 0, 1, 0, 60);
    if (!up.solid) {
      out[0] += map.sky[0] * 0.3;
      out[1] += map.sky[1] * 0.3;
      out[2] += map.sky[2] * 0.3;
    }
  }
  for (const light of map.lights) {
    const dx = light.x - x;
    const dy = light.y - y;
    const dz = light.z - z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > light.radius * light.radius) continue;
    const d = Math.sqrt(d2) || 0.0001;
    const fall = 1 - d / light.radius;
    const power = fall * fall * light.power * 1.25;
    if (power < 0.01) continue;
    if (traceRay(world, x, y, z, dx / d, dy / d, dz / d, d - 0.05).solid) continue;
    out[0] += light.r * power;
    out[1] += light.g * power;
    out[2] += light.b * power;
  }
  return out;
}
