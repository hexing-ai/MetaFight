/**
 * The arenas.
 *
 * Five of them, and between them they are meant to cover the four shapes an
 * arena shooter needs: a big industrial hall with a hole in the middle of it, a
 * tight tower you fight up and down rather than across, an open field for the
 * rifle, and two flag maps that are fair because they are built as one half and
 * reflected.
 *
 * A map is a function that is handed a Builder and puts boxes in it. It is run
 * once, cached, and the result is compiled into the arrays the simulation, the
 * bots and the light bake all read - see compile() at the bottom. Nothing in
 * here knows about WebGL, and nothing in here may use Math.random: two machines
 * are going to build this same arena and they had better agree about it.
 *
 * A word about the numbers. A body is 1.8 m tall and 0.84 m across, it runs at
 * 9 m/s and jumps 1.3 m. So a corridor under 2.5 m wide is a corridor you cannot
 * dodge in, a ledge over 1.3 m needs a ramp or a pad, and a room you cross in
 * under two seconds is a room, not an arena.
 */

import { Builder, MAT } from './build.js';
import { WEAPON_INDEX } from '../constants.js';

const W = WEAPON_INDEX;

// --- Foundry -----------------------------------------------------------------

function foundry(b) {
  const H = 11;
  b.room({
    x: -22, z: -18, w: 44, d: 36, h: H, noFloor: true,
    wall: MAT.concrete, ceil: MAT.panel,
  });

  // The floor, in four pieces, because the middle of it is missing. The pit is
  // three metres down and it is where the rocket lives: the best gun in the map
  // is at the bottom of the one place in it you cannot see out of.
  b.box(-22.6, -3.4, -18.6, -8, 0, 18.6, MAT.floor, { skip: 'down' });
  b.box(8, -3.4, -18.6, 22.6, 0, 18.6, MAT.floor, { skip: 'down' });
  b.box(-8, -3.4, 11, 8, 0, 18.6, MAT.floor, { skip: 'down' });
  b.box(-8, -3.4, -18.6, 8, 0, -11, MAT.floor, { skip: 'down' });
  b.box(-8, -3.6, -11, 8, -3, 11, MAT.rust, { skip: 'down' });

  // Two ramps out of it, north and south, and they are the only walk out: every
  // other way is a jump you have to have somewhere to jump from.
  b.ramp(-4, -3, 6, 4, 0, 11, 'z', 1, MAT.rust);
  b.ramp(-4, -3, -11, 4, 0, -6, 'z', -1, MAT.rust);

  // The gantry: a ring at five metres, four wide, on pillars. Everything good is
  // on it and everything on it can be seen from the pit.
  const gantry = (x0, z0, x1, z1) => b.box(x0, 4.7, z0, x1, 5, z1, MAT.rust, { skip: '' });
  gantry(-22, -18, -18, 18);
  gantry(18, -18, 22, 18);
  gantry(-18, 14, 18, 18);
  gantry(-18, -18, 18, -14);
  for (const x of [-18, 18]) {
    for (const z of [-14, -6, 2, 10]) b.pillar(x, z, 0.45, 0, 4.7, MAT.panel);
  }
  // Railings, so the edge reads as an edge from the floor below.
  // Railing along the inner edge, in pieces: there is a gap in it where each
  // staircase arrives, because a railing across the top of a staircase is a
  // staircase to nowhere - and it took a connectivity test to notice.
  const rail = (x0, z0, x1, z1) => b.box(x0, 5, z0, x1, 6.1, z1, MAT.trim, { detail: 2 });
  rail(-18.2, -14, -18, 7.2);
  rail(-18.2, 9.8, -18, 14);
  rail(18, -14, 18.2, -9.8);
  rail(18, -7.2, 18.2, 14);
  rail(-18, 13.8, 18, 14);
  rail(-18, -14, 18, -13.8);

  b.stairs(-18, 8, 4, 6, 0, 5, 11, 'z', -1, MAT.panel);
  b.stairs(14, -14, 4, 6, 0, 5, 11, 'z', 1, MAT.panel);

  // Out of the pit the short way, if you can stand still long enough to use it.
  b.pad(-1.6, -1.6, 3.2, 3.2, -3, 21.5);

  // Alcoves in the long walls: cover at floor level and a step up to the gantry.
  for (const side of [-1, 1]) {
    b.box(side * 21.4, 0, -4, side * 22, 3.4, 4, MAT.panel, { skip: '' });
    b.box(side * 16, 0, -1.4, side * 17.2, 1.6, 1.4, MAT.concrete);
  }
  b.box(-2, 0, 15.5, 2, 2.2, 17.5, MAT.concrete);
  b.box(-2, 0, -17.5, 2, 2.2, -15.5, MAT.concrete);

  b.light(0, 9.6, 0, { radius: 26, power: 1.5, r: 1, g: 0.93, b: 0.8, size: 0.9 });
  b.light(-13, 9.6, 11, { radius: 20, power: 1.1 });
  b.light(13, 9.6, 11, { radius: 20, power: 1.1 });
  b.light(-13, 9.6, -11, { radius: 20, power: 1.1 });
  b.light(13, 9.6, -11, { radius: 20, power: 1.1 });
  // The furnace glow out of the pit. It is the only warm light below the gantry
  // and it is what tells you, from across the hall, that somebody is down there.
  b.light(0, -1.6, 0, { radius: 15, power: 1.9, r: 1, g: 0.45, b: 0.16, lamp: false });
  b.light(0, 3.2, 15.5, { radius: 12, power: 0.8, r: 0.7, g: 0.85, b: 1 });
  b.light(0, 3.2, -15.5, { radius: 12, power: 0.8, r: 0.7, g: 0.85, b: 1 });

  b.item('weapon', 0, -2.4, 0, { weapon: W.rocket });
  b.item('weapon', 0, 5.3, 16, { weapon: W.rail });
  b.item('weapon', 0, 5.3, -16, { weapon: W.scatter });
  b.item('weapon', -20, 0.3, 0, { weapon: W.scatter });
  b.item('armour', 20, 5.3, 0);
  b.item('bighealth', -20, 5.3, 0);
  b.item('health', -6, 0.3, 14);
  b.item('health', 6, 0.3, -14);
  b.item('health', -6, -2.7, -8);
  b.item('health', 6, -2.7, 8);
  b.item('ammo', 12, 0.3, 12, { weapon: W.rocket });
  b.item('ammo', -12, 0.3, -12, { weapon: W.rail });
  b.item('ammo', 12, 0.3, -12, { weapon: W.mg });
  b.item('ammo', -12, 0.3, 12, { weapon: W.scatter });

  for (const [x, z, yaw] of [
    [-14, 6, 49152], [19, 8, 16384], [-19, -8, 49152], [14, -6, 16384],
    [0, 15, 32768], [0, -15, 0], [-13, 0, 0], [13, 0, 32768],
  ]) b.spawn(x, 0.1, z, yaw);
  b.spawn(-20, 5.1, 12, 32768);
  b.spawn(20, 5.1, -12, 0);

  b.mark('high', 0, 5, 16, { weight: 1.4 });
  b.mark('pit', 0, -3, 0, { weight: 1.2 });
  return {
    void: -12,
    ambient: [0.062, 0.067, 0.084],
    sky: [0.06, 0.07, 0.09],
    sun: [0.20, 0.21, 0.24],
    fog: 0.011,
  };
}

