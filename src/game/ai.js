/**
 * The bots.
 *
 * They run inside the simulation rather than beside it: `botInput` returns the
 * same three fields a person's mouse and keyboard produce, and the simulation
 * cannot tell which is which. That is not tidiness for its own sake - in
 * lockstep every machine runs every bot, so a bot that consulted anything but
 * the state (the clock, Math.random, how fast this particular laptop is) would
 * turn left here and right there and the match would come apart.
 *
 * A bot does four things, in this order, and they are deliberately separate:
 *
 *   who am I fighting   - the nearest enemy it can actually see
 *   where am I going    - a path through nav.js to an item, a flag or a fight
 *   where am I looking  - the enemy, led by its own velocity, plus an error
 *   what am I pressing  - the two buttons nearest the way it wants to move
 *
 * The difference between Rookie and Brutal is four numbers in SKILLS and nothing
 * else: how big the aim error is, how long it takes to notice you, how well it
 * leads a moving target, and how single-minded it is about picking things up.
 * There is no bot that sees through walls and no bot that is given free damage.
 */

import {
  BTN, INSTA_WEAPON, MODES, P_EYE, P_HEIGHT, START_WEAPON, TICK_RATE, WEAPONS, YAW_UNITS,
} from '../constants.js';
import {
  angleDelta, atan2A, clamp, cosA, nextRandom, randSpread, sinA, walkBasis,
} from '../util.js';
import { visible } from './world.js';
import { findPath, nearestNode } from './nav.js';

/** How fast a bot can swing its aim, in yaw units a tick. About 300 deg/s. */
const TURN_RATE = 900;
const basisScratch = {};
const SIGHT = 70;
const REPATH = 40;

export function botInput(state, body) {
  const out = { b: 0, yaw: body.yaw, pitch: body.pitch };
  if (!body.alive) return out;

  const ai = body.ai;
  const skill = body.skill;

  if (state.tick - ai.thinkAt >= skill.react) {
    ai.thinkAt = state.tick;
    pickTarget(state, body);
    pickGoal(state, body);
    pickWeapon(state, body, out);
  }

  const target = ai.target >= 0 ? state.bodies[ai.target] : null;
  const fighting = target && target.alive && state.tick - ai.seenAt < 90;

  aim(state, body, fighting ? target : null, out);
  const mask = drive(state, body, fighting ? target : null);
  out.b = mask | shoot(state, body, fighting ? target : null, out);
  return out;
}

// --- Who am I fighting -------------------------------------------------------

function pickTarget(state, body) {
  const ai = body.ai;
  const teams = MODES[state.config.mode].teams;
  const ex = body.x;
  const ey = body.y + P_EYE;
  const ez = body.z;

  let best = -1;
  let bestScore = -Infinity;
  for (const other of state.bodies) {
    if (other === body || !other.alive) continue;
    if (teams && other.team === body.team) continue;
    const dx = other.x - ex;
    const dy = (other.y + P_HEIGHT * 0.55) - ey;
    const dz = other.z - ez;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > SIGHT) continue;
    if (!visible(state.world, ex, ey, ez, other.x, other.y + P_HEIGHT * 0.55, other.z)) continue;

    // Nearest wins, but somebody already looking at you wins sooner, and
    // somebody carrying your flag wins whatever else is happening.
    let score = 100 - d;
    if (other.carrying >= 0 && other.carrying === body.team) score += 200;
    if (other.lastHurtBy === body.index && state.tick - other.lastHurtAt < 180) score += 20;
    if (body.lastHurtBy === other.index && state.tick - body.lastHurtAt < 120) score += 40;
    if (score > bestScore) { bestScore = score; best = other.index; }
  }

  if (best >= 0) {
    ai.target = best;
    ai.seenAt = state.tick;
    const seen = state.bodies[best];
    ai.lastX = seen.x; ai.lastY = seen.y; ai.lastZ = seen.z;
  } else if (state.tick - ai.seenAt > 150) {
    ai.target = -1;
  }
}

// --- Where am I going --------------------------------------------------------

