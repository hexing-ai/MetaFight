/**
 * The match, as data.
 *
 * Same contract as the rest of the series: one plain object holding everything
 * the game needs, no DOM, no clock, and no randomness that does not come out of
 * `state.rng`. Four machines given the same state and the same buttons must
 * reach the same score, which is what makes the netcode possible and, more
 * usefully day to day, makes the whole thing testable without a browser.
 *
 * The two things in here that are not numbers are `state.map` and `state.world`,
 * and both are safe: they are built from the map's key by loadMap() and
 * buildWorld(), which are pure and cached, so every machine has the identical
 * arena down to the last box.
 */

import {
  DEFAULT_TIME_LIMIT, INSTA_WEAPON, ITEMS, MAX_ARMOUR, MAX_HEALTH, MAX_BODIES,
  MODES, SKILLS, START_WEAPON, TICK_RATE, WARMUP_TICKS, WEAPONS, BOT_NAMES,
} from '../constants.js';
import { loadMap } from './maps.js';
import { buildWorld, visible } from './world.js';
import { buildNav } from './nav.js';
import { createGameConfig, simulationRules } from '../metafight/config.js';

export function createMatch(options = {}) {
  const opts = {
    seed: 20260909,
    map: 'foundry',
    mode: 'dm',
    instagib: false,
    humans: [true, false, false, false],
    bots: 3,
    skill: 'normal',
    limit: null,
    timeLimit: DEFAULT_TIME_LIMIT,
    names: [],
    ...options,
  };

  const mode = MODES[opts.mode] || MODES.dm;
  const map = opts.mapData || loadMap(opts.map);
  const world = buildWorld(map);
  const nav = buildNav(world);
  const skill = SKILLS[opts.skill] || SKILLS.normal;

  const seats = opts.humans.length;
  const product = opts.productConfig ? createGameConfig(opts.productConfig, { development: !!opts.development }) : null;
  const rules = product ? simulationRules(product, { development: !!opts.development }) : null;
  const count = rules ? rules.bodyCount : Math.min(MAX_BODIES, Math.max(2, seats + Math.max(0, opts.bots)));
  if (product && (opts.mode !== 'tdm' || opts.instagib || seats !== count || opts.bots !== 0)) throw new Error('产品角色必须显式配置席位');

  const state = {
    tick: 0,
    rng: opts.seed | 0,
    seed: opts.seed | 0,
    config: {
      map: map.key,
      mode: mode.key,
      instagib: !!opts.instagib,
      skill: skill.key,
      limit: product ? product.scoreLimit : opts.limit ?? mode.limit,
      timeLimit: product ? rules.timeLimitTicks : opts.timeLimit,
      bodies: count,
      seats,
    },
    map,
    world,
    nav,
    product, rules,
    productMatch: !!product && ['match', 'match-12'].includes(product.fixture),
    rifle: product ? Object.freeze({ ...WEAPONS[0], damage: product.bodyDamage,
      interval: rules.shotIntervalTicks, spread: 0, spreadGrow: 0, spreadMax: 0 }) : null,
    // warmup | live | over
    phase: 'warmup',
    phaseTimer: WARMUP_TICKS,
    clock: product ? rules.timeLimitTicks : opts.timeLimit,
    // What just happened. The renderer and the sound read these; the simulation
    // never reads them back, and they are cleared at the top of every step.
    events: [],
    // Said once a match, by whoever gets there first.
    firstBlood: false,
    bodies: [],
    projectiles: [],
    items: [],
    flags: [],
    teamScore: [0, 0],
    winner: null,
    nextId: 1,
  };

  for (let i = 0; i < count; i++) {
    const human = i < seats && !!opts.humans[i];
    const team = mode.teams ? i % 2 : -1;
    const name = opts.names[i] || (human ? `Player ${i + 1}` : BOT_NAMES[i % BOT_NAMES.length]);
    state.bodies.push(makeBody(state, i, human, team, name, skill));
  }

  // Items are laid out even in instagib, and then switched off: the map is the
  // map, and a mode that hides half of it would be a different arena.
  for (const item of map.items) {
    state.items.push({
      index: item.index,
      type: item.type,
      weapon: item.weapon,
      x: item.x, y: item.y, z: item.z,
      timer: 0,
      live: !state.config.instagib,
    });
  }

  for (const flag of map.flags) {
    state.flags.push({
      team: flag.team,
      home: { x: flag.x, y: flag.y, z: flag.z },
      x: flag.x, y: flag.y, z: flag.z,
      // home | carried | dropped
      status: 'home',
      carrier: -1,
      timer: 0,
    });
  }

  for (const body of state.bodies) placeAtSpawn(state, body, true);
  return state;
}