// --- Cistern -----------------------------------------------------------------

function cistern(b) {
  const H = 17;
  b.room({ x: -15, z: -15, w: 30, d: 30, h: H, noFloor: true, wall: MAT.rust, ceil: MAT.rust });

  // A ring of standing water with a walkway round it, then two more storeys
  // stacked over the top. You fight up and down this map, not across it.
  // The floor is a ring: the middle ten metres of it are two metres lower and
  // hold the water. You get out of it at the corners, which is four places a
  // fight in the pool can be finished from above.
  b.box(-15.6, -2.4, -15.6, -10, 0, 15.6, MAT.concrete, { skip: 'down' });
  b.box(10, -2.4, -15.6, 15.6, 0, 15.6, MAT.concrete, { skip: 'down' });
  b.box(-10, -2.4, 10, 10, 0, 15.6, MAT.concrete, { skip: 'down' });
  b.box(-10, -2.4, -15.6, 10, 0, -10, MAT.concrete, { skip: 'down' });
  b.box(-10, -2.6, -10, 10, -2.2, 10, MAT.rust, { skip: 'down' });
  // The waterline. Nothing solid - it is drawn, it is lit, and you walk under it.
  b.box(-10, -1.65, -10, 10, -1.6, 10, MAT.trim, { nonsolid: true, glow: 0.25, detail: 3 });

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.ramp(sx > 0 ? 7 : -10, -2.2, sz > 0 ? 7 : -10, sx > 0 ? 10 : -7, 0,
        sz > 0 ? 10 : -7, 'x', sx, MAT.concrete);
    }
  }

  // Second storey: ledges on all four walls, joined at the corners, with two
  // gaps in it you have to go round or jump.
  const ledge = (x0, z0, x1, z1) => b.box(x0, 5.2, z0, x1, 5.5, z1, MAT.panel);
  ledge(-15, -15, -11, 15);
  ledge(11, -15, 15, 15);
  ledge(-11, 11, 4, 15);
  ledge(-4, -15, 11, -11);
  b.box(-11.2, 5.5, -15, -11, 5.72, 15, MAT.trim, { detail: 2 });
  b.box(11, 5.5, -15, 11.2, 5.72, 15, MAT.trim, { detail: 2 });

  b.stairs(-11, -15, 7, 4, 0, 5.2, 11, 'x', -1, MAT.concrete);
  b.stairs(4, 11, 7, 4, 0, 5.2, 11, 'x', 1, MAT.concrete);

  // The top: an island, and the only way onto it is a pad you can be shot off.
  b.box(-4.5, 10.4, -4.5, 4.5, 10.8, 4.5, MAT.panel);
  b.box(-4.7, 10.8, -4.7, 4.7, 11.3, -4.5, MAT.trim, { detail: 2 });
  b.box(-4.7, 10.8, 4.5, 4.7, 11.3, 4.7, MAT.trim, { detail: 2 });
  b.pad(-14.5, -1.5, 3, 3, 5.5, 17.2, { px: 10 });
  b.pad(11.5, -1.5, 3, 3, 5.5, 17.2, { px: -10 });
  b.pad(-2, -2, 4, 4, -2.2, 13.6);

  for (const [x, z] of [[-11, -11], [11, -11], [-11, 11], [11, 11]]) {
    b.pillar(x, z, 0.6, 0, 5.2, MAT.concrete);
  }

  b.light(0, 15.6, 0, { radius: 30, power: 1.6, r: 0.95, g: 0.97, b: 1, size: 1.1 });
  b.light(-13, 9, 0, { radius: 16, power: 1.0, r: 1, g: 0.86, b: 0.6 });
  b.light(13, 9, 0, { radius: 16, power: 1.0, r: 1, g: 0.86, b: 0.6 });
  b.light(0, 9, -13, { radius: 16, power: 1.0, r: 1, g: 0.86, b: 0.6 });
  b.light(0, 9, 13, { radius: 16, power: 1.0, r: 1, g: 0.86, b: 0.6 });
  b.light(0, -0.4, 0, { radius: 12, power: 0.9, r: 0.25, g: 0.75, b: 0.85, lamp: false });

  b.item('weapon', 0, 11.1, 0, { weapon: W.rail });
  b.item('weapon', -13, 5.8, 0, { weapon: W.rocket });
  b.item('weapon', 13, 5.8, 0, { weapon: W.scatter });
  b.item('armour', 0, -1.9, 0);
  b.item('bighealth', 0, 5.8, 13);
  b.item('health', -13, 0.3, -3);
  b.item('health', 13, 0.3, 3);
  b.item('ammo', 0, 0.3, 13, { weapon: W.rail });
  b.item('ammo', 0, 0.3, -13, { weapon: W.rocket });
  b.item('ammo', -13, 5.8, 9, { weapon: W.mg });
  b.item('ammo', 13, 5.8, -9, { weapon: W.scatter });

  for (const [x, z, yaw] of [
    [-12, -3, 0], [12, 3, 32768], [-3, 12, 49152], [3, -12, 16384],
    [-12.5, 12.5, 40960], [12.5, -12.5, 8192],
  ]) b.spawn(x, 0.1, z, yaw);
  b.spawn(-13, 5.6, 6, 32768);
  b.spawn(13, 5.6, -6, 0);

  b.mark('high', 0, 10.8, 0, { weight: 1.6 });
  return {
    void: -14,
    ambient: [0.058, 0.066, 0.08],
    sky: [0.05, 0.06, 0.08],
    sun: [0.18, 0.2, 0.24],
    fog: 0.014,
  };
}