function pickGoal(state, body) {
  const ai = body.ai;
  const mode = MODES[state.config.mode];

  // Hysteresis, and it is not a nicety.
  //
  // The choice below is remade several times a second, and every one of the
  // things it weighs - how far away that gun is, how hurt I am, where the flag
  // is - changes as the bot moves. Remade from scratch each time it produced a
  // bot that set off for the rocket, turned at the armour, turned back at the
  // health, and crossed the same ten metres for four minutes. So a goal is kept
  // until it is reached, taken by somebody else, overtaken by something urgent,
  // or simply old.
  if (ai.goal && state.tick < ai.goalUntil && goalStillStands(state, body)) {
    followGoal(state, body);
    return;
  }

  let goal = null;
  let kind = '';

  if (mode.flags) {
    const mine = state.flags.find((f) => f.team === body.team);
    const theirs = state.flags.find((f) => f.team !== body.team);
    // Somebody on our side is carrying it. Everything else can wait: the run
    // home is the only thing on the board that scores, and a carrier crossing
    // the middle alone is a carrier who dies in the middle.
    const friend = state.bodies.find((b) => b.alive && b.team === body.team
      && b !== body && b.carrying >= 0);
    if (body.carrying >= 0) {
      // Carrying it: the stand, and nothing else matters - even when our own
      // flag is out and the capture will not count yet. Sending the carrier
      // after our flag instead sent it wherever the enemy who had it happened
      // to be, which was usually further into their own base, which is how a
      // carrier ends a run eight metres worse off than it started.
      goal = mine.home;
      kind = 'cap';
    } else if (friend) {
      goal = friend;
      kind = 'escort';
    } else if (mine && mine.status !== 'home') {
      // Ours is out. Everybody who is not already attacking goes and gets it.
      goal = mine;
      kind = 'recover';
    } else if (ai.role === 'defend' && !(theirs && theirs.status === 'carried')) {
      // A defender holds the ground in front of its base rather than standing
      // on the flag. Standing on the flag is stronger and it is why bot flag
      // matches used to finish nil-nil: an attacker that has crossed the map
      // arrives hurt, and a full-health defender on the stand beats it every
      // single time. Out here it can be gone round.
      goal = {
        x: mine.home.x * 0.4 + (nextRandom(state) - 0.5) * 16,
        y: mine.home.y,
        z: mine.home.z * 0.45,
      };
      kind = 'guard';
    } else {
      goal = theirs.status === 'home' ? theirs.home : theirs;
      kind = 'attack';
    }
  }

  // Wanting something more than the flag: being nearly dead, or having nothing
  // to shoot with. Both beat everything above - but the bar is lower for
  // somebody on a flag run, because a bot that breaks off at two thirds health
  // to fetch a medkit never arrives anywhere and the flag never moves.
  const onRun = mode.flags && (body.carrying >= 0 || ai.role === 'attack');
  const needHealth = body.health < (onRun ? 34 : 55);
  // Crossing the map with the gun you spawned with is how an attacker loses
  // every fight it has on the way. Anything better than the autogun counts as
  // being armed; until then, finding one is worth a detour.
  const needGun = !state.config.instagib && bestWeaponFor(body, 12) <= START_WEAPON;
  // Within sight of the thing it came for, nothing else is worth wanting.
  const nearlyThere = goal && onRun
    && (goal.x - body.x) ** 2 + (goal.z - body.z) ** 2 < 15 * 15;
  // One detour per run, and then it commits. Each detour is small and on the
  // way, but a bot allowed a new one every few seconds strings them together
  // into a random walk and never arrives - which is what forty per cent of an
  // attacker's life was going on.
  const shoppedRecently = mode.flags && state.tick - (ai.shoppedAt ?? -999) < 780;
  if (!nearlyThere && !shoppedRecently && (!mode.flags || needHealth || needGun)) {
    // In a flag match a detour has to be on the way: fourteen metres, not the
    // width of the map. Everywhere else, the best thing in the arena is worth
    // walking to.
    const item = wantedItem(state, body, needHealth, needGun,
      mode.flags ? 14 : 200, mode.flags ? goal : null);
    if (item) { goal = item; kind = 'item'; ai.goalItem = item; ai.shoppedAt = state.tick; }
  }

  if (!goal) {
    // Nothing to want: go where the map says the fighting is, with a wander so
    // that four bots with the same idea do not queue for it.
    const marks = state.map.marks;
    if (marks.length && nextRandom(state) < 0.6) {
      goal = marks[Math.floor(nextRandom(state) * marks.length) % marks.length];
    } else {
      const live = state.items.filter((i) => i.live);
      goal = live.length ? live[Math.floor(nextRandom(state) * live.length) % live.length] : null;
    }
    kind = 'roam';
  }
  if (!goal) return;

  ai.goalKind = kind;
  if (kind !== 'item') ai.goalItem = null;
  ai.carryWas = body.carrying;
  // Long enough to get somewhere, short enough that a plan made across the map
  // is reconsidered before it is stale.
  ai.goalUntil = state.tick + (kind === 'item' ? 300 : kind === 'roam' ? 420 : 900);
  ai.goal = { x: goal.x, y: goal.y, z: goal.z };
  repath(state, body);
  followGoal(state, body);
}

