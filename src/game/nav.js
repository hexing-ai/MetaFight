/**
 * Where a body can stand, and what it can walk to from there.
 *
 * The bots need to know the map. Hand-placed waypoints would mean every arena
 * came with a second arena drawn on top of it that somebody had to keep in step
 * with the first, so this reads the geometry instead: drop a column every metre
 * and a half, find every surface in that column a body actually fits on, and
 * join the ones you can get between.
 *
 * That gives three kinds of edge, and the difference between them is most of
 * what bot movement is:
 *
 *   walk  - level, or a step up. Free both ways.
 *   drop  - off a ledge. One way, and it costs a little, because falling off
 *           something is rarely the clever way round.
 *   pad   - a jump pad. One way, and it costs almost nothing, because that is
 *           what the pad is for.
 *
 * It is built once per map and cached. It is pure, so the bots on four machines
 * are reading the same map - which matters, because in lockstep a bot that
 * turned left here and right there would be a desync.
 */

import { P_HEIGHT, P_RADIUS, P_STEP } from '../constants.js';
import { boxBlocked, floorUnder, solidsIn, topOf } from './world.js';

const STEP = 1.5; // how far apart the columns are
const MAX_DROP = 7.0; // further than this and a bot will not throw itself off
/** What a body can climb by jumping, with a little kept back for the landing. */
const JUMP_UP = 1.15;
const cache = new Map();