function makeBody(state, index, human, team, name, skill) {
  const insta = state.config.instagib;
  const have = WEAPONS.map(() => false);
  const ammo = WEAPONS.map(() => 0);
  if (insta) {
    have[INSTA_WEAPON] = true;
    ammo[INSTA_WEAPON] = Infinity;
  } else {
    have[START_WEAPON] = true;
    ammo[START_WEAPON] = WEAPONS[START_WEAPON].ammo;
  }

  return {
    index,
    id: state.nextId++,
    name,
    human: !!human,
    team,
    skill: human ? null : skill,

    x: 0, y: 0, z: 0,
    vx: 0, vy: 0, vz: 0,
    yaw: 0, pitch: 0,

    alive: true,
    health: MAX_HEALTH,
    armour: 0,
    shield: 0,
    respawnIn: 0,

    weapon: insta ? INSTA_WEAPON : START_WEAPON,
    have,
    ammo,
    cooldown: 0,
    spread: 0,
    firedAt: -999,
    flash: 0,
    switchAt: -999,

    onGround: true,
    stepGrace: 0,
    landing: 0,
    bob: 0,
    prevMask: 0,
    jumpHeld: false,

    kills: 0,
    deaths: 0,
    score: 0,
    // Kills without dying, and kills close enough together to count as one
    // piece of work. Both are what the announcer is announcing.
    streak: 0,
    multi: 0,
    multiAt: -999,
    // Whoever killed you last, so that killing them back is worth saying.
    nemesis: -1,
    damageOut: 0,
    lastHurtBy: -1,
    lastHurtAt: -999,
    carrying: -1,

    // Everything the bot remembers between ticks. Human bodies carry it too and
    // never look at it, which costs eight objects and keeps the two kinds of
    // body exactly the same shape - and a body that is the same shape is a body
    // a human can take over from a bot mid-match without anything noticing.
    ai: {
      target: -1, seenAt: -999, lostAt: -999, goal: null, goalKind: '',
      path: [], step: 0, repathAt: -999, thinkAt: -999,
      strafe: 1, strafeAt: -999, jumpAt: -999, aimYaw: 0, aimPitch: 0,
      wanderAt: -999,
      // Attack or defend, and it must not be worked out from the same number
      // the team was: seats alternate teams, so `index % 2` gave one side four
      // attackers and the other four defenders, and one flag sat unguarded for
      // the whole match while the other was never once taken.
      role: Math.floor(index / 2) % 2 === 0 ? 'attack' : 'defend',
    },
  };
}

/**
 * Put a body on a spawn point.
 *
 * Not any spawn point: the one furthest from everybody who is alive and not on
 * your side, with a little randomness between the best few so that dying twice
 * does not put you in the same corner twice. Spawning in front of the person who
 * just killed you is the single most annoying thing an arena shooter can do.
 */
