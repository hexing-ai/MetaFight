// Plays the game, headlessly, and checks that it is still the game.
//
//   node tools/simtest.js
//
// The simulation has no DOM, no clock and no randomness that does not come out
// of its own seed, which means a match can be played to the last frag in a
// couple of hundred milliseconds and the answer is the same every time. That is
// the whole reason the code is arranged the way it is, and this file is what it
// buys: every arena, every mode, both rule sets, checked in the time it takes to
// alt-tab.
//
// What it is looking for is not "did anybody win". It is the small permanent
// truths: nobody is inside a wall, nobody is under the floor, health is between
// nought and a hundred, a flag is either home or being carried or lying
// somewhere a body could reach, and two machines given the same seed agree about
// all of it down to the last bit.

import { createMatch, hashState, standings } from '../src/game/state.js';
import { step } from '../src/game/sim.js';
import { boxBlocked } from '../src/game/world.js';
import { MAPS, loadMap } from '../src/game/maps.js';
import {
  MAX_ARMOUR, MAX_HEALTH, MODES, P_HEIGHT, P_RADIUS, TICK_RATE, WEAPONS,
} from '../src/constants.js';

let failures = 0;
const fail = (what) => {
  console.error(`  ✗ ${what}`);
  failures++;
};
const ok = (line) => console.log(`  ${line}`);

/** Run a match, watching everything that should never happen. */
function play(opts, ticks) {
  const state = createMatch({ humans: [false], ...opts });
  const counts = {};
  const seen = { belowVoid: 0, inWall: 0, badHealth: 0, badArmour: 0, ghostAmmo: 0 };
  const scratch = [];

  for (let t = 0; t < ticks; t++) {
    step(state);
    for (const e of state.events) counts[e.type] = (counts[e.type] || 0) + 1;

    for (const body of state.bodies) {
      if (!body.alive) continue;
      if (body.y < state.map.void) seen.belowVoid++;
      if (body.health > MAX_HEALTH || body.health < 0) seen.badHealth++;
      if (body.armour > MAX_ARMOUR || body.armour < 0) seen.badArmour++;
      for (let w = 0; w < WEAPONS.length; w++) {
        if (body.ammo[w] < 0) seen.ghostAmmo++;
      }
      // Checked every twentieth tick: it is the expensive one, and a body wedged
      // in a wall stays wedged for a great deal longer than a third of a second.
      if (t % 20 === 0 && boxBlocked(state.world, body.x - P_RADIUS, body.y + 0.02,
        body.z - P_RADIUS, body.x + P_RADIUS, body.y + P_HEIGHT, body.z + P_RADIUS, scratch)) {
        seen.inWall++;
      }
    }
    if (state.phase === 'over' && state.phaseTimer <= 0) break;
  }
  return { state, counts, seen };
}

function checkRun(name, run) {
  const { state, seen } = run;
  if (seen.belowVoid) fail(`${name}: somebody was below the floor of the world ${seen.belowVoid} times`);
  if (seen.inWall) fail(`${name}: somebody was inside the geometry ${seen.inWall} times`);
  if (seen.badHealth) fail(`${name}: health went outside 0..100`);
  if (seen.badArmour) fail(`${name}: armour went outside 0..100`);
  if (seen.ghostAmmo) fail(`${name}: ammunition went negative`);

  // Scores have to add up: in a free for all every frag is somebody's kill, and
  // every death is somebody's.
  const kills = state.bodies.reduce((a, b) => a + b.kills, 0);
  const deaths = state.bodies.reduce((a, b) => a + b.deaths, 0);
  if (kills > deaths) fail(`${name}: ${kills} kills but only ${deaths} deaths`);
}