/** Is the plan still the plan? Asked every think, and cheap on purpose. */
function goalStillStands(state, body) {
  const ai = body.ai;
  if (ai.carryWas !== body.carrying) return false;
  if (ai.goalItem && !ai.goalItem.live) return false;
  if (ai.goalKind === 'escort' || ai.goalKind === 'recover' || ai.goalKind === 'guard') {
    const friend = state.bodies.find((b) => b.alive && b.team === body.team
      && b !== body && b.carrying >= 0);
    if (!!friend !== (ai.goalKind === 'escort')) return false;
  }
  if (body.health < 30 && ai.goalKind !== 'item') return false;
  const dx = ai.goal.x - body.x;
  const dz = ai.goal.z - body.z;
  if (dx * dx + dz * dz < 2.5 * 2.5) return false; // arrived: think again
  if (MODES[state.config.mode].flags) {
    const mine = state.flags.find((f) => f.team === body.team);
    if (mine && mine.status !== 'home' && ai.goalKind === 'guard') return false;
  }
  return true;
}

/**
 * Keep the plan pointed at the right place, and the route to it fresh.
 *
 * A flag being carried moves; the path to anything goes stale as the bot walks
 * it. Neither is a reason to reconsider what it is doing.
 */
function followGoal(state, body) {
  const ai = body.ai;
  const mode = MODES[state.config.mode];
  if (mode.flags && ai.goalKind === 'escort') {
    const friend = state.bodies.find((b) => b.alive && b.team === body.team
      && b !== body && b.carrying >= 0);
    if (!friend) { ai.goalUntil = -999; return; }
    ai.goal = { x: friend.x, y: friend.y, z: friend.z };
    if (state.tick - ai.repathAt > 24) repath(state, body);
    return;
  }
  if (mode.flags && (ai.goalKind === 'recover' || ai.goalKind === 'attack')) {
    const flag = state.flags.find((f) => (ai.goalKind === 'recover'
      ? f.team === body.team : f.team !== body.team));
    if (flag) {
      const at = flag.status === 'home' ? flag.home : flag;
      if (Math.abs(at.x - ai.goal.x) > 1.5 || Math.abs(at.z - ai.goal.z) > 1.5) {
        ai.goal = { x: at.x, y: at.y, z: at.z };
        repath(state, body);
        return;
      }
    }
  }
  const target = ai.target >= 0 ? state.bodies[ai.target] : null;
  ai.fighting = !!(target && target.alive && state.tick - ai.seenAt < 30);
  if (ai.path.length === 0 || state.tick - ai.repathAt > REPATH * (2 - body.skill.seek)) {
    repath(state, body);
  }
}

/**
 * The best thing worth walking to, if anything is.
 *
 * `along` is where the bot was already going, and if it is given, a detour has
 * to be nearly on the way there: going to the item and then on to the goal may
 * cost at most a few metres more than going straight. Without that test an
 * attacker in a flag match spends half its life shopping - which is what it did,
 * and why the flag never moved.
 */