export function placeAtSpawn(state, body, initial = false) {
  const { spawns } = state.map;
  const teams = MODES[state.config.mode].teams;
  let best = null;
  let bestScore = -Infinity;

  for (let i = 0; i < spawns.length; i++) {
    const spawn = spawns[i];
    if (teams && spawn.team >= 0 && spawn.team !== body.team) continue;
    let score = 0;
    let occupied = false;
    let exposed = 0, nearestEnemy = Infinity;
    for (const other of state.bodies) {
      if (other === body || !other.alive) continue;
      const dx = other.x - spawn.x;
      const dy = other.y - spawn.y;
      const dz = other.z - spawn.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1.2) occupied = true;
      const friendly = teams && other.team === body.team;
      score += friendly ? Math.min(d, 20) * 0.15 : Math.min(d, 60);
      if (state.productMatch && !friendly) {
        nearestEnemy = Math.min(nearestEnemy, d);
        if (visible(state.world, other.x, other.y + 1.62, other.z, spawn.x, spawn.y + 1.35, spawn.z)) exposed++;
      }
    }
    if (state.productMatch) {
      // Prefer screened positions, then distance; never move a spawn or geometry.
      score -= exposed * 600;
      if (nearestEnemy < 8) score -= (8 - nearestEnemy) * 100;
    }
    if (occupied) score -= state.productMatch ? 100000 : 500;
    // A spread of a few metres between equals, decided by the shared generator
    // so that every machine picks the same corner.
    score += nextSpawnJitter(state) * 12;
    if (score > bestScore) { bestScore = score; best = spawn; }
  }

  const spawn = best || spawns[0];
  body.x = spawn.x;
  body.y = spawn.y;
  body.z = spawn.z;
  body.vx = 0; body.vy = 0; body.vz = 0;
  body.yaw = spawn.yaw;
  body.pitch = 0;
  body.alive = true;
  body.health = MAX_HEALTH;
  body.armour = 0;
  body.shield = state.product ? state.rules.protectionTicks : initial ? 0 : 90;
  body.reloadUntil = 0;
  body.lastBotShotAt = null; body.lastBotShooter = -1;
  body.lifeId = (body.lifeId || 0) + 1;
  body.prevMask = 0;
  body.respawnIn = 0;
  body.onGround = true;
  body.cooldown = 0;
  body.spread = 0;
  body.carrying = -1;
  body.ai.path.length = 0;
  body.ai.target = -1;
  body.ai.repathAt = -999;
  // A new life gets a new plan. Without this a bot that died reaching for
  // something at the far end of the map sets off for it again from its own
  // spawn, seventy metres away, and gets shot doing it.
  body.ai.goal = null;
  body.ai.goalUntil = -999;
  body.ai.goalItem = null;
  body.ai.shoppedAt = -999;

  if (state.config.instagib) {
    body.weapon = INSTA_WEAPON;
  } else {
    for (let i = 0; i < body.have.length; i++) {
      body.have[i] = i === START_WEAPON;
      body.ammo[i] = i === START_WEAPON ? (state.product ? state.product.magazineSize : WEAPONS[START_WEAPON].ammo) : 0;
    }
    body.weapon = START_WEAPON;
  }
}

// Its own draw off the shared generator, so that adding a spawn point does not
// change what every later random number in the match is.
function nextSpawnJitter(state) {
  state.rng = (state.rng + 0x6d2b79f5) | 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function itemDef(item) {
  return ITEMS[item.type] || ITEMS.health;
}

/** Everybody, in the order they should appear on the score board. */
export function standings(state) {
  return [...state.bodies].sort((a, b) => (b.score - a.score) || (a.deaths - b.deaths)
    || (a.index - b.index));
}

export function clockText(ticks) {
  const total = Math.max(0, Math.round(ticks / TICK_RATE));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Deterministic hash of everything that matters, for the desync check. */
export function hashState(state) {
  let h = 2166136261;
  const mix = (v) => {
    h ^= Math.round(v * 32) | 0;
    h = Math.imul(h, 16777619);
  };
  mix(state.tick);
  mix(state.phase === 'live' ? 1 : state.phase === 'warmup' ? 2 : 3);
  mix(state.teamScore[0]);
  mix(state.teamScore[1]);
  for (const body of state.bodies) {
    mix(body.x); mix(body.y); mix(body.z);
    mix(body.vx); mix(body.vy); mix(body.vz);
    mix(body.yaw / 64); mix(body.pitch / 64);
    mix(body.health); mix(body.armour);
    mix(body.weapon); mix(body.score); mix(body.alive ? 1 : 0);
    mix(body.carrying);
  }
  // Rockets come out of state.rng and land where the geometry says. Two
  // machines that disagreed about one are about to disagree about the match.
  mix(state.projectiles.length);
  for (const p of state.projectiles) { mix(p.x); mix(p.y); mix(p.z); }
  for (const flag of state.flags) { mix(flag.x); mix(flag.z); mix(flag.carrier); }
  for (const item of state.items) mix(item.live ? 1 : 0);
  return h >>> 0;
}

export { MAX_HEALTH, MAX_ARMOUR };