export function buildNav(world) {
  const key = world.map.key;
  if (cache.has(key)) return cache.get(key);

  const { bounds } = world.map;
  const x0 = bounds.x0 + STEP * 0.5;
  const z0 = bounds.z0 + STEP * 0.5;
  const nx = Math.max(1, Math.floor((bounds.x1 - bounds.x0) / STEP));
  const nz = Math.max(1, Math.floor((bounds.z1 - bounds.z0) / STEP));

  const nodes = [];
  /** column index -> the node ids standing in it, low to high */
  const columns = new Array(nx * nz);
  const scratch = [];

  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      const x = x0 + ix * STEP;
      const z = z0 + iz * STEP;
      const ids = [];
      const minx = x - P_RADIUS;
      const maxx = x + P_RADIUS;
      const minz = z - P_RADIUS;
      const maxz = z + P_RADIUS;
      const list = solidsIn(world, minx, minz, maxx, maxz, scratch);
      const tops = [];
      for (const s of list) {
        if (s.x0 >= maxx || s.x1 <= minx || s.z0 >= maxz || s.z1 <= minz) continue;
        const top = topOf(s, minx, minz, maxx, maxz);
        if (top < bounds.y0 - 1 || top > bounds.y1) continue;
        tops.push(top);
      }
      tops.sort((a, b) => a - b);
      let last = -Infinity;
      for (const top of tops) {
        if (top - last < 0.15) continue; // the same surface, found twice
        if (top > bounds.y1 - 1.0) continue; // the roof of the world, not a floor in it
        // A body has to fit standing on it, with a little room to spare so a
        // bot is never routed through a gap it would graze. A surface that
        // fails this does not count as having been visited: where a step meets
        // the ledge it runs onto, the step is buried and the ledge is the floor,
        // and dropping both would leave the ledge unreachable.
        if (boxBlocked(world, minx, top + 0.05, minz, maxx, top + P_HEIGHT, maxz)) continue;
        last = top;
        ids.push(nodes.length);
        nodes.push({
          id: nodes.length, x, y: top, z, ix, iz, links: [], pad: null, item: -1, cover: 0,
        });
      }
      columns[iz * nx + ix] = ids;
    }
  }

  // --- edges ---
  const at = (ix, iz) => (ix < 0 || iz < 0 || ix >= nx || iz >= nz ? null : columns[iz * nx + ix]);
  const link = (a, b, cost, kind) => {
    const from = nodes[a];
    if (from.links.some((l) => l.to === b)) return;
    from.links.push({ to: b, cost, kind });
  };

  for (const node of nodes) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const ids = at(node.ix + dx, node.iz + dz);
      if (!ids) continue;
      const diagonal = dx !== 0 && dz !== 0;
      const flat = diagonal ? STEP * 1.4142 : STEP;
      for (const id of ids) {
        const other = nodes[id];
        const rise = other.y - node.y;
        if (rise > flat * 1.25) continue; // steeper than that is a wall

        if (rise >= -P_STEP) {
          // Walk it and see. Nothing shorter than this works: asking about the
          // two ends misses the wall between them, and asking about the middle
          // as well cannot tell a staircase from the edge of a platform, since
          // half a body's width over the lip of either the floor underneath is
          // the top. So the body is walked across in hand-sized steps, and every
          // one of them has to be a step it could take.
          if (walkable(world, node.x, node.y, node.z, other.x, other.y, other.z)) {
            link(node.id, id, rise > P_STEP ? flat * 1.4 : flat, rise > P_STEP ? 'climb' : 'walk');
          } else if (rise > P_STEP && rise <= JUMP_UP) {
            // Not a step and not a slope: a crate. A body clears 1.33 m, so
            // anything under that with room to land on is somewhere a bot can
            // get to - it just has to remember to jump, which is what the kind
            // on the link is for.
            if (boxBlocked(world, other.x - P_RADIUS, other.y + 0.05, other.z - P_RADIUS,
              other.x + P_RADIUS, other.y + P_HEIGHT, other.z + P_RADIUS)) continue;
            if (boxBlocked(world, node.x - P_RADIUS, node.y + 0.05, node.z - P_RADIUS,
              node.x + P_RADIUS, node.y + rise + P_HEIGHT, node.z + P_RADIUS)) continue;
            link(node.id, id, flat * 2.2, 'jump');
          }
        } else if (-rise <= MAX_DROP) {
          // Off a ledge, one way only. The cost grows with the square of the
          // drop, which is what stops a route planner treating a six metre
          // chasm as a shortcut: it is, in metres, and it is also the bottom of
          // a chasm with one way out and everybody above you.
          const midx = (node.x + other.x) / 2;
          const midz = (node.z + other.z) / 2;
          if (boxBlocked(world, midx - P_RADIUS, node.y + 0.05, midz - P_RADIUS,
            midx + P_RADIUS, node.y + P_HEIGHT, midz + P_RADIUS)) continue;
          const drop = -rise;
          link(node.id, id, flat + drop * drop * 0.7, 'drop');
        }
      }
    }
  }

  // --- jump pads ---
  //
  // Where a pad puts you is worked out the way the simulation would: launch it,
  // let it fall, and see what it lands on. The bot then only has to want to be
  // on the pad, which is a thing pathfinding can express.
  for (const pad of world.pads) {
    const cx = (pad.x0 + pad.x1) / 2;
    const cz = (pad.z0 + pad.z1) / 2;
    const from = nearestNode({ nodes }, cx, pad.y + 0.2, cz, 3);
    if (from < 0) continue;
    nodes[from].pad = pad;
    const flight = predictPad(world, pad);
    const to = nearestNode({ nodes }, flight.x, flight.y, flight.z, 4);
    if (to >= 0 && to !== from) link(from, to, 2, 'pad');
  }

  const nav = { nodes, nx, nz, x0, z0, step: STEP, columns };
  cache.set(key, nav);
  return nav;
}

/**
 * Could a body walk from here to there?
 *
 * Sampled every third of a metre: at each sample it may step up by at most
 * P_STEP and fall by very little, there has to be something under it, and it
 * has to fit. That is the whole of walking, and it is the only test that gets
 * stairs, ramps, thresholds, ledges and gaps all right.
 */
