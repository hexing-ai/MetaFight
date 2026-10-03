import { Builder, MAT } from '../game/build.js';
import { createMatch } from '../game/state.js';

// Capability fixture, not the future cargo map or product combat rules.
export function probeMap() {
  const b = new Builder();
  b.room({ x: -9, z: -7, w: 18, d: 14, h: 4, noCeil: true, wall: MAT.panel, floor: MAT.floor });
  b.box(-1, 0, 1, 1, 1.2, 3, MAT.rust);
  b.box(4, 0, 2, 6, 2, 4, MAT.blue);
  b.light(0, 3.8, -2, { radius: 24, power: 1.5, lamp: false });
  b.spawn(-6, 0.05, -3, 0, 0);
  b.spawn(5, 0.05, -3, 32768, 1);
  return {
    key: 'platform-probe-v1', name: '平台测试场', modes: ['tdm'],
    faces: b.solids, solids: b.solids.filter(s => !s.nonsolid), lights: b.lights,
    spawns: b.spawns, items: [], flags: [], pads: [], marks: [],
    bounds: { x0: -10, x1: 10, y0: -1, y1: 5, z0: -8, z1: 8 },
    void: -20, ambient: [0.38, 0.43, 0.48], sky: [0.25, 0.39, 0.48],
    sun: [0.35, 0.37, 0.4], fog: 0.012, outdoor: true, flagMap: false,
  };
}

export function createProbe(seed = 20261001) {
  const map = probeMap();
  const state = createMatch({ map: map.key, mapData: map, mode: 'tdm', humans: [true, true], bots: 0,
    names: ['测试员', '固定靶'], seed, limit: 9999, timeLimit: 60 * 60 * 60 });
  state.phase = 'live'; state.phaseTimer = 0;
  return state;
}
