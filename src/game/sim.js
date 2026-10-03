/**
 * The simulation. One tick of the match, and nothing else.
 *
 * No DOM, no clock, no Math.random, no trigonometry the standard does not pin
 * down: give it the same state and the same buttons and it produces the same
 * next state on every machine, which is the whole basis of the netcode.
 * Everything the outside world needs to know about what happened is pushed onto
 * `state.events` and read by the renderer and the sound; the simulation never
 * reads them back.
 *
 * The movement is the arcade shooter one, and it is worth saying out loud
 * because everything about how the game feels comes out of the order of it:
 *
 *   1. friction, but only on the floor
 *   2. accelerate towards where the buttons are pointing - hard on the floor,
 *      barely at all in the air
 *   3. gravity
 *   4. move, and let the geometry say where that ended up
 *
 * Step 2 is where the whole feel lives. On the ground the acceleration is so
 * large that you are at top speed within two frames; in the air it is capped at
 * a metre and a half a second, which is enough to steer a jump and not enough to
 * make jumping a way of travelling. It is also, if you point the buttons across
 * your own direction of travel, enough to gain a little speed each jump - which
 * nobody has to know about, and which is the reason a good player is quicker
 * across a map than a new one.
 */

import {
  AIR_ACCEL, AIR_SPEED, ARMOUR_SHARE, BTN, DT, FALL_HURT, FALL_MAX_DAMAGE, FALL_SAFE,
  FLAG_RADIUS, FLAG_RETURN_TICKS, FLASH_TICKS, FRICTION, GRAVITY, GROUND_ACCEL,
  INSTA_WEAPON, ITEMS, JUMP_SPEED, MAX_ARMOUR, MAX_HEALTH, MODES, MULTI_MAX, MULTI_WINDOW,
  OVER_TICKS, P_EYE, P_HEIGHT, P_RADIUS, RESPAWN_TICKS, ROCKET_LIFE, RUN_SPEED,
  SHIELD_BREAK_SPEED, SPREE_STEPS, TICK_RATE, VOID_DAMAGE, WEAPONS, YAW_UNITS,
} from '../constants.js';
import { clamp, cosA, nextRandom, randSpread, sinA, walkBasis } from '../util.js';
import { boxBlocked, moveBody, padUnder, traceRay, visible } from './world.js';
import { placeAtSpawn } from './state.js';
import { botInput } from './ai.js';
import { combatInput } from '../metafight/combat-ai.js';

const ZERO_INPUT = { b: 0, yaw: null, pitch: null };
/** Reused rather than allocated: this is called for every body, every tick. */
const basisScratch = {};

export function step(state, inputs = []) {
  if (state.productMatch && state.phase === 'over') return state;
  state.events.length = 0;
  state.tick++;
  if (state.productMatch) state.queuedDamage = [];

  if (state.phase === 'warmup') {
    state.phaseTimer--;
    if (state.phaseTimer <= 0) {
      state.phase = 'live';
      state.events.push({ type: 'begin' });
    }
  } else if (state.phase === 'live' && !state.product) {
    state.clock--;
    if (state.clock <= 0) finish(state, 'time');
  } else if (state.phase === 'over') {
    state.phaseTimer--;
  }

  for (const body of state.bodies) {
    const input = body.human ? (inputs[body.index] || ZERO_INPUT) : state.productMatch ? combatInput(state, body) : botInput(state, body);
    stepBody(state, body, input);
  }
  separate(state);
  stepProjectiles(state);
  stepItems(state);
  stepFlags(state);
  if (state.productMatch) {
    const pending = state.queuedDamage; state.queuedDamage = null;
    for (const hit of pending) hurt(state, state.bodies[hit.body], hit.amount, hit.from, hit.cause);
    state.heardShots = state.events.filter(e => e.type === 'fire').map(e => ({ x: e.x, y: e.y - P_EYE, z: e.z, team: state.bodies[e.body].team }));
    if (state.phase === 'live') {
      state.clock = Math.max(0, state.clock - 1);
      if (state.teamScore.some(score => score >= state.product.scoreLimit)) finish(state, 'limit');
      else if (state.clock === 0) finish(state, 'time');
    }
    // Resolve due respawns only after the final score/time decision.
    if (state.phase === 'live') for (const body of state.bodies) {
      if (!body.alive && body.respawnIn <= 0) {
        placeAtSpawn(state, body);
        state.events.push({ type: 'spawn', body: body.index, x: body.x, y: body.y, z: body.z });
      }
    }
  } else if (state.phase === 'live' && !state.product) checkLimits(state);
  return state;
}

// --- One body ----------------------------------------------------------------