// --- Overlook ----------------------------------------------------------------

function overlook(b) {
  // Outdoors, which here means the ceiling is missing and the light comes down
  // from a sky rather than out of lamps. The walls are rock and they are high
  // enough that the map is still a room.
  b.room({
    x: -26, z: -20, w: 52, d: 40, h: 20, noCeil: true, t: 1.2,
    wall: MAT.rock, floor: MAT.rock,
  });

  // The mesa in the middle, in three steps, with a ramp up the long way and a
  // pad up the short one. The rifle is on top and it can see the whole map,
  // which is the point and also the problem with standing there.
  b.box(-11, 0, -9, 11, 2.2, 9, MAT.rock);
  b.box(-8, 2.2, -6.5, 8, 4.2, 6.5, MAT.rock);
  b.box(-5, 4.2, -4, 5, 5.6, 4, MAT.concrete);
  b.box(-5.2, 5.6, -4.2, 5.2, 6.5, -4, MAT.trim, { detail: 2 });
  // With a gap in it where the steps arrive. A parapet across the top of a
  // staircase is the third time this map has been built that way.
  b.box(-5.2, 5.6, 4, -2.2, 6.5, 4.2, MAT.trim, { detail: 2 });
  b.box(2.2, 5.6, 4, 5.2, 6.5, 4.2, MAT.trim, { detail: 2 });
  // Up in three stages, and each stage starts on the one below it. The first
  // pair of ramps come off the ground; the second pair are cut into the first
  // terrace; the steps to the top start on the second terrace.
  b.ramp(11, 0, -3, 17, 2.2, 3, 'x', -1, MAT.rock);
  b.ramp(-17, 0, -3, -11, 2.2, 3, 'x', 1, MAT.rock);
  b.ramp(-3, 2.2, 6.5, 3, 4.2, 9, 'z', -1, MAT.rock);
  b.ramp(-3, 2.2, -9, 3, 4.2, -6.5, 'z', 1, MAT.rock);
  b.stairs(-2, 4, 4, 2.4, 4.2, 5.6, 4, 'z', -1, MAT.concrete);
  b.pad(6, 10, 3, 3, 0, 15.5, { pz: -6 });
  b.pad(-9, -13, 3, 3, 0, 15.5, { pz: 6 });

  // Two shelves against the long walls, and stairs at the ends of them: cover
  // from the mesa, and a way to get above somebody who is on it.
  for (const side of [-1, 1]) {
    b.box(side * 20, 0, -20, side * 26, 4.4, -8, MAT.rock);
    b.box(side * 20, 0, 8, side * 26, 4.4, 20, MAT.rock);
    b.box(side * 24, 4.4, -20, side * 26, 5.4, 20, MAT.rock);
    b.stairs(side > 0 ? 20 : -24, -8, 4, 5, 0, 4.4, 9, 'z', -1, MAT.rock);
    b.stairs(side > 0 ? 20 : -24, 3, 4, 5, 0, 4.4, 9, 'z', 1, MAT.rock);
    // Crates. Everything in this game is a box, and these are the boxes that
    // admit it.
    b.box(side * 15, 0, 12, side * 17.4, 2.4, 14.4, MAT.rust);
    b.box(side * 15, 0, -14.4, side * 17.4, 2.4, -12, MAT.rust);
    b.box(side * 17.4, 0, 12, side * 19, 1.3, 13.6, MAT.rust);
    b.box(side * 17.4, 0, -13.6, side * 19, 1.3, -12, MAT.rust);
  }

  b.light(0, 17, 0, { radius: 60, power: 1.15, r: 1, g: 0.96, b: 0.88, lamp: false, size: 1.4 });
  b.light(-20, 8, 14, { radius: 20, power: 0.8, r: 1, g: 0.8, b: 0.55 });
  b.light(20, 8, -14, { radius: 20, power: 0.8, r: 1, g: 0.8, b: 0.55 });
  b.light(0, 7.4, 12, { radius: 18, power: 0.7, r: 0.75, g: 0.85, b: 1 });
  b.light(0, 7.4, -12, { radius: 18, power: 0.7, r: 0.75, g: 0.85, b: 1 });

  b.item('weapon', 0, 6.0, 0, { weapon: W.rail });
  b.item('weapon', -22, 0.3, 0, { weapon: W.rocket });
  b.item('weapon', 22, 0.3, 0, { weapon: W.scatter });
  b.item('armour', -6.5, 4.5, 0);
  b.item('bighealth', 6.5, 4.5, 0);
  b.item('health', -23, 4.7, 14);
  b.item('health', 23, 4.7, -14);
  b.item('health', -16, 2.7, 13);
  b.item('health', 16, 2.7, -13);
  b.item('ammo', -23, 4.7, -14, { weapon: W.rail });
  b.item('ammo', 23, 4.7, 14, { weapon: W.rocket });
  b.item('ammo', 0, 0.3, 17, { weapon: W.mg });
  b.item('ammo', 0, 0.3, -17, { weapon: W.scatter });

  for (const [x, z, yaw] of [
    [0, 17, 32768], [0, -17, 0], [-23, 0, 0], [23, 0, 32768],
  ]) b.spawn(x, 0.2, z, yaw);
  for (const [x, z, yaw] of [
    [-22, 16, 45056], [22, -16, 12288], [-22, -16, 20480], [22, 16, 53248],
  ]) b.spawn(x, 4.6, z, yaw);

  b.mark('high', 0, 5.6, 0, { weight: 1.5 });
  return {
    void: -20,
    ambient: [0.085, 0.09, 0.115],
    sky: [0.30, 0.42, 0.62],
    sun: [0.55, 0.50, 0.42],
    fog: 0.006,
    outdoor: true,
  };
}

