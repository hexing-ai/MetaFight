import { Builder, MAT } from '../game/build.js';

// Original 48m x 24m deck: three lanes, crossed by two clear transverse aisles.
// No geometry/textures copied from the reference game.
export function cargoMap() {
  const b = new Builder();
  b.box(-24, -1, -12, 24, 0, 12, MAT.floor);
  b.box(-24, 0, -12, 24, 1.3, -11.6, MAT.panel);
  b.box(-24, 0, 11.6, 24, 1.3, 12, MAT.panel);
  b.box(-24, 0, -12, -23.6, 3, 12, MAT.red);
  b.box(23.6, 0, -12, 24, 3, 12, MAT.blue);
  // Spawn screens prevent a straight spawn-to-spawn firing line.
  b.box(-18, 0, -9.3, -17, 2.6, 9.3, MAT.red);
  b.box(17, 0, -9.3, 18, 2.6, 9.3, MAT.blue);
  for (const x of [-12, 4]) for (const z of [-7, 3]) {
    b.box(x, 0, z, x + 8, 2.6, z + 4, x < 0 ? MAT.rust : MAT.panel);
    // One low, non-colliding stripe per container keeps the graybox readable.
    b.box(x, 2.6, z, x + 8, 2.68, z + 4, MAT.trim, { nonsolid: true });
  }
  b.box(-2, 0, 5, 0, 0.9, 7, MAT.rust);
  b.box(0, 0, -7, 2, 0.9, -5, MAT.rust);
  for (const team of [0, 1]) for (const x of [20, 22]) for (const z of [-8, -4, 0, 4, 8]) {
    b.spawn(team ? x : -x, 0.02, z, team ? 32768 : 0, team);
  }
  b.light(-14, 6, 0, { radius: 32, power: 1.1, lamp: false });
  b.light(14, 6, 0, { radius: 32, power: 1.1, lamp: false });
  return { key: 'cargo-greybox-v2', name: '货轮甲板', modes: ['tdm'],
    faces: b.solids, solids: b.solids.filter(s => !s.nonsolid), lights: b.lights,
    spawns: b.spawns, items: [], flags: [], pads: [], marks: [],
    bounds: { x0: -24, x1: 24, y0: -1, y1: 6, z0: -12, z1: 12 },
    void: -12, ambient: [0.42, 0.47, 0.51], sky: [0.36, 0.53, 0.63],
    sun: [0.4, 0.41, 0.4], fog: 0.007, outdoor: true, flagMap: false };
}