function stepBody(state, body, input) {
  if (!body.alive) {
    if (state.product) body.respawnIn = Math.max(0, body.respawnAt - state.tick);
    else body.respawnIn--;
    if (body.respawnIn <= 0 && !state.productMatch) {
      placeAtSpawn(state, body);
      state.events.push({ type: 'spawn', body: body.index, x: body.x, y: body.y, z: body.z });
    }
    return;
  }

  const mask = input.b | 0;
  const frozen = state.phase !== 'live' && state.phase !== 'warmup';

  // Where you are looking is not a button, and it does not go through the
  // simulation's own idea of turning: the mouse has already decided, and the
  // number it decided is carried alongside the buttons. Bots write the same two
  // fields, so a bot and a person arrive here identical.
  if (input.yaw !== null && input.yaw !== undefined) body.yaw = input.yaw & (YAW_UNITS - 1);
  if (input.pitch !== null && input.pitch !== undefined) body.pitch = input.pitch | 0;

  move(state, body, frozen ? 0 : mask);
  weapons(state, body, frozen ? 0 : mask);

  if (body.shield > 0) {
    body.shield--;
    const speed = Math.sqrt(body.vx * body.vx + body.vz * body.vz);
    if (!state.product && speed > SHIELD_BREAK_SPEED) body.shield = 0;
  }
  body.prevMask = mask;
}

function move(state, body, mask) {
  const forward = (mask & BTN.FWD ? 1 : 0) - (mask & BTN.BACK ? 1 : 0);
  const strafe = (mask & BTN.RIGHT ? 1 : 0) - (mask & BTN.LEFT ? 1 : 0);

  // The way the body is facing on the floor plan, and the way its right hand
  // points. Pitch is for looking and for shooting; it has nothing to do with
  // which way running forwards takes you.
  const basis = walkBasis(body.yaw, basisScratch);
  let wx = basis.fx * forward + basis.rx * strafe;
  let wz = basis.fz * forward + basis.rz * strafe;
  const wl = Math.sqrt(wx * wx + wz * wz);
  if (wl > 0.0001) { wx /= wl; wz /= wl; } else { wx = 0; wz = 0; }

  if (body.onGround) {
    // Friction first, and it is deliberately savage: an arena shooter wants a
    // body that stops when you stop asking it to move.
    const speed = Math.sqrt(body.vx * body.vx + body.vz * body.vz);
    if (speed > 0.01) {
      const drop = Math.max(speed, 2.0) * FRICTION * DT;
      const scale = Math.max(0, speed - drop) / speed;
      body.vx *= scale;
      body.vz *= scale;
    } else {
      body.vx = 0;
      body.vz = 0;
    }
    accelerate(body, wx, wz, RUN_SPEED, GROUND_ACCEL);
  } else {
    // In the air the cap is on how much sideways you may add, not on how fast
    // you may go - which is why a jump can be steered but not driven.
    accelerate(body, wx, wz, AIR_SPEED, AIR_ACCEL);
  }

  // A pad throws you whether you asked for it or not. It is read before the
  // jump so that jumping off one adds nothing: the pad decides.
  const pad = body.onGround ? padUnder(state.world, body.x, body.y, body.z) : null;
  if (pad) {
    body.vy = pad.vy;
    body.vx += pad.px;
    body.vz += pad.pz;
    body.onGround = false;
    state.events.push({ type: 'pad', body: body.index, x: body.x, y: body.y, z: body.z });
  } else if ((mask & BTN.JUMP) && body.onGround) {
    body.vy = JUMP_SPEED;
    body.onGround = false;
    state.events.push({ type: 'jump', body: body.index });
  }

  body.vy -= GRAVITY * DT;

  const fell = body.vy;
  const beforeX = body.x;
  const beforeZ = body.z;
  const beforeY = body.y;
  const res = moveBody(state.world, body, body.vx * DT, body.vy * DT, body.vz * DT,
    P_RADIUS, P_HEIGHT);

  // The safety valve. A body that has not moved a centimetre in two seconds
  // while asking to is wedged in something the geometry has no way out of, and
  // in a lockstep game it is wedged on four machines at once. Put it back on a
  // spawn point rather than leave somebody watching a wall for the rest of the
  // match.
  const shifted = Math.abs(body.x - beforeX) + Math.abs(body.y - beforeY)
    + Math.abs(body.z - beforeZ);
  const moving = state.product ? mask & (BTN.FWD | BTN.BACK | BTN.LEFT | BTN.RIGHT) : mask;
  if (shifted < 0.001 && (moving || res.trapped)) body.wedged = (body.wedged || 0) + 1;
  else body.wedged = 0;
  if (body.wedged > 120) {
    body.wedged = 0;
    if (state.productMatch) {
      if (body.combat) { body.combat.repathAt = -999; body.combat.path.length = 0; body.combat.recoverUntil = state.tick + 45; body.combat.side *= -1; }
      state.events.push({ type: 'bot-repath', body: body.index });
    } else {
      placeAtSpawn(state, body);
      state.events.push({ type: 'unwedge', body: body.index, x: body.x, y: body.y, z: body.z });
    }
  }

  if (res.hitX) body.vx = 0;
  if (res.hitZ) body.vz = 0;
  if (res.hitY) {
    if (body.vy < 0 && fell < -FALL_SAFE) landHard(state, body, -fell);
    body.vy = 0;
  }

  const wasAir = !body.onGround;
  body.onGround = res.grounded;
  if (res.grounded) {
    if (body.vy < 0) {
      if (fell < -FALL_SAFE) landHard(state, body, -fell);
      body.vy = 0;
    }
    body.stepGrace = 8;
    if (wasAir) state.events.push({ type: 'land', body: body.index, speed: -fell });
  } else if (body.stepGrace > 0) {
    body.stepGrace--;
  }

  // Off the bottom of the world. Every map has a floor under its floor.
  if (body.y < state.map.void) {
    hurt(state, body, VOID_DAMAGE, state.product ? -1 : body.lastHurtAt > state.tick - 300 ? body.lastHurtBy : -1, 'void');
  }
}