// --- Bastion (flags) ---------------------------------------------------------

function bastion(b) {
  // Mid is built once, because it belongs to nobody: a hall with a chasm across
  // it, one narrow bridge over the top, and the rocket launcher at the bottom.
  // The short way between the bases is the bridge, and the bridge is two metres
  // wide with nothing either side of it.
  b.room({
    x: -18, z: -13, w: 36, d: 26, h: 12, t: 0.8, noFloor: true, wall: MAT.concrete,
    doors: [
      { side: 'n', a: 3, b: 9, y1: 4.2 }, { side: 'n', a: 15, b: 21, y1: 4.4 },
      { side: 'n', a: 27, b: 33, y1: 4.2 },
      { side: 's', a: 3, b: 9, y1: 4.2 }, { side: 's', a: 15, b: 21, y1: 4.4 },
      { side: 's', a: 27, b: 33, y1: 4.2 },
    ],
  });
  b.box(-18.8, -6.4, -13.8, -9, 0, 13.8, MAT.floor, { skip: 'down' });
  b.box(9, -6.4, -13.8, 18.8, 0, 13.8, MAT.floor, { skip: 'down' });
  b.box(-9, -6.6, -13.8, 9, -6, 13.8, MAT.rust, { skip: 'down' });
  // The ends of the chasm. The room's own walls start at floor level, so
  // without these the bottom of the chasm runs straight out under the courtyard
  // and off the edge of the world - which is where a third of everybody who
  // went down there ended up.
  b.box(-9, -6.6, 13, 9, 0, 13.8, MAT.concrete);
  b.box(-9, -6.6, -13.8, 9, 0, -13, MAT.concrete);
  b.box(-2.2, -0.5, -13.8, 2.2, 0, 13.8, MAT.panel);
  b.box(-2.4, 0, -13.8, -2.2, 0.9, 13.8, MAT.trim, { detail: 2 });
  b.box(2.2, 0, -13.8, 2.4, 0.9, 13.8, MAT.trim, { detail: 2 });
  // Out of the chasm on foot, at one corner each end - so the two ways up are
  // diagonally opposite and neither team owns both.
  b.ramp(-9, -6, 7.5, -2.4, 0, 13.5, 'x', -1, MAT.rust);
  b.ramp(2.4, -6, -13.5, 9, 0, -7.5, 'x', 1, MAT.rust);
  b.pad(-1.5, -1.5, 3, 3, -6, 17.8);
  b.pillar(-13, 8, 0.5, 0, 11.2, MAT.panel);
  b.pillar(13, -8, 0.5, 0, 11.2, MAT.panel);

  b.light(0, 11, 0, { radius: 30, power: 1.4, size: 0.9 });
  b.light(-13, 8.5, 8, { radius: 18, power: 0.9 });
  b.light(13, 8.5, -8, { radius: 18, power: 0.9 });
  b.light(0, -3.6, 0, { radius: 15, power: 1.1, r: 1, g: 0.5, b: 0.2, lamp: false });

  b.item('weapon', 0, -5.7, 0, { weapon: W.rocket });
  b.item('armour', 0, 0.3, 0);
  b.item('health', -6, -5.7, -9);
  b.item('health', 6, -5.7, 9);
  b.item('ammo', -13, 0.3, 0, { weapon: W.rail });
  b.item('ammo', 13, 0.3, 0, { weapon: W.scatter });
  b.mark('mid', 0, 0, 0, { weight: 1.3 });

  // Everything from here is the red half. endMirror() reflects it through z = 0
  // and hands the copy to blue, so the two ends of the map are identical by
  // construction rather than by anybody measuring them.
  b.beginMirror();
  b.box(-18.8, -0.8, 13.8, 18.8, 0, 46.4, MAT.floor, { skip: 'down' });

  // The courtyard: three ways in from mid, two ways on into the base, and a
  // couple of blocks to break the sightline down the middle.
  b.room({
    x: -18, z: 13.8, w: 36, d: 13, h: 8, t: 0.8, noFloor: true, omit: ['s'],
    wall: MAT.red, ceil: MAT.panel,
    doors: [{ side: 'n', a: 5, b: 11, y1: 4.2 }, { side: 'n', a: 25, b: 31, y1: 4.2 }],
  });
  b.box(-8, 0, 17, -5, 2.6, 23, MAT.concrete);
  b.box(5, 0, 17, 8, 2.6, 23, MAT.concrete);
  b.light(0, 7.2, 20, { radius: 20, power: 1.0, r: 1, g: 0.78, b: 0.74 });
  b.light(-14, 7.2, 20, { radius: 14, power: 0.8 });
  b.light(14, 7.2, 20, { radius: 14, power: 0.8 });
  b.item('armour', 0, 0.3, 20);
  b.item('weapon', -15, 0.3, 16, { weapon: W.scatter });
  b.item('ammo', 15, 0.3, 16, { weapon: W.mg });

  // The base. The flag is up two steps at the back of it, and there is a
  // balcony down each side looking at the flag from above - which is where the
  // rifle is, and where you have to be got out of.
  b.room({
    x: -16, z: 27.6, w: 32, d: 18, h: 10, t: 0.8, noFloor: true, omit: ['s'],
    wall: MAT.red, ceil: MAT.panel,
  });
  b.box(-6, 0, 38, 6, 1.2, 45.6, MAT.concrete);
  b.stairs(-6, 35, 12, 3, 0, 1.2, 4, 'z', 1, MAT.concrete);
  b.box(-1.2, 1.2, 40.4, 1.2, 1.5, 42.8, MAT.trim, { detail: 3, glow: 0.3 });
  b.flag(0, 0, 1.5, 41.6);
  b.mark('base', 0, 1.5, 41.6, { team: 0, weight: 2 });

  for (const side of [-1, 1]) {
    const x0 = side > 0 ? 11 : -16;
    b.stairs(x0, 27.6, 5, 5, 0, 4.4, 9, 'z', 1, MAT.panel);
    b.box(x0, 4.4, 32.6, x0 + 5, 4.8, 45.6, MAT.panel);
    b.box(side > 0 ? 10.8 : -11.2, 4.8, 32.6, side > 0 ? 11 : -11, 5.8, 45.6, MAT.trim, { detail: 2 });
    b.light(side * 13.5, 9.2, 38, { radius: 16, power: 0.9, r: 1, g: 0.8, b: 0.75 });
  }
  b.light(0, 9.2, 41, { radius: 22, power: 1.3, r: 1, g: 0.72, b: 0.68 });

  b.item('weapon', 13.5, 5.1, 40, { weapon: W.rail });
  b.item('bighealth', -13.5, 5.1, 40);
  b.item('health', -9, 0.3, 30);
  b.item('health', 9, 0.3, 30);
  b.item('ammo', 0, 0.3, 31, { weapon: W.rocket });

  for (const [x, z, yaw] of [[-10, 42, 32768], [10, 42, 32768], [-13, 34, 32768], [13, 34, 32768]]) {
    b.spawn(x, 0.1, z, yaw, 0);
  }
  b.endMirror();

  return {
    void: -16,
    ambient: [0.065, 0.07, 0.088],
    sky: [0.05, 0.06, 0.08],
    sun: [0.2, 0.21, 0.25],
    fog: 0.010,
    flagMap: true,
  };
}