function wantedItem(state, body, needHealth, needGun, maxRange = 200, along = null) {
  let best = null;
  let bestScore = -Infinity;
  for (const item of state.items) {
    if (!item.live) continue;
    let want = 0;
    if (item.type === 'health' || item.type === 'bighealth') {
      if (body.health >= 100) continue;
      want = (100 - body.health) * (item.type === 'bighealth' ? 0.9 : 0.6);
    } else if (item.type === 'armour') {
      if (body.armour >= 100) continue;
      want = 45 - body.armour * 0.4;
    } else if (item.type === 'weapon') {
      if (state.config.instagib) continue;
      want = body.have[item.weapon] ? 12 : 60;
      if (needGun) want += 60;
    } else {
      if (state.config.instagib) continue;
      const weapon = WEAPONS[item.weapon];
      if (!body.have[item.weapon] || body.ammo[item.weapon] >= weapon.maxAmmo) continue;
      want = 18;
    }
    if (needHealth && !(item.type === 'health' || item.type === 'bighealth')) want *= 0.3;
    const dx = item.x - body.x;
    const dy = item.y - body.y;
    const dz = item.z - body.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > maxRange) continue;
    if (along) {
      const straight = Math.sqrt((along.x - body.x) ** 2 + (along.z - body.z) ** 2);
      const onward = Math.sqrt((along.x - item.x) ** 2 + (along.z - item.z) ** 2);
      const detour = d + onward - straight;
      if (detour > (needHealth ? 18 : 9)) continue;
    }
    const score = want * body.skill.seek - d * 0.9;
    if (score > bestScore) { bestScore = score; best = item; }
  }
  return bestScore > 0 ? best : null;
}

function repath(state, body) {
  const ai = body.ai;
  ai.repathAt = state.tick;
  if (!ai.goal) return;
  // Generous about where "here" is. A body in the air is metres above the
  // nearest place it could stand, and asking for a node within five would fail
  // for the whole of every jump - leaving the bot with no path at all and
  // nothing to do but walk at the goal in a straight line, through whatever was
  // in the way. Bots jump a great deal.
  const from = nearestNode(state.nav, body.x, body.y, body.z, 11);
  const to = nearestNode(state.nav, ai.goal.x, ai.goal.y - 0.3, ai.goal.z, 6);
  const found = findPath(state.nav, from, to, scratchPath);
  if (found.length) {
    ai.path.length = 0;
    for (const id of found) ai.path.push(id);
    ai.step = 0;
  }
  // A search that found nothing leaves the last good path alone. It is out of
  // date rather than wrong, and it is better than no idea at all.
}

/** One shared buffer: findPath empties what it is given before it fills it. */
const scratchPath = [];

// --- What am I pressing ------------------------------------------------------