function accelerate(body, wx, wz, wishSpeed, accel) {
  if (wishSpeed <= 0) return;
  const current = body.vx * wx + body.vz * wz;
  const add = wishSpeed - current;
  if (add <= 0) return;
  const gain = Math.min(accel * DT * wishSpeed, add);
  body.vx += wx * gain;
  body.vz += wz * gain;
}

function landHard(state, body, speed) {
  const over = (speed - FALL_SAFE) / (FALL_HURT - FALL_SAFE);
  const damage = Math.round(clamp(over, 0, 1.6) * FALL_MAX_DAMAGE);
  if (damage > 0) hurt(state, body, damage, -1, 'fall');
}

/**
 * Bodies push each other apart.
 *
 * Not a collision - two players in an arena shooter should be able to run
 * through the same doorway - but standing exactly inside somebody is worse than
 * either, so they slide apart at a metre a second and the matter settles itself.
 */
function separate(state) {
  const bodies = state.bodies;
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      if (!b.alive) continue;
      if (Math.abs(a.y - b.y) > P_HEIGHT * 0.9) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      const min = P_RADIUS * 2;
      if (d2 > min * min || d2 < 1e-9) continue;
      const d = Math.sqrt(d2);
      const push = ((min - d) / d) * 0.5;
      // Only into space that is actually there. Two bodies in a doorway used to
      // shove each other into the door frame, and a body inside the frame has
      // to be dug out again by moveBody on the next tick.
      shove(state, a, -dx * push, -dz * push);
      shove(state, b, dx * push, dz * push);
    }
  }
}

function shove(state, body, dx, dz) {
  const free = !boxBlocked(state.world, body.x + dx - P_RADIUS, body.y + 0.02, body.z + dz - P_RADIUS,
    body.x + dx + P_RADIUS, body.y + P_HEIGHT, body.z + dz + P_RADIUS);
  if (free) {
    body.x += dx;
    body.z += dz;
    return;
  }
  // Blocked one way: try the two axes on their own, so a body against a wall
  // still slides along it rather than staying welded to whoever bumped it.
  if (!boxBlocked(state.world, body.x + dx - P_RADIUS, body.y + 0.02, body.z - P_RADIUS,
    body.x + dx + P_RADIUS, body.y + P_HEIGHT, body.z + P_RADIUS)) body.x += dx;
  else if (!boxBlocked(state.world, body.x - P_RADIUS, body.y + 0.02, body.z + dz - P_RADIUS,
    body.x + P_RADIUS, body.y + P_HEIGHT, body.z + dz + P_RADIUS)) body.z += dz;
}

// --- Guns --------------------------------------------------------------------