// --- Sluice (flags) ----------------------------------------------------------

function sluice(b) {
  // Mid: one room, six ways in, and a raised island in the middle of it with the
  // armour on top. Whoever holds the island holds the flag run.
  b.room({
    x: -18, z: -12, w: 36, d: 24, h: 10, t: 0.8, noFloor: true, wall: MAT.rust,
    doors: [
      { side: 'n', a: 4.5, b: 11.5, y1: 4.2 }, { side: 'n', a: 24.5, b: 31.5, y1: 4.2 },
      { side: 's', a: 4.5, b: 11.5, y1: 4.2 }, { side: 's', a: 24.5, b: 31.5, y1: 4.2 },
    ],
  });
  b.box(-18.8, -0.8, -12.8, 18.8, 0, 12.8, MAT.floor, { skip: 'down' });
  b.box(-5, 0, -3.5, 5, 2.4, 3.5, MAT.concrete);
  b.ramp(-9, 0, -2, -5, 2.4, 2, 'x', 1, MAT.concrete);
  b.ramp(5, 0, -2, 9, 2.4, 2, 'x', -1, MAT.concrete);
  b.box(-16, 0, -10, -12, 3.2, -6, MAT.rust);
  b.box(12, 0, 6, 16, 3.2, 10, MAT.rust);
  b.light(0, 9.2, 0, { radius: 26, power: 1.35, size: 0.8 });
  b.light(-14, 7, 6, { radius: 15, power: 0.8, r: 1, g: 0.6, b: 0.4 });
  b.light(14, 7, -6, { radius: 15, power: 0.8, r: 1, g: 0.6, b: 0.4 });
  b.item('armour', 0, 2.7, 0);
  b.item('ammo', -14, 0.3, 0, { weapon: W.mg });
  b.item('ammo', 14, 0.3, 0, { weapon: W.mg });
  b.item('weapon', 0, 0.3, -10, { weapon: W.rocket });
  b.item('weapon', 0, 0.3, 10, { weapon: W.rocket });
  b.mark('mid', 0, 2.4, 0, { weight: 1.4 });

  // The blue half, reflected for red below.
  b.beginMirror();
  b.box(-18.8, -0.8, 12.8, 18.8, 0, 42.4, MAT.floor, { skip: 'down' });

  // Two runs out of the base, one either side, and nothing at all up the
  // middle: to get at the flag you have to commit to a side.
  for (const side of [-1, 1]) {
    b.room({
      x: side > 0 ? 6 : -14, z: 12.8, w: 8, d: 11.8, h: 5, t: 0.8, noFloor: true,
      omit: ['s', 'n'], wall: MAT.concrete,
    });
    b.light(side * 10, 4.4, 18, { radius: 13, power: 0.85, r: 1, g: 0.85, b: 0.6 });
    b.item('health', side * 10, 0.3, 20);
  }
  b.box(-6, 0, 12.8, 6, 5.6, 24.6, MAT.rust); // the block the two runs go round

  b.room({
    x: -16, z: 24.6, w: 32, d: 17, h: 9, t: 0.8, noFloor: true, wall: MAT.blue,
    doors: [
      { side: 's', a: 2.5, b: 9.5, y1: 4.2 }, { side: 's', a: 22.5, b: 29.5, y1: 4.2 },
    ],
  });
  b.box(-5, 0, 33, 5, 1.6, 41.6, MAT.concrete);
  b.ramp(-5, 0, 29, 5, 1.6, 33, 'z', 1, MAT.concrete);
  b.box(-1, 1.6, 35, 1, 1.9, 37, MAT.trim, { detail: 3, glow: 0.3 });
  b.flag(1, 0, 1.9, 36);
  b.mark('base', 0, 1.9, 36, { team: 1, weight: 2 });

  // A walkway down each side of the base, up off a pad. It gets you over the
  // head of whoever is guarding the floor, and there is no railing on it.
  for (const side of [-1, 1]) {
    const x0 = side > 0 ? 11 : -16;
    b.box(x0, 4.2, 26, x0 + 5, 4.6, 41.6, MAT.panel);
    b.pad(side > 0 ? 12 : -15, 27, 3, 3, 0, 15.4);
    b.light(side * 13, 8.2, 34, { radius: 15, power: 0.9, r: 0.7, g: 0.78, b: 1 });
  }
  b.light(0, 8.2, 36, { radius: 20, power: 1.15, r: 0.7, g: 0.78, b: 1 });
  b.item('weapon', 13.5, 4.9, 38, { weapon: W.rail });
  b.item('bighealth', -13.5, 4.9, 38);
  b.item('health', 0, 0.3, 27);
  b.item('ammo', -8, 0.3, 31, { weapon: W.rail });
  b.item('ammo', 8, 0.3, 31, { weapon: W.rocket });
  b.item('weapon', -13, 0.3, 21, { weapon: W.scatter });

  for (const [x, z, yaw] of [[-9, 37, 32768], [9, 37, 32768], [-12, 29, 32768], [12, 29, 32768]]) {
    b.spawn(x, 0.1, z, yaw, 1);
  }
  b.endMirror();

  return {
    void: -12,
    ambient: [0.065, 0.07, 0.09],
    sky: [0.05, 0.06, 0.08],
    sun: [0.22, 0.22, 0.26],
    fog: 0.011,
    flagMap: true,
  };
}