console.log('\nA match in every arena, in every mode it supports:');
for (const def of MAPS) {
  for (const mode of ['dm', 'tdm', 'ctf']) {
    if (mode === 'ctf' ? !loadMap(def.key).flagMap : !def.modes.includes(mode)) continue;
    const run = play({ map: def.key, mode, bots: 5, seed: 4242, limit: mode === 'ctf' ? 2 : 12 },
      TICK_RATE * 200);
    checkRun(`${def.key}/${mode}`, run);
    const { state, counts } = run;
    ok(`${def.key.padEnd(9)} ${mode.padEnd(4)} `
      + `${String(Math.round(state.tick / TICK_RATE)).padStart(3)}s  `
      + `${String(state.bodies.reduce((a, b) => a + b.kills, 0)).padStart(3)} frags  `
      + `${String(counts.pickup || 0).padStart(3)} pickups  `
      + `${String(counts.explode || 0).padStart(3)} explosions  `
      + (MODES[mode].flags ? `${counts.capture || 0} captures  ` : '')
      + `${state.phase}`);
  }
}

console.log('\nInstagib, where every shot that lands is a frag:');
for (const key of ['cistern', 'overlook', 'sluice']) {
  const mode = loadMap(key).flagMap ? 'ctf' : 'dm';
  const run = play({ map: key, mode, instagib: true, bots: 5, seed: 77, limit: 10 }, TICK_RATE * 120);
  checkRun(`${key}/instagib`, run);
  const { state, counts } = run;
  const hits = counts.hit || 0;
  const deaths = state.bodies.reduce((a, b) => a + b.deaths, 0);
  if (hits && deaths < hits) fail(`instagib on ${key}: ${hits} hits but only ${deaths} deaths`);
  if (counts.pickup) fail(`instagib on ${key}: something was picked up, and nothing should be`);
  ok(`${key.padEnd(9)} ${hits} hits, ${deaths} deaths, ${state.bodies.reduce((a, b) => a + b.kills, 0)} frags`);
}

console.log('\nThe same seed, twice:');
for (const [map, mode] of [['foundry', 'dm'], ['bastion', 'ctf'], ['cistern', 'tdm']]) {
  const a = play({ map, mode, bots: 6, seed: 31337 }, 2400).state;
  const b = play({ map, mode, bots: 6, seed: 31337 }, 2400).state;
  if (hashState(a) !== hashState(b)) fail(`${map}/${mode} did not replay identically`);
  else ok(`${map.padEnd(9)} ${mode.padEnd(4)} identical after 40 seconds (${hashState(a)})`);
}

console.log('\nA different seed is a different match:');
{
  const a = play({ map: 'foundry', mode: 'dm', bots: 6, seed: 1 }, 1800).state;
  const b = play({ map: 'foundry', mode: 'dm', bots: 6, seed: 2 }, 1800).state;
  if (hashState(a) === hashState(b)) fail('two seeds produced the same match, which cannot be right');
  else ok('two seeds, two matches');
}

