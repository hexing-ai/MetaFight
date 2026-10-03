import { createGameConfig } from './config.js';
import { cargoMap } from './cargo-map.js';
import { createMatch } from '../game/state.js';
import { step } from '../game/sim.js';

export function createCombatMatch({ candidate = false, seed = 20261001 } = {}) {
  const config = createGameConfig({ fixture: candidate ? 'match-12' : 'match', teamSize: candidate ? 6 : 4, seed }, { development: candidate });
  const map = cargoMap(), n = config.teamSize * 2;
  const state = createMatch({ productConfig: config, development: candidate, map: map.key, mapData: map,
    mode: 'tdm', humans: Array.from({ length: n }, (_, i) => i === 0), bots: 0, seed,
    names: Array.from({ length: n }, (_, i) => i === 0 ? '玩家' : (i % 2 ? '蓝队 ' : '红队 ') + (Math.floor(i / 2) + 1)) });
  state.phase = 'live'; state.phaseTimer = 0; state.fixture = config.fixture;
  state.heardShots = []; state.result = null;
  state.matchStats = { navigationQueries: 0, shots: 0, hits: 0, movedMetres: 0, repaths: 0, firstShotTick: null,
    bots: state.bodies.map(b => ({ id: b.id, movedMetres: 0, shots: 0, recoveries: 0, idleTicks: 0, maxIdleTicks: 0 })) };
  return state;
}
export function stepCombatMatch(state, playerInput = { b: 0 }) {
  if (state.phase === 'over') return state;
  for (const b of state.bodies) { b.px = b.x; b.py = b.y; b.pz = b.z; b.pyaw = b.yaw; }
  step(state, [playerInput]);
  const stats = state.matchStats;
  for (const b of state.bodies) {
    const actor = stats.bots[b.index];
    const spawned = state.events.some(e => e.type === 'spawn' && e.body === b.index);
    const distance = spawned ? 0 : Math.hypot(b.x - b.px, b.z - b.pz);
    actor.movedMetres += distance; stats.movedMetres += distance;
    const fire = state.events.filter(e => e.type === 'fire' && e.body === b.index).length;
    actor.shots += fire; stats.shots += fire;
    if (fire && stats.firstShotTick === null) stats.firstShotTick = state.tick;
    const recover = state.events.filter(e => e.type === 'bot-repath' && e.body === b.index).length;
    actor.recoveries += recover; stats.repaths += recover;
    actor.idleTicks = !b.alive || spawned || distance > 0.005 || fire || recover || b.reloadUntil ? 0 : actor.idleTicks + 1;
    actor.maxIdleTicks = Math.max(actor.maxIdleTicks, actor.idleTicks);
  }
  stats.hits += state.events.filter(e => e.type === 'hit').length;
  return state;
}
