/**
 * The geometry, as the simulation sees it: what stops a body, what stops a shot,
 * and what is under your feet.
 *
 * Everything here is pure and deterministic - the same call gives the same
 * answer on every machine, which it has to, because a shot that hits on one
 * machine and misses on another is the end of the netcode.
 *
 * Two shapes only. A box is four planes and a floor and a ceiling. A wedge is a
 * box with one plane taken out of it and it exists so that a slope can be walked
 * up rather than climbed. Everything is axis aligned, which is a real limit on
 * what the arenas can look like and the reason none of this needs an epsilon.
 */

import { P_STEP } from '../constants.js';

const CELL = 5; // metres. A map is a few hundred boxes; this makes a ray cheap.

/**
 * Index the solids into a grid on the floor plan.
 *
 * Height is not indexed. These are arenas: they are much wider than they are
 * tall, and a column of a map has few enough boxes in it that sorting them by
 * height would cost more than testing them.
 */
export function buildWorld(map) {
  const { bounds } = map;
  const x0 = Math.floor(bounds.x0 / CELL) - 1;
  const z0 = Math.floor(bounds.z0 / CELL) - 1;
  const nx = Math.ceil(bounds.x1 / CELL) - x0 + 2;
  const nz = Math.ceil(bounds.z1 / CELL) - z0 + 2;
  const cells = new Array(nx * nz);
  for (let i = 0; i < cells.length; i++) cells[i] = [];

  map.solids.forEach((s, index) => {
    s.index = index;
    const a = Math.max(0, Math.floor(s.x0 / CELL) - x0);
    const b = Math.min(nx - 1, Math.floor(s.x1 / CELL) - x0);
    const c = Math.max(0, Math.floor(s.z0 / CELL) - z0);
    const d = Math.min(nz - 1, Math.floor(s.z1 / CELL) - z0);
    for (let ix = a; ix <= b; ix++) {
      for (let iz = c; iz <= d; iz++) cells[iz * nx + ix].push(s);
    }
  });

  return {
    map, solids: map.solids, cells, nx, nz, x0, z0, cell: CELL,
    bounds, void: map.void, pads: map.pads,
    // A scratch mark per solid, so a query can visit the same box in two cells
    // without testing it twice. Bumped rather than cleared.
    seen: new Int32Array(map.solids.length),
    stamp: 0,
  };
}

/** Every solid whose footprint touches the given rectangle. */
export function solidsIn(world, minx, minz, maxx, maxz, out = []) {
  out.length = 0;
  const { cells, nx, nz, x0, z0 } = world;
  const a = Math.max(0, Math.floor(minx / CELL) - x0);
  const b = Math.min(nx - 1, Math.floor(maxx / CELL) - x0);
  const c = Math.max(0, Math.floor(minz / CELL) - z0);
  const d = Math.min(nz - 1, Math.floor(maxz / CELL) - z0);
  world.stamp++;
  const { seen, stamp } = world;
  for (let iz = c; iz <= d; iz++) {
    for (let ix = a; ix <= b; ix++) {
      for (const s of cells[iz * nx + ix]) {
        if (seen[s.index] === stamp) continue;
        seen[s.index] = stamp;
        out.push(s);
      }
    }
  }
  return out;
}

/**
 * How high a solid is, over the patch of floor a body is standing on.
 *
 * For a box this is just its top. For a wedge it is the highest point of the
 * slope anywhere under the body, which is what stops you sinking into a ramp
 * you are half on: a body is not a point, and the point of it nearest the top of
 * the hill is the one holding it up.
 */
export function topOf(s, minx, minz, maxx, maxz) {
  if (s.type !== 'ramp') return s.y1;
  const k = s.y1 - s.y0;
  let t;
  if (s.axis === 'x') {
    const lo = Math.max(s.x0, minx);
    const hi = Math.min(s.x1, maxx);
    const at = s.dir > 0 ? hi : lo;
    t = (at - s.x0) / (s.x1 - s.x0);
  } else {
    const lo = Math.max(s.z0, minz);
    const hi = Math.min(s.z1, maxz);
    const at = s.dir > 0 ? hi : lo;
    t = (at - s.z0) / (s.z1 - s.z0);
  }
  if (s.dir < 0) t = 1 - t;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return s.y0 + k * t;
}