function weapons(state, body, mask) {
  if (body.cooldown > 0) body.cooldown--;
  if (body.flash > 0) body.flash--;

  if (state.product) {
    if (body.reloadUntil) {
      if (state.tick < body.reloadUntil) return;
      body.ammo[0] = state.product.magazineSize; body.reloadUntil = 0;
      state.events.push({ type: 'reload-complete', body: body.index });
    }
    // RELOAD uses its own bit; a held button cannot restart a finished reload.
    if ((mask & BTN.RELOAD) && !(body.prevMask & BTN.RELOAD) && body.ammo[0] < state.product.magazineSize) {
      body.reloadUntil = state.tick + state.rules.reloadTicks;
      state.events.push({ type: 'reload', body: body.index }); return;
    }
    if (!(mask & BTN.FIRE) || body.cooldown > 0 || body.ammo[0] <= 0) return;
    fire(state, body, state.rifle);
    return;
  }

  if (!state.config.instagib) switchWeapon(state, body, mask);

  const weapon = WEAPONS[body.weapon];
  if (!(mask & BTN.FIRE)) {
    // The autogun's spread closes up again as soon as you let go of it, which
    // is the whole of its skill: short bursts are accurate and holding it down
    // is not.
    body.spread = Math.max(0, body.spread - weapon.spreadGrow * 2.2);
    return;
  }
  if (body.cooldown > 0) return;
  if (!(body.ammo[body.weapon] > 0)) {
    if (state.tick - body.firedAt > 20) {
      state.events.push({ type: 'dryfire', body: body.index });
      body.firedAt = state.tick;
    }
    autoSwitch(state, body);
    return;
  }
  fire(state, body, weapon);
}

function switchWeapon(state, body, mask) {
  const pressed = mask & ~body.prevMask;
  let want = -1;
  if (pressed & BTN.W1) want = 0;
  else if (pressed & BTN.W2) want = 1;
  else if (pressed & BTN.W3) want = 2;
  else if (pressed & BTN.W4) want = 3;
  else if (pressed & BTN.NEXT) want = cycle(body, 1);
  else if (pressed & BTN.PREV) want = cycle(body, -1);
  if (want < 0 || want === body.weapon) return;
  if (!body.have[want] || !(body.ammo[want] > 0)) return;
  body.weapon = want;
  body.spread = 0;
  body.switchAt = state.tick;
  state.events.push({ type: 'switch', body: body.index, weapon: want });
}

function cycle(body, dir) {
  const n = WEAPONS.length - 1; // the instagib rifle is never in the cycle
  for (let i = 1; i <= n; i++) {
    const at = (((body.weapon + dir * i) % n) + n) % n;
    if (body.have[at] && body.ammo[at] > 0) return at;
  }
  return body.weapon;
}

/** Out of ammunition: fall back to whatever is left, best first. */
function autoSwitch(state, body) {
  const order = [2, 3, 1, 0];
  for (const at of order) {
    if (body.have[at] && body.ammo[at] > 0) {
      body.weapon = at;
      body.switchAt = state.tick;
      state.events.push({ type: 'switch', body: body.index, weapon: at });
      return;
    }
  }
}

function aimVector(body, out) {
  const cp = cosA(body.pitch);
  out.x = cosA(body.yaw) * cp;
  out.y = sinA(body.pitch);
  out.z = sinA(body.yaw) * cp;
  return out;
}

const aimScratch = { x: 0, y: 0, z: 0 };

function fire(state, body, weapon) {
  body.cooldown = weapon.interval;
  body.firedAt = state.tick;
  body.flash = FLASH_TICKS;
  body.shield = 0; // shooting from behind the shield ends it
  if (Number.isFinite(body.ammo[body.weapon])) body.ammo[body.weapon]--;

  const dir = aimVector(body, aimScratch);
  const ox = body.x;
  const oy = body.y + P_EYE;
  const oz = body.z;

  state.events.push({
    type: 'fire', body: body.index, weapon: body.weapon, x: ox, y: oy, z: oz,
    dx: dir.x, dy: dir.y, dz: dir.z,
  });

  if (weapon.kind === 'projectile') {
    state.projectiles.push({
      id: state.nextId++,
      owner: body.index,
      weapon: body.weapon,
      x: ox + dir.x * 0.6, y: oy + dir.y * 0.6, z: oz + dir.z * 0.6,
      vx: dir.x * weapon.speed, vy: dir.y * weapon.speed, vz: dir.z * weapon.speed,
      life: ROCKET_LIFE,
    });
  } else {
    const spread = Math.min(weapon.spreadMax, weapon.spread + body.spread);
    for (let i = 0; i < weapon.pellets; i++) {
      let dx = dir.x;
      let dy = dir.y;
      let dz = dir.z;
      if (spread > 0) {
        // Scattered around the aim, not along one axis: a shotgun that spread
        // sideways only would be a very strange shotgun.
        const sx = randSpread(state) * spread;
        const sy = randSpread(state) * spread;
        // Two vectors across the aim. The world has no roll, so "across" is
        // always the same two directions and they need no basis worked out.
        const rx = -dir.z;
        const rz = dir.x;
        const rl = Math.sqrt(rx * rx + rz * rz) || 1;
        const ux = (rz / rl) * dir.y;
        const uy = -((rx / rl) * dir.z - (rz / rl) * dir.x);
        const uz = -(rx / rl) * dir.y;
        dx += (rx / rl) * sx + ux * sy;
        dy += uy * sy;
        dz += (rz / rl) * sx + uz * sy;
        const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        dx /= l; dy /= l; dz /= l;
      }
      hitscan(state, body, weapon, ox, oy, oz, dx, dy, dz);
    }
    body.spread = Math.min(weapon.spreadMax, body.spread + weapon.spreadGrow);
  }

  // What the gun does to the person holding it. A rail shot moves you a metre;
  // a rocket at your own feet moves you a great deal further, and that is the
  // other half of the rocket launcher.
  if (weapon.kick) {
    body.vx -= dir.x * weapon.kick;
    body.vz -= dir.z * weapon.kick;
    if (!body.onGround) body.vy -= dir.y * weapon.kick * 0.4;
  }
}