function drive(state, body, target) {
  const ai = body.ai;
  const nodes = state.nav.nodes;
  let wantX = 0;
  let wantZ = 0;
  let mask = 0;

  // Where the path says to go next.
  let needJump = false;
  while (ai.step < ai.path.length) {
    const node = nodes[ai.path[ai.step]];
    const dx = node.x - body.x;
    const dz = node.z - body.z;
    if (dx * dx + dz * dz < 1.1 * 1.1 && Math.abs(node.y - body.y) < 2.0) { ai.step++; continue; }
    wantX = dx;
    wantZ = dz;
    // The step before this one said how to get here. A crate is climbed by
    // jumping at it from close enough that the jump lands.
    if (ai.step > 0) {
      const from = nodes[ai.path[ai.step - 1]];
      const link = from.links.find((l) => l.to === node.id);
      if (link && link.kind === 'jump' && dx * dx + dz * dz < 2.6 * 2.6) needJump = true;
    }
    break;
  }
  if (ai.goal) {
    const gx = ai.goal.x - body.x;
    const gz = ai.goal.z - body.z;
    const gd2 = gx * gx + gz * gz;
    if (ai.step >= ai.path.length) {
      wantX = gx;
      wantZ = gz;
      if (state.tick - ai.repathAt > 20) repath(state, body);
    } else if (ai.step >= ai.path.length - 1 && gd2 < 36) {
      // On the last leg: walk at the thing itself rather than at the last
      // waypoint, which is a metre and a half of grid and can be a metre and a
      // half to the side of a flag you have to touch.
      //
      // Only on the last leg. Deciding it by how near the goal looked instead
      // put the bot in two minds every time it left the ground: the flag was
      // six metres away and a metre and a half up, so a bot mid-jump was told
      // to walk straight at it - into the side of the stand - and a bot on the
      // floor was told to go round by the ramp. It hopped on the spot, five
      // metres from the flag, for four minutes.
      wantX = gx;
      wantZ = gz;
    }
  }

  // The two wants are blended below, so they have to be the same size first.
  // Left as a raw difference, "go to the waypoint" was a metre long when the
  // waypoint was a metre away and twenty when it was twenty - so a bot near its
  // goal was overruled by the circling, and near its goal is exactly where it
  // needs to not be.
  const wantLen = Math.sqrt(wantX * wantX + wantZ * wantZ);
  if (wantLen > 0.001) { wantX /= wantLen; wantZ /= wantLen; }

  // Somebody off to one side, while you are on a flag run, is somebody to shoot
  // at rather than somebody to fight: the aim still follows them, but the feet
  // do not. Only an enemy roughly between the bot and where it is going is
  // worth changing course for.
  let inTheWay = true;
  if (target && (ai.goalKind === 'attack' || ai.goalKind === 'cap' || ai.goalKind === 'recover')
    && ai.goal) {
    const gx = ai.goal.x - body.x;
    const gz = ai.goal.z - body.z;
    const tx = target.x - body.x;
    const tz = target.z - body.z;
    const gl = Math.sqrt(gx * gx + gz * gz) || 1;
    const tl = Math.sqrt(tx * tx + tz * tz) || 1;
    inTheWay = (gx / gl) * (tx / tl) + (gz / gl) * (tz / tl) > 0.45 || tl < 6;
  }

  // In a fight, the path is advice and the fight is the instruction: hold the
  // range the gun in your hands wants, and circle.
  if (target) {
    const dx = target.x - body.x;
    const dz = target.z - body.z;
    const d = Math.sqrt(dx * dx + dz * dz) || 1;
    const weapon = WEAPONS[body.weapon];
    const [near, far] = weapon.aiRange;
    const want = clamp((near + far) * 0.35, 3, 22);
    let ax = 0;
    let az = 0;
    if (d < want * 0.7) { ax = -dx / d; az = -dz / d; } else if (d > want * 1.3) { ax = dx / d; az = dz / d; }
    if (state.tick - ai.strafeAt > 45 + Math.floor(nextRandom(state) * 60)) {
      ai.strafeAt = state.tick;
      ai.strafe = nextRandom(state) < 0.5 ? -1 : 1;
    }
    // Across the line to the target, which is the only movement that makes you
    // hard to hit.
    ax += (-dz / d) * ai.strafe * 1.1;
    az += (dx / d) * ai.strafe * 1.1;
    // How much of the fight is worth losing to pick something up. A gun eight
    // metres away is worth breaking off for; the same gun across the map is
    // not, and a bot that walks the length of the arena mid-fight is a bot
    // being shot in the back for the length of the arena.
    let toGoal = 0.35;
    // Carrying the flag, or on your way to it, the fight is in the way rather
    // than the point: keep running, and take the shots you are given.
    let dodge = 1;
    if (ai.goalKind === 'cap') {
      // Carrying it, the fight is not a consideration at all. Every fraction of
      // circling that survived here turned into a carrier who spent seven
      // seconds jinking about on the flag stand it had just robbed, which is
      // where all of them died.
      toGoal = 4.0;
      dodge = 0;
    } else if (ai.goalKind === 'escort') {
      // Near the carrier, turn and fight whatever is chasing it; far from it,
      // catch up.
      const gx = ai.goal ? ai.goal.x - body.x : 99;
      const gz = ai.goal ? ai.goal.z - body.z : 99;
      const far = gx * gx + gz * gz > 14 * 14;
      toGoal = far ? 2.4 : 0.5;
      dodge = far ? 0.4 : 1;
    } else if (ai.goalKind === 'attack' || ai.goalKind === 'recover') {
      const gx = ai.goal ? ai.goal.x - body.x : 99;
      const gz = ai.goal ? ai.goal.z - body.z : 99;
      const gd2 = gx * gx + gz * gz;
      // The closer it gets, the less it argues with itself. Inside eight
      // metres the fight stops being a reason to circle: touch the flag, and
      // deal with whoever is standing on it on the way back out.
      if (gd2 < 8 * 8) { toGoal = 4.0; dodge = 0.12; } else if (gd2 < 15 * 15) { toGoal = 3.4; dodge = 0.22; } else if (gd2 < 26 * 26) { toGoal = 2.6; dodge = 0.3; } else { toGoal = 2.0; dodge = 0.4; }
    }
    if (ai.goal && ai.goalKind !== 'guard') {
      const gx = ai.goal.x - body.x;
      const gz = ai.goal.z - body.z;
      const gd = Math.sqrt(gx * gx + gz * gz);
      if (gd < 11) toGoal = Math.max(toGoal, 1.6);
      else if (gd < 22) toGoal = Math.max(toGoal, 0.8);
    }
    const bias = (state.tick - ai.seenAt < 30 ? 1.6 : 0.5) * dodge * (inTheWay ? 1 : 0.15);
    wantX = wantX * toGoal + ax * bias;
    wantZ = wantZ * toGoal + az * bias;
  }

  const wl = Math.sqrt(wantX * wantX + wantZ * wantZ);
  if (wl > 0.001) {
    wantX /= wl;
    wantZ /= wl;
    // Turn the direction into buttons, using the same forward and right the
    // simulation walks along - see walkBasis in util.js. Having these the wrong
    // way round is a bot that strafes away from wherever it is trying to get to,
    // and it is very nearly invisible: with the goal ahead of it the forward
    // button dominates and it arrives anyway, only wobbling. It is in a fight,
    // when the aim is on the enemy and the movement is all sideways, that it
    // becomes a bot that cannot cross ten metres, and that is what it was.
    const basis = walkBasis(body.yaw, basisScratch);
    const along = wantX * basis.fx + wantZ * basis.fz;
    const across = wantX * basis.rx + wantZ * basis.rz;
    if (along > 0.35) mask |= BTN.FWD;
    else if (along < -0.35) mask |= BTN.BACK;
    if (across > 0.35) mask |= BTN.RIGHT;
    else if (across < -0.35) mask |= BTN.LEFT;
  }

  if (needJump && body.onGround) mask |= BTN.JUMP;

  // Stuck against something, or standing on a pad it wants to use, or just
  // making itself awkward to shoot at.
  const speed = Math.sqrt(body.vx * body.vx + body.vz * body.vz);
  if (body.onGround && mask && speed < 1.6 && state.tick - ai.jumpAt > 24) {
    ai.jumpAt = state.tick;
    mask |= BTN.JUMP;
    // Whatever it was walking into, walking into it again will not help.
    if (state.tick - ai.repathAt > 12) repath(state, body);
  } else if (target && body.onGround && body.carrying < 0 && state.tick - ai.jumpAt > 70
    && nextRandom(state) < 0.06 * body.skill.seek) {
    // Not while carrying the flag. In the air a body has almost no authority
    // over where it is going - that is the whole design of the movement - so a
    // carrier that jumps to look busy spends the next second travelling in
    // whatever direction it was already travelling, which after a fight on the
    // flag stand is usually further into the enemy base.
    ai.jumpAt = state.tick;
    mask |= BTN.JUMP;
  }
  return mask;
}