// A hair of slack, so that a body standing exactly against a wall is on one
// side of it every time it is asked. Without it the answer depends on the last
// bit of a float, and a body can creep through a face a millimetre at a time.
const SKIN = 1e-6;

function overlapsXZ(s, minx, minz, maxx, maxz) {
  return s.x0 + SKIN < maxx && s.x1 - SKIN > minx && s.z0 + SKIN < maxz && s.z1 - SKIN > minz;
}

/** Is this box - a body, usually - inside anything solid? */
export function boxBlocked(world, minx, miny, minz, maxx, maxy, maxz, scratch = []) {
  const list = solidsIn(world, minx, minz, maxx, maxz, scratch);
  for (const s of list) {
    if (!overlapsXZ(s, minx, minz, maxx, maxz)) continue;
    const top = topOf(s, minx, minz, maxx, maxz);
    if (miny < top && maxy > s.y0) return s;
  }
  return null;
}

/**
 * The floor under a body, and how far down it is.
 *
 * Only surfaces at or below `fromY` count, and only by a hair above it, so that
 * standing on a step does not find the step you are standing on to be a ceiling.
 */
export function floorUnder(world, x, y, z, radius, reach = 4096) {
  const minx = x - radius;
  const maxx = x + radius;
  const minz = z - radius;
  const maxz = z + radius;
  const list = solidsIn(world, minx, minz, maxx, maxz);
  let best = -Infinity;
  let on = null;
  for (const s of list) {
    if (!overlapsXZ(s, minx, minz, maxx, maxz)) continue;
    const top = topOf(s, minx, minz, maxx, maxz);
    if (top > y + 0.001 || top < y - reach) continue;
    if (top > best) { best = top; on = s; }
  }
  return { y: best, solid: on };
}

/**
 * Move a body, one axis at a time, and tell the caller what it ran into.
 *
 * The order is X, Z, then Y, and it matters: doing the horizontal move first
 * means a body that walks off a ledge leaves the ledge before it starts to fall,
 * rather than clipping the corner of it on the way down. The step up happens
 * inside the horizontal pass - if the move was blocked, try it again from up to
 * P_STEP higher, and keep it if that fits. That one trick is stairs, kerbs, the
 * lip of a platform and half of what makes a map feel walkable.
 */
export function moveBody(world, body, dx, dy, dz, radius, height) {
  const scratch = [];
  const res = { hitX: false, hitZ: false, hitY: false, ground: null, ceiling: false, stepped: 0 };

  const fits = (x, y, z) => !boxBlocked(
    world, x - radius, y + 0.001, z - radius, x + radius, y + height, z + radius, scratch,
  );

  // Already inside something. It should not happen and it does: a blast throws
  // bodies, and a body thrown into the underside of a ramp has nowhere legal to
  // stand. Climb out - upwards first, because up is where the room is - and if
  // that fails, sideways. A body that cannot be freed is left where it is and
  // the simulation's own safety valve deals with it.
  if (!fits(body.x, body.y, body.z)) {
    res.freed = true;
    let out = false;
    for (const lift of [0.06, 0.16, 0.35, 0.6, 0.95, 1.4, 2.0]) {
      if (fits(body.x, body.y + lift, body.z)) { body.y += lift; out = true; break; }
    }
    if (!out) {
      for (const push of [0.25, 0.55, 0.9]) {
        for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          if (fits(body.x + ax * push, body.y, body.z + az * push)) {
            body.x += ax * push;
            body.z += az * push;
            out = true;
            break;
          }
        }
        if (out) break;
      }
    }
    if (!out) res.trapped = true;
  }

  // --- horizontal, X then Z ---
  for (const axis of ['x', 'z']) {
    const d = axis === 'x' ? dx : dz;
    if (d === 0) continue;
    const nx = axis === 'x' ? body.x + d : body.x;
    const nz = axis === 'z' ? body.z + d : body.z;
    if (fits(nx, body.y, nz)) {
      body.x = nx;
      body.z = nz;
      continue;
    }
    // Blocked. Is it a step rather than a wall?
    let climbed = false;
    if (body.onGround || body.stepGrace > 0) {
      const list = solidsIn(world, Math.min(body.x, nx) - radius, Math.min(body.z, nz) - radius,
        Math.max(body.x, nx) + radius, Math.max(body.z, nz) + radius, scratch);
      let lift = 0;
      for (const s of list) {
        if (!overlapsXZ(s, nx - radius, nz - radius, nx + radius, nz + radius)) continue;
        const top = topOf(s, nx - radius, nz - radius, nx + radius, nz + radius);
        const rise = top - body.y;
        if (rise > 0.0005 && rise <= P_STEP && top > lift + body.y) lift = rise;
      }
      if (lift > 0 && fits(nx, body.y + lift, nz)) {
        body.x = nx;
        body.z = nz;
        body.y += lift;
        res.stepped += lift;
        climbed = true;
      }
    }
    if (!climbed) {
      if (axis === 'x') res.hitX = true; else res.hitZ = true;
    }
  }

  // --- vertical ---
  if (dy !== 0) {
    const ny = body.y + dy;
    if (fits(body.x, ny, body.z)) {
      body.y = ny;
    } else if (dy < 0) {
      const floor = floorUnder(world, body.x, body.y + 0.05, body.z, radius, body.y - ny + 0.5);
      body.y = floor.y > -Infinity ? floor.y : body.y;
      res.hitY = true;
      res.ground = floor.solid;
    } else {
      res.hitY = true;
      res.ceiling = true;
    }
  }

  // Standing on something, or falling off it? Asked separately from the move,
  // because a body that was pushed sideways off a ledge is in the air even
  // though nothing about its vertical velocity has changed yet.
  const floor = floorUnder(world, body.x, body.y + 0.02, body.z, radius, 0.14);
  res.grounded = floor.y > -Infinity && body.y - floor.y < 0.12;
  if (res.grounded) {
    body.y = floor.y;
    res.ground = floor.solid;
  }
  return res;
}