function hitscan(state, body, weapon, ox, oy, oz, dx, dy, dz) {
  const range = weapon.range || 300;
  const wall = traceRay(state.world, ox, oy, oz, dx, dy, dz, range);
  const target = nearestBody(state, body, ox, oy, oz, dx, dy, dz, wall.dist);

  if (target.body) {
    // Only a hit if it did something. A round that stops in a team mate is a
    // round that stopped, not a hit: no marker, no damage, no credit.
    const damage = state.product && target.head ? state.product.headDamage : weapon.damage;
    const landed = hurt(state, target.body, damage, body.index, weapon.key);
    if (landed) {
      body.damageOut += damage;
      state.events.push({
        type: 'hit', body: body.index, victim: target.body.index, weapon: body.weapon,
        x: ox + dx * target.dist, y: oy + dy * target.dist, z: oz + dz * target.dist,
        dist: target.dist, head: !!target.head,
      });
    }
  } else if (wall.solid) {
    state.events.push({
      type: 'impact', body: body.index, weapon: body.weapon,
      x: wall.x, y: wall.y, z: wall.z, nx: wall.nx, ny: wall.ny, nz: wall.nz,
      dist: wall.dist,
    });
  }
  if (weapon.trail) {
    state.events.push({
      type: 'trail', body: body.index, weapon: body.weapon,
      x: ox, y: oy, z: oz,
      x2: ox + dx * Math.min(range, target.body ? target.dist : wall.dist),
      y2: oy + dy * Math.min(range, target.body ? target.dist : wall.dist),
      z2: oz + dz * Math.min(range, target.body ? target.dist : wall.dist),
    });
  }
}

/** The first body a ray runs into. Bodies are boxes for this, like everything. */
function nearestBody(state, shooter, ox, oy, oz, dx, dy, dz, maxDist) {
  let best = null;
  let bestDist = maxDist;
  let head = false;
  for (const other of state.bodies) {
    if (other === shooter || !other.alive) continue;
    const torso = rayAgainstBody(other, ox, oy, oz, dx, dy, dz, bestDist, 0, state.product ? 1.44 : P_HEIGHT);
    const helmet = state.product ? rayAgainstBody(other, ox, oy, oz, dx, dy, dz, bestDist, 1.44, 1.76, 0.2) : -1;
    const hitHead = helmet >= 0 && (torso < 0 || helmet < torso);
    const t = hitHead ? helmet : torso;
    if (t >= 0 && t < bestDist) { bestDist = t; best = other; head = hitHead; }
  }
  return { body: best, dist: bestDist, head };
}

function rayAgainstBody(body, ox, oy, oz, dx, dy, dz, maxDist, bottom = 0, top = P_HEIGHT, radius = P_RADIUS) {
  const lo = [body.x - radius, body.y + bottom, body.z - radius];
  const hi = [body.x + radius, body.y + top, body.z + radius];
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  let t0 = 0;
  let t1 = maxDist;
  for (let i = 0; i < 3; i++) {
    if (d[i] === 0) {
      if (o[i] < lo[i] || o[i] > hi[i]) return -1;
      continue;
    }
    const inv = 1 / d[i];
    let ta = (lo[i] - o[i]) * inv;
    let tb = (hi[i] - o[i]) * inv;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return -1;
  }
  return t0;
}

// --- Rockets -----------------------------------------------------------------

