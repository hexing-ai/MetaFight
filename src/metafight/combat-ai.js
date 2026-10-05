import { BTN, P_EYE, YAW_UNITS } from '../constants.js';
import { nextRandom, angleDelta, walkBasis } from '../util.js';
import { visible } from '../game/world.js';
import { nearestNode, findPath } from '../game/nav.js';

const TAU = Math.PI * 2, SIGHT = 50;
const angle = (z, x) => Math.round(Math.atan2(z, x) * YAW_UNITS / TAU);
const point = b => ({ x: b.x, y: b.y, z: b.z });
const delay = (state, min, max) => {
  const lo = Math.round(min * state.product.fixedHz), hi = Math.round(max * state.product.fixedHz);
  return lo + Math.floor(nextRandom(state) * (hi - lo + 1));
};
export function combatInput(state, body) {
  const out = { b: 0, yaw: body.yaw, pitch: body.pitch };
  if (!body.alive) return out;
  let ai = body.combat;
  if (!ai || ai.lifeId !== body.lifeId) ai = body.combat = {
    lifeId: body.lifeId, mode: 'patrol', target: -1, lastKnown: null, memoryUntil: 0,
    reactAt: 0, noticedAt: 0, path: [], at: 0, goal: null, repathAt: -999,
    errorAt: -1, errorYaw: 0, errorPitch: 0, side: body.index % 3 ? 1 : -1,
    lastFireAt: body.firedAt, burstShots: 0, nextBurstAt: 0,
    checkAt: state.tick, checkX: body.x, checkZ: body.z, recoverUntil: 0, patrol: body.index % 3,
  };
  const config = state.product;
  // Count real shots, not trigger requests blocked by cooldown/reload.
  // Keep the rest deadline across target switches so focus changes cannot bypass it.
  if (body.firedAt > ai.lastFireAt) {
    ai.lastFireAt = body.firedAt;
    if (++ai.burstShots >= config.botBurstShots) {
      ai.burstShots = 0;
      ai.nextBurstAt = body.firedAt + delay(state, config.botBurstPauseMinSec, config.botBurstPauseMaxSec);
    }
  }
  let target = null, best = Infinity;
  for (const other of state.bodies) {
    if (other.team === body.team || !other.alive || other.shield > 0) continue;
    const distance = Math.hypot(other.x - body.x, other.z - body.z);
    if (distance >= Math.min(best, SIGHT)) continue;
    if (!visible(state.world, body.x, body.y + P_EYE, body.z, other.x, other.y + 1.1, other.z)) continue;
    target = other; best = distance;
  }
  if (target) {
    if (ai.target !== target.index || ai.targetLife !== target.lifeId) {
      ai.noticedAt = state.tick;
      ai.reactAt = state.tick + delay(state, config.botReactionMinSec, config.botReactionMaxSec);
      // Give a target facing away time to react. Applies to both teams.
      const approach = angle(body.z - target.z, body.x - target.x);
      if (Math.abs(angleDelta(target.yaw, approach)) > YAW_UNITS * 70 / 360)
        ai.reactAt += Math.round(config.botFlankWarningSec * config.fixedHz);
      ai.targetLife = target.lifeId;
    }
    ai.target = target.index; ai.lastKnown = point(target); ai.memoryUntil = state.tick + 180;
    ai.mode = state.tick < ai.reactAt ? 'notice' : 'engage';
  } else {
    ai.target = -1;
    // Gunshot events contain the recorded source, never the hidden actor's current position.
    for (const sound of state.heardShots || []) {
      if (sound.team === body.team || Math.hypot(sound.x - body.x, sound.z - body.z) > 24) continue;
      ai.lastKnown = point(sound); ai.memoryUntil = state.tick + 180;
    }
    ai.mode = ai.lastKnown && state.tick < ai.memoryUntil ? 'search' : 'patrol';
  }
  const searching = ai.mode === 'search';
  let goal = target ? point(target) : searching ? ai.lastKnown : ai.goal;
  if (!goal || (!target && !searching && (Math.hypot(goal.x - body.x, goal.z - body.z) < 1.5 || state.tick - ai.repathAt > 240))) {
    ai.patrol = (ai.patrol + 1 + Math.floor(nextRandom(state) * 2)) % 6;
    goal = { x: ai.patrol < 3 ? -14 : 14, y: 0, z: [-9.8, 0, 9.8][ai.patrol % 3] };
  }
  if (searching && Math.hypot(goal.x - body.x, goal.z - body.z) < 1.2) { ai.memoryUntil = 0; ai.lastKnown = null; }
  if (state.tick - ai.checkAt >= 60) {
    if (Math.hypot(body.x - ai.checkX, body.z - ai.checkZ) < 0.45 && !target) {
      ai.recoverUntil = state.tick + 45; ai.side *= -1; ai.repathAt = -999;
      state.events.push({ type: 'bot-repath', body: body.index });
    }
    ai.checkAt = state.tick; ai.checkX = body.x; ai.checkZ = body.z;
  }
  if (!ai.goal || Math.hypot(goal.x - ai.goal.x, goal.z - ai.goal.z) > 2 || state.tick - ai.repathAt >= 60 || !ai.path.length) {
    ai.goal = { ...goal }; ai.repathAt = state.tick;
    findPath(state.nav, nearestNode(state.nav, body.x, body.y, body.z), nearestNode(state.nav, goal.x, goal.y, goal.z), ai.path);
    ai.at = 0; state.matchStats.navigationQueries++;
  }
  let node;
  while (ai.at < ai.path.length) {
    node = state.nav.nodes[ai.path[ai.at]];
    if (Math.hypot(node.x - body.x, node.z - body.z) < 0.75 && Math.abs(node.y - body.y) < 0.6) ai.at++;
    else break;
  }
  node = state.nav.nodes[ai.path[ai.at]];
  let dx = node ? node.x - body.x : goal.x - body.x;
  let dz = node ? node.z - body.z : goal.z - body.z;
  if (target && best < 12) {
    const tx = target.x - body.x, tz = target.z - body.z;
    dx = -tz * ai.side + (best < 5 ? -tx : 0); dz = tx * ai.side + (best < 5 ? -tz : 0);
    if (state.tick % 90 === body.index) ai.side *= -1;
  }
  if (state.tick < ai.recoverUntil) { const save = dx; dx = -dz * ai.side; dz = save * ai.side; }
  const look = target || (searching ? ai.lastKnown : node || goal);
  let wantYaw = look ? angle(look.z - body.z, look.x - body.x) : body.yaw;
  let wantPitch = 0;
  if (target) {
    if (state.tick >= ai.errorAt) {
      ai.errorAt = state.tick + 18;
      ai.errorYaw = Math.round((nextRandom(state) * 2 - 1) * config.botAimYawErrorDeg * YAW_UNITS / 360);
      ai.errorPitch = Math.round((nextRandom(state) * 2 - 1) * config.botAimPitchErrorDeg * YAW_UNITS / 360);
    }
    wantYaw += ai.errorYaw;
    wantPitch = angle(target.y + 1.1 - body.y - P_EYE, Math.max(0.1, best)) + ai.errorPitch;
  }
  out.yaw = (body.yaw + Math.max(-900, Math.min(900, angleDelta(body.yaw, wantYaw)))) & 65535;
  out.pitch = Math.max(-15000, Math.min(15000, wantPitch));
  const len = Math.hypot(dx, dz), basis = walkBasis(out.yaw, {});
  if (len > 0.25) {
    const forward = (dx * basis.fx + dz * basis.fz) / len, side = (dx * basis.rx + dz * basis.rz) / len;
    if (forward > 0.35) out.b |= BTN.FWD; else if (forward < -0.35) out.b |= BTN.BACK;
    if (side > 0.35) out.b |= BTN.RIGHT; else if (side < -0.35) out.b |= BTN.LEFT;
  }
  if (node && node.y > body.y + 0.3 && body.onGround) out.b |= BTN.JUMP;
  if (!body.ammo[0]) out.b |= BTN.RELOAD;
  else if (target && canBotShoot(state, body, target) && state.tick >= Math.max(ai.reactAt, ai.nextBurstAt) && Math.abs(angleDelta(wantYaw, out.yaw)) < 1100) out.b |= BTN.FIRE;
  return out;
}

export function canBotShoot(state, body, target) {
  return target.lastBotShooter === body.index || target.lastBotShotAt == null ||
    state.tick - target.lastBotShotAt >= Math.round(state.product.botCrossfireGapSec * state.product.fixedHz);
}
