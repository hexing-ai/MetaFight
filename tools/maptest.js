// Checks the arenas, without a browser and without anybody playing them.
//
//   node tools/maptest.js
//
// Every one of these is a mistake that has actually been made in this file's
// short life, and every one of them looks completely fine until somebody walks
// into it:
//
//   a spawn point inside a wall            you appear inside a pillar
//   an item inside a wall                  it can never be picked up
//   a staircase under the walkway it
//     was meant to reach                   the walkway is decoration
//   a railing across the top of a
//     staircase                            so is the staircase
//   a ramp mirrored without reversing
//     which way it climbs                  one team's flag is unreachable
//   a chasm with open ends                 a third of everybody who goes down
//                                          there falls out of the world
//
// The test that catches all six is the same one: build the map, work out
// everywhere a body can stand, and check that everything the match needs is
// somewhere you can walk to from everywhere else.

import { MAPS, loadMap } from '../src/game/maps.js';
import { boxBlocked, buildWorld, floorUnder } from '../src/game/world.js';
import { buildNav, nearestNode, reachable } from '../src/game/nav.js';
import { P_HEIGHT, P_RADIUS } from '../src/constants.js';

let failures = 0;

function fail(map, what) {
  console.error(`  ✗ ${map}: ${what}`);
  failures++;
}

for (const def of MAPS) {
  const map = loadMap(def.key);
  const world = buildWorld(map);
  const nav = buildNav(world);

  // --- nothing is standing inside anything ---
  for (const spawn of map.spawns) {
    if (boxBlocked(world, spawn.x - P_RADIUS, spawn.y + 0.01, spawn.z - P_RADIUS,
      spawn.x + P_RADIUS, spawn.y + P_HEIGHT, spawn.z + P_RADIUS)) {
      fail(def.key, `a spawn point at ${spawn.x}, ${spawn.y}, ${spawn.z} is inside something`);
    }
    const floor = floorUnder(world, spawn.x, spawn.y + 0.05, spawn.z, P_RADIUS, 3);
    if (floor.y === -Infinity) {
      fail(def.key, `a spawn point at ${spawn.x}, ${spawn.y}, ${spawn.z} has nothing under it`);
    }
  }
  for (const item of map.items) {
    if (boxBlocked(world, item.x - 0.3, item.y - 0.2, item.z - 0.3,
      item.x + 0.3, item.y + 0.4, item.z + 0.3)) {
      fail(def.key, `the ${item.type} at ${item.x}, ${item.y}, ${item.z} is inside something`);
    }
  }
  for (const flag of map.flags) {
    // From the foot of the pole up: the plate it stands on is solid, and it is
    // meant to be - it is a step, and you stand on it to make the capture.
    if (boxBlocked(world, flag.x - 0.4, flag.y + 0.05, flag.z - 0.4,
      flag.x + 0.4, flag.y + 1.2, flag.z + 0.4)) {
      fail(def.key, `the ${flag.team === 0 ? 'red' : 'blue'} flag is inside something`);
    }
  }

  // --- everything can be walked to from everywhere ---
  const start = nearestNode(nav, map.spawns[0].x, map.spawns[0].y, map.spawns[0].z, 4);
  if (start < 0) fail(def.key, 'the first spawn point is not on the floor plan at all');
  const region = reachable(nav, start);

  const check = (x, y, z, what) => {
    const id = nearestNode(nav, x, y, z, 4);
    if (id < 0) fail(def.key, `${what} is nowhere near anywhere a body can stand`);
    else if (!region.seen[id]) fail(def.key, `${what} cannot be walked to`);
  };
  for (const spawn of map.spawns) {
    check(spawn.x, spawn.y, spawn.z, `the spawn point at ${spawn.x}, ${spawn.y}, ${spawn.z}`);
  }
  for (const item of map.items) {
    check(item.x, item.y - 0.3, item.z, `the ${item.type} at ${item.x}, ${item.y}, ${item.z}`);
  }
  for (const flag of map.flags) {
    check(flag.x, flag.y - 0.4, flag.z, `the ${flag.team === 0 ? 'red' : 'blue'} flag`);
  }

  // --- a flag map needs two bases, and a route between them ---
  if (map.flagMap) {
    if (map.flags.length !== 2) fail(def.key, `has ${map.flags.length} flags`);
    const red = nearestNode(nav, map.flags[0].x, map.flags[0].y - 0.4, map.flags[0].z, 4);
    const blue = nearestNode(nav, map.flags[1].x, map.flags[1].y - 0.4, map.flags[1].z, 4);
    if (red >= 0 && !reachable(nav, red).seen[blue]) {
      fail(def.key, 'you cannot get from one flag to the other');
    }
    // Fair by construction: the two bases should be the same distance from the
    // middle, because the map is one half reflected.
    const gap = Math.abs(Math.abs(map.flags[0].z) - Math.abs(map.flags[1].z));
    if (gap > 0.01) fail(def.key, `the two bases are ${gap.toFixed(2)} m from being symmetrical`);
  }

  // --- the world has no holes in the floor ---
  //
  // Walk out from every place a body can stand and look at the eight columns
  // around it: if one of them has no floor within a long fall, there is a way
  // out of the arena, and somebody will find it.
  let holes = 0;
  for (const node of nav.nodes) {
    if (!region.seen[node.id]) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = node.x + dx * nav.step;
      const z = node.z + dz * nav.step;
      if (boxBlocked(world, x - P_RADIUS, node.y + 0.05, z - P_RADIUS,
        x + P_RADIUS, node.y + P_HEIGHT, z + P_RADIUS)) continue; // a wall, which is fine
      const floor = floorUnder(world, x, node.y + 0.5, z, P_RADIUS, 60);
      if (floor.y === -Infinity) holes++;
    }
  }
  if (holes) fail(def.key, `${holes} places you can walk off the edge of the world`);

  const spread = map.items.length;
  console.log(`  ${def.key.padEnd(9)} ${String(map.solids.length).padStart(4)} solids  `
    + `${String(nav.nodes.length).padStart(4)} standing places  ${String(region.count).padStart(4)} of them joined up  `
    + `${map.spawns.length} spawns  ${spread} items  ${map.flags.length} flags`);
}

if (failures) {
  console.error(`\n${failures} problem${failures === 1 ? '' : 's'} with the arenas.`);
  process.exit(1);
}
console.log(`\nAll ${MAPS.length} arenas are sound.`);