function stepProjectiles(state) {
  const keep = [];
  for (const p of state.projectiles) {
    const weapon = WEAPONS[p.weapon];
    const dx = p.vx * DT;
    const dy = p.vy * DT;
    const dz = p.vz * DT;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const ux = dx / dist;
    const uy = dy / dist;
    const uz = dz / dist;

    const shooter = state.bodies[p.owner];
    const wall = traceRay(state.world, p.x, p.y, p.z, ux, uy, uz, dist, 0.16);
    const target = nearestBody(state, shooter, p.x, p.y, p.z, ux, uy, uz,
      Math.min(dist, wall.solid ? wall.dist : dist));

    if (target.body) {
      const at = { x: p.x + ux * target.dist, y: p.y + uy * target.dist, z: p.z + uz * target.dist };
      if (hurt(state, target.body, weapon.damage, p.owner, weapon.key) && shooter) {
        shooter.damageOut += weapon.damage;
      }
      explode(state, p, at.x, at.y, at.z, target.body.index);
      continue;
    }
    if (wall.solid) {
      // Backed off the wall by a hand's width, so the blast is in the room
      // rather than inside the brickwork.
      explode(state, p, p.x + ux * wall.dist + wall.nx * 0.1,
        p.y + uy * wall.dist + wall.ny * 0.1, p.z + uz * wall.dist + wall.nz * 0.1, -1);
      continue;
    }

    p.x += dx;
    p.y += dy;
    p.z += dz;
    p.life--;
    if (p.life <= 0 || p.y < state.map.void) {
      explode(state, p, p.x, p.y, p.z, -1);
      continue;
    }
    keep.push(p);
  }
  state.projectiles = keep;
}

function explode(state, p, x, y, z, direct) {
  const weapon = WEAPONS[p.weapon];
  state.events.push({ type: 'explode', x, y, z, weapon: p.weapon, owner: p.owner });

  const radius = weapon.splashRadius || 0;
  if (radius <= 0) return;
  for (const body of state.bodies) {
    if (!body.alive) continue;
    if (body.index === direct) continue; // already had the direct hit
    const cx = body.x;
    const cy = body.y + P_HEIGHT * 0.5;
    const cz = body.z;
    const dx = cx - x;
    const dy = cy - y;
    const dz = cz - z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > radius) continue;
    // A wall between you and the blast is a wall: splash that goes round corners
    // makes the rocket launcher the only gun in the game.
    if (!visible(state.world, x, y, z, cx, cy, cz)) continue;

    const falloff = 1 - d / radius;
    let amount = weapon.splash * falloff;
    if (body.index === p.owner) amount *= weapon.selfShare ?? 1;
    // The push is what makes a rocket jump, and it is applied before the damage
    // so that a body that does not survive it still gets thrown.
    const push = (weapon.push || 0) * falloff;
    const l = d < 0.001 ? 1 : d;
    body.vx += (dx / l) * push;
    body.vy += (dy / l) * push * 1.15 + push * 0.35;
    body.vz += (dz / l) * push;
    body.onGround = false;
    if (amount >= 1) hurt(state, body, Math.round(amount), p.owner, weapon.key);
  }
}

// --- Damage and dying --------------------------------------------------------

/** Returns whether the damage actually landed. */
export function hurt(state, body, amount, from, cause) {
  if ((state.productMatch && state.phase === 'over') || !body.alive || amount <= 0) return false;
  const teams = MODES[state.config.mode].teams;
  const attacker = from >= 0 ? state.bodies[from] : null;

  if (attacker && attacker !== body) {
    if (body.shield > 0) return false;
    // No friendly fire. A team game with it is a team game about the team.
    if (teams && attacker.team === body.team) return false;
  }

  if (state.queuedDamage) {
    state.queuedDamage.push({ body: body.index, amount, from, cause }); return true;
  }
  let left = amount;
  if (!state.product && body.armour > 0 && cause !== 'void' && cause !== 'fall') {
    const soaked = Math.min(body.armour, Math.round(amount * ARMOUR_SHARE));
    body.armour -= soaked;
    left -= soaked;
  }
  body.health -= left;
  body.lastHurtBy = from;
  body.lastHurtAt = state.tick;
  state.events.push({
    type: 'hurt', body: body.index, from, amount: left, cause,
    x: body.x, y: body.y + P_HEIGHT * 0.6, z: body.z,
  });

  if (body.health <= 0) die(state, body, from, cause);
  return true;
}

function die(state, body, from, cause) {
  body.alive = false;
  body.health = 0;
  body.deaths++;
  body.streakWas = body.streak;
  body.streak = 0;
  body.multi = 0;
  body.respawnIn = state.product ? state.rules.respawnTicks : RESPAWN_TICKS;
  body.respawnAt = state.tick + body.respawnIn;
  body.reloadUntil = 0;
  body.ai.path.length = 0;

  const teams = MODES[state.config.mode].teams;
  const killer = from >= 0 && from !== body.index ? state.bodies[from] : null;
  if (killer) {
    killer.kills++;
    killer.streak++;
    killer.score++;
    if (teams && !MODES[state.config.mode].flags) state.teamScore[killer.team]++;
    announce(state, killer, body);
  } else if (!state.product) {
    // Falling off the world, or standing in your own rocket.
    body.score--;
    if (teams && !MODES[state.config.mode].flags) {
      state.teamScore[body.team] = Math.max(0, state.teamScore[body.team] - 1);
    }
  }

  // A spree that somebody has ended is worth saying so, and it is said about
  // the person it happened to rather than the person who did it: in a four
  // player match everybody knows who did it.
  if (body.streakWas >= SPREE_STEPS[0]) {
    state.events.push({
      type: 'spreeend', body: body.index, killer: killer ? killer.index : -1,
      count: body.streakWas,
    });
  }
  body.nemesis = killer ? killer.index : -1;

  dropFlag(state, body);
  state.events.push({
    type: 'death', body: body.index, killer: killer ? killer.index : -1, cause,
    x: body.x, y: body.y, z: body.z,
  });
}