// --- The list ----------------------------------------------------------------

export const MAPS = [
  {
    key: 'foundry',
    name: 'Foundry',
    blurb: 'A hall with a hole in the middle of it. The rocket is at the bottom of the hole and everything else is on the gantry over your head.',
    modes: ['dm', 'tdm'],
    build: foundry,
  },
  {
    key: 'cistern',
    name: 'Cistern',
    blurb: 'Three storeys and thirty metres across. Nobody is ever far away and half of them are above you.',
    modes: ['dm', 'tdm'],
    build: cistern,
  },
  {
    key: 'overlook',
    name: 'Overlook',
    blurb: 'Open ground under a sky, and a mesa in the middle with the rifle on top of it. Standing there is the plan and the mistake.',
    modes: ['dm', 'tdm'],
    build: overlook,
  },
  {
    key: 'bastion',
    name: 'Bastion',
    blurb: 'Two bases, one bridge, and a chasm under it with the rocket at the bottom. The short way across is the narrow one.',
    modes: ['ctf', 'tdm'],
    build: bastion,
  },
  {
    key: 'sluice',
    name: 'Sluice',
    blurb: 'A quick flag map. Two runs out of every base and a walkway that puts you over the head of whoever is guarding the floor.',
    modes: ['ctf', 'tdm'],
    build: sluice,
  },
];