// --- Shots -------------------------------------------------------------------

/**
 * A ray against one box: the slab test, and then the wedge's own plane if it has
 * one. Returns the near distance or -1.
 *
 * `pad` grows the box by a fixed amount in every direction, which is how a
 * rocket - which has a size - is traced as a point that is bigger than a point.
 */
function rayBox(s, ox, oy, oz, dx, dy, dz, maxDist, pad, out) {
  let t0 = 0;
  let t1 = maxDist;
  let nx = 0; let ny = 0; let nz = 0;
  const lo = [s.x0 - pad, s.y0 - pad, s.z0 - pad];
  const hi = [s.x1 + pad, s.y1 + pad, s.z1 + pad];
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  let axis = -1;
  let sign = 0;
  for (let i = 0; i < 3; i++) {
    if (d[i] === 0) {
      if (o[i] < lo[i] || o[i] > hi[i]) return -1;
      continue;
    }
    const inv = 1 / d[i];
    let ta = (lo[i] - o[i]) * inv;
    let tb = (hi[i] - o[i]) * inv;
    let sgn = -1;
    if (ta > tb) { const t = ta; ta = tb; tb = t; sgn = 1; }
    if (ta > t0) { t0 = ta; axis = i; sign = sgn; }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return -1;
  }

  if (s.type === 'ramp') {
    // Clip against the sloping face. The wedge is the half of the box under the
    // plane, so whichever end of the segment is above it gets cut off.
    const k = (s.y1 - s.y0) / (s.axis === 'x' ? s.x1 - s.x0 : s.z1 - s.z0);
    // f(p) = p.y - y0 - k * run, and run is measured from whichever end is low.
    const along = s.axis === 'x' ? 0 : 2;
    const base = s.dir > 0 ? (s.axis === 'x' ? s.x0 : s.z0) : (s.axis === 'x' ? s.x1 : s.z1);
    const kd = s.dir > 0 ? k : -k;
    const f0 = (oy - pad) - s.y0 - kd * (o[along] - base);
    const fd = dy - kd * d[along];
    let pa = -1;
    let pnx = 0; let pny = 1; let pnz = 0;
    if (s.axis === 'x') { pnx = -kd; } else { pnz = -kd; }
    const inv = 1 / Math.sqrt(pnx * pnx + 1 + pnz * pnz);
    pnx *= inv; pny *= inv; pnz *= inv;
    if (Math.abs(fd) < 1e-12) {
      if (f0 > 0) return -1; // parallel and outside
    } else {
      const tp = -f0 / fd;
      if (fd > 0) { // heading out through the slope
        if (tp < t1) t1 = tp;
      } else if (tp > t0) { t0 = tp; pa = 1; }
      if (t0 > t1) return -1;
    }
    if (pa === 1) {
      out.nx = pnx; out.ny = pny; out.nz = pnz;
      return t0 <= 0 ? 0 : t0;
    }
  }

  if (t1 < 0) return -1;
  if (axis === 0) { nx = sign; } else if (axis === 1) { ny = sign; } else if (axis === 2) { nz = sign; }
  out.nx = nx; out.ny = ny; out.nz = nz;
  return t0 <= 0 ? 0 : t0;
}