/**
 * What the announcer has to say about a kill.
 *
 * All of it comes out of the state and the tick, so every machine works out the
 * same thing at the same moment - which matters more than it looks: an
 * announcement is not part of the simulation, but it is heard by four people who
 * are all quite sure they know who is on a rampage.
 */
function announce(state, killer, victim) {
  if (!state.firstBlood) {
    state.firstBlood = true;
    state.events.push({ type: 'firstblood', body: killer.index });
  }

  killer.multi = state.tick - killer.multiAt <= MULTI_WINDOW ? killer.multi + 1 : 1;
  killer.multiAt = state.tick;
  if (killer.multi >= 2) {
    state.events.push({
      type: 'multi', body: killer.index, count: Math.min(MULTI_MAX, killer.multi),
    });
  }

  if (SPREE_STEPS.includes(killer.streak)) {
    state.events.push({ type: 'spree', body: killer.index, count: killer.streak });
  }

  // Killing the last person who killed you, before dying to anybody else.
  if (killer.nemesis === victim.index) {
    killer.nemesis = -1;
    state.events.push({ type: 'revenge', body: killer.index, victim: victim.index });
  }
}

// --- Things on the floor -----------------------------------------------------

function stepItems(state) {
  for (const item of state.items) {
    if (!item.live) {
      if (state.config.instagib) continue;
      item.timer--;
      if (item.timer <= 0) {
        item.live = true;
        state.events.push({ type: 'itemup', item: item.index, x: item.x, y: item.y, z: item.z });
      }
      continue;
    }
    const def = ITEMS[item.type];
    for (const body of state.bodies) {
      if (!body.alive) continue;
      const dx = body.x - item.x;
      const dz = body.z - item.z;
      const dy = (body.y + P_HEIGHT * 0.5) - item.y;
      const reach = def.radius + P_RADIUS;
      if (dx * dx + dz * dz > reach * reach) continue;
      if (Math.abs(dy) > 1.4) continue;
      if (!give(state, body, item, def)) continue;
      item.live = false;
      item.timer = def.respawn;
      state.events.push({
        type: 'pickup', body: body.index, item: item.index, kind: item.type,
        weapon: item.weapon, x: item.x, y: item.y, z: item.z,
      });
      break;
    }
  }
}

/** Hand an item over, or say no - a full health pack is left where it is. */
function give(state, body, item, def) {
  if (item.type === 'health' || item.type === 'bighealth') {
    if (body.health >= MAX_HEALTH) return false;
    body.health = Math.min(MAX_HEALTH, body.health + def.give);
    return true;
  }
  if (item.type === 'armour') {
    if (body.armour >= MAX_ARMOUR) return false;
    body.armour = Math.min(MAX_ARMOUR, body.armour + def.give);
    return true;
  }
  const at = item.weapon >= 0 ? item.weapon : 0;
  const weapon = WEAPONS[at];
  if (item.type === 'weapon') {
    const had = body.have[at];
    if (had && body.ammo[at] >= weapon.maxAmmo) return false;
    body.have[at] = true;
    body.ammo[at] = Math.min(weapon.maxAmmo, body.ammo[at] + weapon.pickup);
    // Picking a gun up puts it in your hands, unless you are holding something
    // you would rather have. "Rather" is: the one you just found, if it is
    // further up the table than what you are carrying.
    if (!had && at > body.weapon) {
      body.weapon = at;
      body.switchAt = state.tick;
    }
    return true;
  }
  if (body.ammo[at] >= weapon.maxAmmo) return false;
  body.ammo[at] = Math.min(weapon.maxAmmo, body.ammo[at] + weapon.pickup);
  if (!body.have[at]) return true; // ammunition for a gun you have not found yet
  return true;
}

// --- Flags -------------------------------------------------------------------