console.log('\nThe rules that are easy to break by accident:');
{
  // A rocket at your own feet should hurt and should throw you.
  const state = createMatch({ humans: [true], bots: 1, map: 'foundry', mode: 'dm', seed: 5 });
  const me = state.bodies[0];
  me.have[2] = true;
  me.ammo[2] = 10;
  me.weapon = 2;
  me.x = 0; me.y = 0.1; me.z = 14; me.vy = 0;
  me.pitch = -14000; // most of the way down
  const before = me.health;
  for (let i = 0; i < 40; i++) step(state, [{ b: 32, yaw: me.yaw, pitch: me.pitch }]);
  if (me.health >= before) fail('a rocket fired at your own feet did nothing');
  else if (me.y <= 0.2 && me.vy <= 0) fail('a rocket at your own feet did not throw you');
  else ok(`a rocket jump costs ${before - me.health} health and gets you off the ground`);
}
{
  // Nobody may shoot a team mate.
  const state = createMatch({ humans: [true], bots: 3, map: 'foundry', mode: 'tdm', seed: 5 });
  const me = state.bodies[0];
  const mate = state.bodies.find((b) => b.team === me.team && b !== me);
  if (!mate) fail('a team match with only one player on a team');
  else {
    mate.x = me.x + 6; mate.y = me.y; mate.z = me.z;
    me.yaw = 0; me.pitch = 0; me.shield = 0; mate.shield = 0;
    // Point at them and hold the trigger down for a second.
    const dx = mate.x - me.x;
    const dz = mate.z - me.z;
    me.yaw = Math.round((Math.atan2(dz, dx) / (Math.PI * 2)) * 65536);
    const before = mate.health;
    for (let i = 0; i < 60; i++) step(state, [{ b: 32, yaw: me.yaw, pitch: 0 }]);
    if (mate.health < before) fail('friendly fire hurt a team mate');
    else ok('a team mate cannot be shot');
  }
}
{
  // A flag taken and carried home is a capture.
  const state = createMatch({ humans: [true], bots: 1, map: 'sluice', mode: 'ctf', seed: 5 });
  const me = state.bodies[0];
  const theirs = state.flags.find((f) => f.team !== me.team);
  const mine = state.flags.find((f) => f.team === me.team);
  me.x = theirs.x; me.y = theirs.y - 0.4; me.z = theirs.z;
  step(state);
  if (me.carrying < 0) fail('standing on the enemy flag did not pick it up');
  me.x = mine.home.x; me.y = mine.home.y - 0.4; me.z = mine.home.z;
  step(state);
  if (state.teamScore[me.team] !== 1) fail('carrying it home did not score');
  else ok('take it, carry it home, one point');

  // And with your own flag away from its stand, it is not a capture.
  const other = createMatch({ humans: [true], bots: 1, map: 'sluice', mode: 'ctf', seed: 6 });
  const you = other.bodies[0];
  const away = other.flags.find((f) => f.team === you.team);
  const target = other.flags.find((f) => f.team !== you.team);
  away.status = 'dropped';
  away.x = away.home.x + 12;
  away.timer = 9000;
  you.x = target.x; you.y = target.y - 0.4; you.z = target.z;
  step(other);
  you.x = away.home.x; you.y = away.home.y - 0.4; you.z = away.home.z;
  step(other);
  if (other.teamScore[you.team] !== 0) fail('scored with our own flag off its stand');
  else ok('and no point at all while your own flag is out');
}
{
  // An item picked up comes back, and not before it should.
  const state = createMatch({ humans: [true], bots: 1, map: 'foundry', mode: 'dm', seed: 9 });
  const me = state.bodies[0];
  // The other body is put out of the way: this is about the item, not a race
  // for it.
  state.bodies[1].alive = false;
  state.bodies[1].respawnIn = 1e9;
  const item = state.items.find((i) => i.type === 'armour');
  me.x = item.x; me.y = item.y - 0.4; me.z = item.z;
  step(state);
  if (item.live) fail('walking onto the armour did not pick it up');
  const gained = me.armour;
  if (gained <= 0) fail('the armour gave no armour');
  // Full up, so the one that comes back is left where it is rather than taken
  // again on the frame it appears.
  me.armour = MAX_ARMOUR;
  const wait = item.timer;
  for (let i = 0; i < wait - 2; i++) step(state);
  if (item.live) fail('the armour came back early');
  for (let i = 0; i < 4; i++) step(state);
  if (!item.live) fail('the armour never came back');
  else ok(`the armour is worth ${gained} and takes ${Math.round(wait / TICK_RATE)}s to return`);
}
{
  // A match ends when somebody reaches the limit, and not after.
  const run = play({ map: 'cistern', mode: 'dm', bots: 5, seed: 12, limit: 5 }, TICK_RATE * 400);
  const top = standings(run.state)[0];
  if (run.state.phase !== 'over') fail('a match to five frags never ended');
  else if (top.score < 5) fail(`the match ended with the leader on ${top.score}`);
  else ok(`first to five ends it: ${top.name} on ${top.score} after ${Math.round(run.state.tick / TICK_RATE)}s`);
}

console.log('\nHow long it takes:');
{
  const t0 = Date.now();
  play({ map: 'bastion', mode: 'ctf', bots: 7, seed: 3 }, TICK_RATE * 120);
  const ms = Date.now() - t0;
  ok(`two minutes of eight bodies in ${ms} ms - ${(ms / (TICK_RATE * 120)).toFixed(3)} ms a tick`);
  if (ms > TICK_RATE * 120 * 2) fail('the simulation is slower than a fiftieth of real time');
}

if (failures) {
  console.error(`\n${failures} thing${failures === 1 ? '' : 's'} wrong.`);
  process.exit(1);
}
console.log('\nThe simulation is behaving itself.');