const hitScratch = { nx: 0, ny: 0, nz: 0 };

/**
 * A ray against the world. Walks the grid a cell at a time (a DDA) so a shot
 * down a long corridor tests the boxes in the corridor and not the boxes in the
 * rest of the map.
 */
export function traceRay(world, ox, oy, oz, dx, dy, dz, maxDist, pad = 0) {
  const hit = { dist: maxDist, solid: null, nx: 0, ny: 0, nz: 0, x: 0, y: 0, z: 0 };
  const { cells, nx: gnx, nz: gnz, x0, z0 } = world;

  let ix = Math.floor(ox / CELL) - x0;
  let iz = Math.floor(oz / CELL) - z0;
  const stepX = dx > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;
  const invX = dx === 0 ? Infinity : 1 / dx;
  const invZ = dz === 0 ? Infinity : 1 / dz;
  let tMaxX = dx === 0 ? Infinity
    : (((ix + x0 + (dx > 0 ? 1 : 0)) * CELL) - ox) * invX;
  let tMaxZ = dz === 0 ? Infinity
    : (((iz + z0 + (dz > 0 ? 1 : 0)) * CELL) - oz) * invZ;
  const tDeltaX = dx === 0 ? Infinity : Math.abs(CELL * invX);
  const tDeltaZ = dz === 0 ? Infinity : Math.abs(CELL * invZ);

  world.stamp++;
  const { seen, stamp } = world;
  let travelled = 0;
  let guard = 0;

  while (travelled <= hit.dist && guard++ < 4096) {
    if (ix >= 0 && ix < gnx && iz >= 0 && iz < gnz) {
      for (const s of cells[iz * gnx + ix]) {
        if (seen[s.index] === stamp) continue;
        seen[s.index] = stamp;
        const t = rayBox(s, ox, oy, oz, dx, dy, dz, hit.dist, pad, hitScratch);
        if (t >= 0 && t < hit.dist) {
          hit.dist = t;
          hit.solid = s;
          hit.nx = hitScratch.nx; hit.ny = hitScratch.ny; hit.nz = hitScratch.nz;
        }
      }
    }
    // The next cell boundary. Stop once the nearest hit is behind us: a hit
    // found in this cell can still be beaten by a box that overlaps it from the
    // next one, which is why the test is against the boundary and not the hit.
    const tNext = Math.min(tMaxX, tMaxZ);
    if (tNext > hit.dist) break;
    if (tMaxX < tMaxZ) { ix += stepX; travelled = tMaxX; tMaxX += tDeltaX; }
    else { iz += stepZ; travelled = tMaxZ; tMaxZ += tDeltaZ; }
    if (travelled > maxDist) break;
    if (ix < -1 || ix > gnx || iz < -1 || iz > gnz) break;
  }

  if (!hit.solid) { hit.dist = maxDist; return hit; }
  hit.x = ox + dx * hit.dist;
  hit.y = oy + dy * hit.dist;
  hit.z = oz + dz * hit.dist;
  return hit;
}

/** Can these two points see each other? The question the bots ask most. */
export function visible(world, ax, ay, az, bx, by, bz) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < 1e-6) return true;
  const hit = traceRay(world, ax, ay, az, dx / d, dy / d, dz / d, d - 0.02);
  return !hit.solid;
}

/** The pad under a body, if it is standing on one. */
export function padUnder(world, x, y, z) {
  for (const p of world.pads) {
    if (x >= p.x0 - 0.3 && x <= p.x1 + 0.3 && z >= p.z0 - 0.3 && z <= p.z1 + 0.3
      && y >= p.y - 0.4 && y <= p.y + 1.2) return p;
  }
  return null;
}