function stepFlags(state) {
  if (!MODES[state.config.mode].flags) return;

  for (const flag of state.flags) {
    if (flag.status === 'carried') {
      const carrier = state.bodies[flag.carrier];
      if (!carrier || !carrier.alive) { dropAt(state, flag); continue; }
      flag.x = carrier.x;
      flag.y = carrier.y + 1.1;
      flag.z = carrier.z;
      continue;
    }
    if (flag.status === 'dropped') {
      flag.timer--;
      if (flag.timer <= 0) returnFlag(state, flag, -1);
    }
  }

  for (const body of state.bodies) {
    if (!body.alive) continue;
    for (const flag of state.flags) {
      if (flag.status === 'carried') continue;
      const dx = body.x - flag.x;
      const dz = body.z - flag.z;
      const dy = (body.y + P_HEIGHT * 0.5) - flag.y;
      const reach = FLAG_RADIUS + P_RADIUS;
      if (dx * dx + dz * dz > reach * reach || Math.abs(dy) > 1.6) continue;

      if (flag.team !== body.team) {
        flag.status = 'carried';
        flag.carrier = body.index;
        body.carrying = flag.team;
        state.events.push({ type: 'take', body: body.index, team: flag.team });
      } else if (flag.status === 'dropped') {
        returnFlag(state, flag, body.index);
        body.score += 1;
      } else if (body.carrying >= 0) {
        capture(state, body, flag);
      }
    }
  }
}

function capture(state, body, homeFlag) {
  // You can only score on your own flag, and only if it is on its stand. The
  // rule that makes a defender worth having.
  if (homeFlag.status !== 'home') return;
  const taken = state.flags.find((f) => f.carrier === body.index);
  if (!taken) return;
  taken.status = 'home';
  taken.carrier = -1;
  taken.x = taken.home.x;
  taken.y = taken.home.y;
  taken.z = taken.home.z;
  body.carrying = -1;
  body.score += 5;
  state.teamScore[body.team]++;
  state.events.push({ type: 'capture', body: body.index, team: body.team });
}

function dropFlag(state, body) {
  if (body.carrying < 0) return;
  const flag = state.flags.find((f) => f.carrier === body.index);
  body.carrying = -1;
  if (flag) dropAt(state, flag);
}

function dropAt(state, flag) {
  const carrier = flag.carrier >= 0 ? state.bodies[flag.carrier] : null;
  flag.status = 'dropped';
  flag.carrier = -1;
  flag.timer = FLAG_RETURN_TICKS;
  if (carrier) {
    flag.x = carrier.x;
    flag.y = Math.max(state.map.void + 2, carrier.y + 0.6);
    flag.z = carrier.z;
  }
  // Dropped down a hole, it comes straight back: a flag at the bottom of the
  // void is a match that cannot end.
  if (flag.y < state.map.void + 3) returnFlag(state, flag, -1);
  else state.events.push({ type: 'drop', team: flag.team });
}

function returnFlag(state, flag, by) {
  flag.status = 'home';
  flag.carrier = -1;
  flag.timer = 0;
  flag.x = flag.home.x;
  flag.y = flag.home.y;
  flag.z = flag.home.z;
  state.events.push({ type: 'return', team: flag.team, body: by });
}

// --- The end -----------------------------------------------------------------

function checkLimits(state) {
  const mode = MODES[state.config.mode];
  const limit = state.config.limit;
  if (!limit) return;
  if (mode.teams) {
    for (let t = 0; t < 2; t++) if (state.teamScore[t] >= limit) return finish(state, 'limit');
  } else {
    for (const body of state.bodies) if (body.score >= limit) return finish(state, 'limit');
  }
  return undefined;
}

function finish(state, why) {
  if (state.phase === 'over') return;
  state.phase = 'over';
  state.phaseTimer = OVER_TICKS;
  const mode = MODES[state.config.mode];
  if (mode.teams) {
    state.winner = state.teamScore[0] === state.teamScore[1] ? -1
      : (state.teamScore[0] > state.teamScore[1] ? 0 : 1);
  } else {
    let best = state.bodies[0];
    for (const body of state.bodies) if (body.score > best.score) best = body;
    state.winner = best.index;
  }
  if (state.productMatch) {
    const actors = state.bodies.map(b => Object.freeze({ id: b.id, index: b.index, name: b.name,
      team: b.team, player: b.index === 0, kills: b.kills, deaths: b.deaths }));
    actors.sort((a, b) => a.team - b.team || b.kills - a.kills || a.deaths - b.deaths || a.id - b.id);
    state.result = Object.freeze({ reason: why, winner: state.winner, elapsedTicks: state.rules.timeLimitTicks - state.clock,
      scores: Object.freeze(state.teamScore.slice()), actors: Object.freeze(actors) });
  }
  state.events.push({ type: 'over', why, winner: state.winner });
}

export { TICK_RATE, INSTA_WEAPON };