export const MAP_KEYS = MAPS.map((m) => m.key);

const cache = new Map();

/**
 * Build a map, or hand back the one already built.
 *
 * Cached because it is pure: the same key gives the same arena down to the last
 * box, which is what lets the netcode send a map by name and lets a test build
 * one without a browser anywhere in sight.
 */
export function loadMap(key) {
  if (cache.has(key)) return cache.get(key);
  const def = MAPS.find((m) => m.key === key) || MAPS[0];
  const b = new Builder();
  const meta = def.build(b) || {};
  const map = compile(def, b, meta);
  cache.set(def.key, map);
  return map;
}

function compile(def, b, meta) {
  const solids = b.solids.filter((s) => !s.nonsolid);
  const bounds = {
    x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity,
  };
  for (const s of b.solids) {
    bounds.x0 = Math.min(bounds.x0, s.x0); bounds.x1 = Math.max(bounds.x1, s.x1);
    bounds.y0 = Math.min(bounds.y0, s.y0); bounds.y1 = Math.max(bounds.y1, s.y1);
    bounds.z0 = Math.min(bounds.z0, s.z0); bounds.z1 = Math.max(bounds.z1, s.z1);
  }

  return {
    key: def.key,
    name: def.name,
    blurb: def.blurb,
    modes: def.modes,
    faces: b.solids, // everything, including the parts you cannot walk into
    solids, // only what stops a body
    lights: b.lights,
    spawns: b.spawns,
    items: b.items.map((it, i) => ({ ...it, index: i })),
    flags: b.flags,
    pads: b.pads,
    marks: b.marks,
    bounds,
    void: meta.void ?? -30,
    ambient: meta.ambient ?? [0.14, 0.15, 0.18],
    sky: meta.sky ?? [0.05, 0.06, 0.08],
    sun: meta.sun ?? [0.2, 0.21, 0.25],
    fog: meta.fog ?? 0.01,
    outdoor: !!meta.outdoor,
    flagMap: !!meta.flagMap,
  };
}