function walkable(world, ax, ay, az, bx, by, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const steps = Math.max(2, Math.ceil(dist / 0.34));
  let y = ay;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = ax + dx * t;
    const z = az + dz * t;
    const floor = floorUnder(world, x, y + P_STEP, z, P_RADIUS, P_STEP + 0.75);
    if (floor.y === -Infinity) return false; // walked off the edge of the world
    if (floor.y > y + P_STEP + 1e-9) return false;
    y = floor.y;
    if (boxBlocked(world, x - P_RADIUS, y + 0.05, z - P_RADIUS,
      x + P_RADIUS, y + P_HEIGHT, z + P_RADIUS)) return false;
  }
  return Math.abs(y - by) < 0.45;
}

/** Where a pad throws you, by simply throwing something off it. */
function predictPad(world, pad) {
  const dt = 1 / 60;
  let x = (pad.x0 + pad.x1) / 2;
  let z = (pad.z0 + pad.z1) / 2;
  let y = pad.y + 0.1;
  let vy = pad.vy;
  const vx = pad.px;
  const vz = pad.pz;
  for (let i = 0; i < 240; i++) {
    vy -= 24 * dt;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    if (vy < 0) {
      const floor = floorUnder(world, x, y, z, P_RADIUS, 0.4);
      if (floor.y > -Infinity) return { x, y: floor.y, z };
    }
  }
  return { x, y, z };
}

/** The node nearest a point, within `reach` metres. -1 if there is none. */
export function nearestNode(nav, x, y, z, reach = 6) {
  let best = -1;
  let bestD = reach * reach;
  for (const node of nav.nodes) {
    const dx = node.x - x;
    const dz = node.z - z;
    const dy = (node.y - y) * 1.8; // height counts for more: the floor above is not near
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) { bestD = d; best = node.id; }
  }
  return best;
}

/**
 * A* from one node to another, returning the ids to walk in order.
 *
 * The heap is a plain array kept sorted by insertion, which for graphs of a
 * thousand nodes and paths of thirty is faster than a real one and much shorter
 * to read.
 */
export function findPath(nav, from, to, out = []) {
  out.length = 0;
  if (from < 0 || to < 0) return out;
  if (from === to) { out.push(to); return out; }
  const { nodes } = nav;
  const n = nodes.length;
  if (!nav.scratch || nav.scratch.g.length !== n) {
    nav.scratch = {
      g: new Float64Array(n), f: new Float64Array(n), came: new Int32Array(n),
      seen: new Int32Array(n), stamp: 0, open: [],
    };
  }
  const sc = nav.scratch;
  sc.stamp++;
  const { g, f, came, seen, stamp } = sc;
  const open = sc.open;
  open.length = 0;

  const target = nodes[to];
  const h = (node) => {
    const dx = node.x - target.x;
    const dy = node.y - target.y;
    const dz = node.z - target.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  g[from] = 0;
  f[from] = h(nodes[from]);
  came[from] = -1;
  seen[from] = stamp;
  open.push(from);

  let guard = 0;
  while (open.length && guard++ < 20000) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
    const current = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    if (current === to) {
      let at = to;
      while (at >= 0) { out.push(at); at = came[at]; }
      out.reverse();
      return out;
    }
    for (const linkTo of nodes[current].links) {
      const next = linkTo.to;
      const tentative = g[current] + linkTo.cost;
      if (seen[next] === stamp && tentative >= g[next]) continue;
      seen[next] = stamp;
      g[next] = tentative;
      f[next] = tentative + h(nodes[next]);
      came[next] = current;
      if (!open.includes(next)) open.push(next);
    }
  }
  return out;
}

/** How many nodes can be reached from this one. The map test's only question. */
export function reachable(nav, from) {
  const seen = new Uint8Array(nav.nodes.length);
  const queue = [from];
  seen[from] = 1;
  let count = 1;
  while (queue.length) {
    const id = queue.pop();
    for (const link of nav.nodes[id].links) {
      if (seen[link.to]) continue;
      seen[link.to] = 1;
      count++;
      queue.push(link.to);
    }
  }
  return { count, seen };
}