// --- Where am I looking ------------------------------------------------------

function aim(state, body, target, out) {
  const ai = body.ai;
  let tx;
  let ty;
  let tz;

  if (target) {
    const weapon = WEAPONS[body.weapon];
    const dx = target.x - body.x;
    const dy = target.y - body.y;
    const dz = target.z - body.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    // Lead the target by however long the shot takes to arrive. Hitscan takes
    // no time at all, so what is being led there is the bot's own reaction.
    const flight = weapon.kind === 'projectile' ? d / weapon.speed : body.skill.react / TICK_RATE;
    const lead = flight * body.skill.lead;
    tx = target.x + target.vx * lead;
    ty = target.y + target.vy * lead * 0.6 + P_HEIGHT * 0.55;
    tz = target.z + target.vz * lead;
    // A rocket is worth more at their feet than at their head, unless they are
    // in the air, in which case their feet are where they were.
    if (weapon.kind === 'projectile' && target.onGround && d > 6) ty = target.y + 0.35;
  } else if (ai.goal) {
    tx = ai.goal.x;
    ty = ai.goal.y + P_EYE;
    tz = ai.goal.z;
    const nodes = state.nav.nodes;
    if (ai.step < ai.path.length) {
      const node = nodes[ai.path[ai.step]];
      tx = node.x; ty = node.y + P_EYE; tz = node.z;
    }
  } else {
    return;
  }

  const dx = tx - body.x;
  const dy = ty - (body.y + P_EYE);
  const dz = tz - body.z;
  const flat = Math.sqrt(dx * dx + dz * dz);
  let wantYaw = atan2A(dz, dx);
  let wantPitch = atan2A(dy, flat);

  if (target) {
    // The error. Two draws rather than one, so a bot misses by a little far
    // more often than by a lot, and it is scaled by how far away the target is
    // because an angle is not a distance.
    const spread = body.skill.aim * (0.6 + Math.min(2.2, flat / 26));
    wantYaw += Math.round(randSpread(state) * spread * (YAW_UNITS / (Math.PI * 2)));
    wantPitch += Math.round(randSpread(state) * spread * 0.7 * (YAW_UNITS / (Math.PI * 2)));
  }

  const turn = TURN_RATE * (target ? 1 : 0.55);
  out.yaw = (body.yaw + clamp(angleDelta(body.yaw, wantYaw), -turn, turn)) & (YAW_UNITS - 1);
  out.pitch = clamp(body.pitch + clamp(angleDelta(body.pitch, wantPitch), -turn, turn), -15000, 15000);
  ai.aimYaw = wantYaw;
  ai.aimPitch = wantPitch;
}

