import { createMatch } from '../game/state.js';
import { step } from '../game/sim.js';
import { nearestNode, findPath } from '../game/nav.js';
import { visible } from '../game/world.js';
import { BTN, YAW_UNITS, P_EYE } from '../constants.js';
import { createGameConfig } from './config.js';
import { cargoMap } from './cargo-map.js';

export function createPractice(fixture = 'fixed-targets', seed = 20261001) {
  const config = createGameConfig({ fixture, teamSize: fixture === 'load-12' ? 6 : 4, seed }, { development: true });
  if (fixture === 'match') throw new Error('正式对局尚未开放');
  const map = cargoMap(), n = config.teamSize * 2;
  const state = createMatch({ productConfig: config, development: true, map: map.key, mapData: map,
    mode: 'tdm', humans: Array(n).fill(true), bots: 0, seed,
    names: Array.from({ length: n }, (_, i) => i === 0 ? '玩家' : (i % 2 ? '敌方靶 ' : '友方靶 ') + i) });
  state.phase = 'live'; state.phaseTimer = 0;
  state.fixture = fixture;
  state.workload = { navigationQueries: 0, shots: 0, movedMetres: 0 };
  state.routes = state.bodies.map((b, i) => ({ path: [], at: 0, goal: i % 2, nextQuery: 0 }));
  const placements = [[-15, 0], [-5, 0], [-10, 2], [5, 0], [-14, -9], [8, 9], [-14, 9], [10, -9]];
  for (let i = 0; i < placements.length; i++) {
    const b = state.bodies[i]; b.x = placements[i][0]; b.z = placements[i][1]; b.y = 0;
    b.yaw = i % 2 ? 32768 : 0;
  }
  return state;
}

function fixtureCommand(state, body) {
  if (state.fixture === 'fixed-targets') return { b: 0 };
  const route = state.routes[body.index];
  if (state.tick >= route.nextQuery || !route.path.length) {
    const lane = [-9, 0, 9][(body.index + (state.seed >>> 0)) % 3];
    const from = nearestNode(state.nav, body.x, body.y, body.z);
    const to = nearestNode(state.nav, route.goal ? 15 : -15, 0, lane);
    findPath(state.nav, from, to, route.path); route.at = 0;
    route.nextQuery = state.tick + 120; state.workload.navigationQueries++;
  }
  let node = state.nav.nodes[route.path[route.at]];
  if (node && Math.hypot(body.x - node.x, body.z - node.z) < 0.65) node = state.nav.nodes[route.path[++route.at]];
  if (!node) { route.goal = 1 - route.goal; route.nextQuery = 0; }
  const yaw = node ? Math.round(Math.atan2(node.z - body.z, node.x - body.x) * YAW_UNITS / (Math.PI * 2)) : body.yaw;
  const fire = (state.tick + body.index * 11) % 30 === 0;
  return { b: (node ? BTN.FWD : 0) | (body.ammo[0] ? (fire ? BTN.FIRE : 0) : BTN.RELOAD), yaw, pitch: 0 };
}

export function stepPractice(state, playerInput) {
  const inputs = state.bodies.map((body, i) => i === 0 ? playerInput : fixtureCommand(state, body));
  for (const b of state.bodies) { b.px = b.x; b.py = b.y; b.pz = b.z; b.pyaw = b.yaw; }
  step(state, inputs);
  for (const b of state.bodies) {
    // Respawn jumps are not counted as movement workload.
    if (!state.events.some(e => e.type === 'spawn' && e.body === b.index)) state.workload.movedMetres += Math.hypot(b.x - b.px, b.z - b.pz);
  }
  state.workload.shots += state.events.filter(e => e.type === 'fire').length;
}

export function aimSlowdown(state, yaw, pitch, enabled) {
  const me = state.bodies[0];
  if (!enabled || !me.alive) return 1;
  const radians = Math.PI * 2 / YAW_UNITS;
  for (const other of state.bodies) {
    if (!other.alive || other.team === me.team) continue;
    const dx = other.x - me.x, dz = other.z - me.z, dy = other.y - me.y;
    const flat = Math.hypot(dx, dz);
    if (flat > state.product.range) continue;
    const deltaYaw = Math.atan2(Math.sin(Math.atan2(dz, dx) - yaw * radians), Math.cos(Math.atan2(dz, dx) - yaw * radians));
    const deltaPitch = Math.atan2(dy, flat) - pitch * radians;
    if (Math.hypot(deltaYaw, deltaPitch) <= state.product.assistAngleDeg * Math.PI / 180 &&
      visible(state.world, me.x, me.y + P_EYE, me.z, other.x, other.y + P_EYE, other.z)) return state.product.assistSensitivityScale;
  }
  return 1;
}