// --- Pulling the trigger -----------------------------------------------------

function shoot(state, body, target, out) {
  if (!target || state.phase !== 'live') return 0;
  const weapon = WEAPONS[body.weapon];
  if (!(body.ammo[body.weapon] > 0)) return 0;

  const dx = target.x - body.x;
  const dy = (target.y + P_HEIGHT * 0.55) - (body.y + P_EYE);
  const dz = target.z - body.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d > weapon.aiRange[1] * 1.4) return 0;

  // Do not fire a rocket at somebody standing on top of you.
  if (weapon.kind === 'projectile' && d < 3.5 && body.health < 90) return 0;

  const wantYaw = atan2A(dz, dx);
  const wantPitch = atan2A(dy, Math.sqrt(dx * dx + dz * dz));
  const off = Math.abs(angleDelta(out.yaw, wantYaw)) + Math.abs(angleDelta(out.pitch, wantPitch));
  // Half a degree at fifty metres is a different thing from half a degree at
  // five, so the tolerance is an angle that grows as the target gets closer.
  // Half a metre at fifty is a different thing from half a metre at five, so the
  // tolerance is the angle a body's width subtends at this range. Through
  // util.js, like every other angle in here: Math.atan2 is allowed to differ in
  // the last bit between two engines, and this decides whether a shot is taken.
  const tolerance = atan2A(1.1, Math.max(2, d)) * 2;
  if (off > tolerance) return 0;
  if (!visible(state.world, body.x, body.y + P_EYE, body.z,
    target.x, target.y + P_HEIGHT * 0.55, target.z)) return 0;
  return BTN.FIRE;
}

// --- The gun in its hands ----------------------------------------------------

function pickWeapon(state, body, out) {
  if (state.config.instagib) { body.weapon = INSTA_WEAPON; return; }
  const target = body.ai.target >= 0 ? state.bodies[body.ai.target] : null;
  const d = target ? Math.sqrt((target.x - body.x) ** 2 + (target.z - body.z) ** 2) : 20;
  const want = bestWeaponFor(body, d);
  if (want >= 0 && want !== body.weapon) {
    body.weapon = want;
    body.spread = 0;
    body.switchAt = state.tick;
    state.events.push({ type: 'switch', body: body.index, weapon: want });
  }
}

/** The gun that is best at this distance, of the ones it is carrying. */
function bestWeaponFor(body, distance) {
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < WEAPONS.length; i++) {
    if (i === INSTA_WEAPON) continue;
    if (!body.have[i] || !(body.ammo[i] > 0)) continue;
    const weapon = WEAPONS[i];
    const [near, far] = weapon.aiRange;
    let score = weapon.aiSkill;
    if (distance < near) score *= 0.35;
    else if (distance > far) score *= 0.2;
    else score *= 1 + (WEAPONS[i].damage * (WEAPONS[i].pellets || 1)) / 120;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}
