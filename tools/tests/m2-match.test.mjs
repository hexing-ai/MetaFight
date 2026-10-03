import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatMatch, stepCombatMatch } from '../../src/metafight/match.js';
import { combatInput } from '../../src/metafight/combat-ai.js';
import { createGameConfig } from '../../src/metafight/config.js';
import { hurt, step } from '../../src/game/sim.js';
import { BTN } from '../../src/constants.js';
import { visible } from '../../src/game/world.js';
import { SimulationClock } from '../../src/metafight/simulation-clock.js';
import { zipFiles } from '../zip.mjs';
import { createHash } from 'node:crypto';

function duel() {
  const s = createCombatMatch({ seed: 41 });
  for (const b of s.bodies) { b.human = true; b.shield = 0; b.alive = false; b.respawnAt = 999999; }
  Object.assign(s.bodies[0], { alive: true, x: -6, y: 0, z: 0, yaw: 0, pitch: 0 });
  Object.assign(s.bodies[1], { alive: true, x: 6, y: 0, z: 0, yaw: 32768, pitch: 0 });
  return s;
}
const fire = { b: BTN.FIRE };

test('default is 1 player and 7 real bots; candidate requires explicit development config', () => {
  const s = createCombatMatch();
  assert.equal(s.bodies.length, 8); assert.equal(s.bodies.filter(b => b.human).length, 1);
  assert.deepEqual([0, 1].map(t => s.bodies.filter(b => b.team === t).length), [4, 4]);
  assert.equal(s.clock, 18000); assert.equal(createCombatMatch({ candidate: true }).bodies.length, 12);
  assert.throws(() => createGameConfig({ fixture: 'match-12', teamSize: 6 }));
});
test('all opposing spawn candidates are screened, with no direct spawn-to-spawn sight', () => {
  const s = createCombatMatch();
  for (const a of s.map.spawns.filter(p => p.team === 0)) for (const b of s.map.spawns.filter(p => p.team === 1)) {
    assert.equal(visible(s.world, a.x, a.y + 1.62, a.z, b.x, b.y + 1.62, b.z), false);
  }
});
test('last-tick mutual kills reach 50 together, draw, and freeze dead actors without respawn', () => {
  const s = duel(); s.clock = 1; s.teamScore = [49, 49];
  for (const b of s.bodies.slice(0, 2)) { b.health = 50; b.kills = 49; }
  step(s, [fire, fire]);
  assert.deepEqual(s.teamScore, [50, 50]); assert.equal(s.result.winner, -1);
  assert.equal(s.result.reason, 'limit'); assert.equal(s.result.actors.length, 8);
  assert.equal(s.bodies[0].deaths, 1); assert.equal(s.bodies[1].deaths, 1);
  const snapshot = JSON.stringify(s);
  for (let i = 0; i < 300; i++) step(s, [fire, fire]);
  assert.equal(hurt(s, s.bodies[2], 1000, 0, 'test'), false);
  assert.equal(JSON.stringify(s), snapshot);
  assert.throws(() => { s.result.actors[0].kills = 999; });
});
test('score victory and time victory/draw use the final legal tick; void does not score', () => {
  for (const [scores, winner] of [[[4, 2], 0], [[2, 4], 1], [[4, 4], -1]]) {
    const s = duel(); s.teamScore = scores; s.clock = 1; step(s, []);
    assert.equal(s.result.winner, winner); assert.equal(s.result.reason, 'time');
  }
  const s = duel(); s.teamScore = [49, 0]; s.bodies[0].kills = 49; s.bodies[1].health = 50;
  step(s, [fire]); assert.equal(s.result.winner, 0); assert.equal(s.result.reason, 'limit');
  const v = duel(); hurt(v, v.bodies[0], 1000, -1, 'void');
  assert.deepEqual(v.teamScore, [0, 0]); assert.equal(v.bodies[0].deaths, 1);
});
test('a due respawn is deferred until after the end decision', () => {
  for (const ending of [true, false]) {
    const s = duel(), dead = s.bodies[2];
    dead.respawnAt = 1; dead.respawnIn = 1; s.clock = ending ? 1 : 2;
    step(s);
    assert.equal(dead.alive, !ending);
    assert.equal(s.events.some(e => e.type === 'spawn' && e.body === 2), !ending);
  }
});
test('result contains all actors, stable per-team ranking, and exact score sums', () => {
  const s = duel(); s.clock = 1;
  s.bodies[2].kills = 3; s.bodies[4].kills = 3; s.bodies[2].deaths = 2;
  s.bodies[4].deaths = 1; s.bodies[6].kills = 3; s.bodies[6].deaths = 1; s.teamScore[0] = 9;
  step(s); assert.deepEqual(s.result.actors.filter(b => b.team === 0).map(b => b.index), [4, 6, 2, 0]);
  for (const t of [0, 1]) assert.equal(s.result.actors.filter(b => b.team === t).reduce((a, b) => a + b.kills, 0), s.result.scores[t]);
});
test('AI waits 48-72 ticks after sight, loses hidden target and searches only remembered coordinates', () => {
  const s = duel(), bot = s.bodies[0], enemy = s.bodies[1];
  const first = combatInput(s, bot); assert.equal(first.b & BTN.FIRE, 0);
  const deadline = bot.combat.reactAt; assert.ok(deadline >= 48 && deadline <= 72);
  for (s.tick = 1; s.tick < deadline; s.tick++) assert.equal(combatInput(s, bot).b & BTN.FIRE, 0);
  assert.ok(combatInput(s, bot).b & BTN.FIRE);
  const known = { ...bot.combat.lastKnown }; enemy.x = 6; enemy.z = 5;
  assert.equal(visible(s.world, bot.x, bot.y + 1.62, bot.z, enemy.x, 1.1, enemy.z), false);
  s.tick++; assert.equal(combatInput(s, bot).b & BTN.FIRE, 0);
  assert.equal(bot.combat.target, -1); assert.deepEqual(bot.combat.lastKnown, known);
  enemy.x = 8; s.tick++; combatInput(s, bot); assert.deepEqual(bot.combat.lastKnown, known);
  enemy.x = 6; enemy.z = 0; s.tick++; combatInput(s, bot); assert.ok(bot.combat.reactAt >= s.tick + 48);
});
test('unseen enemy is not acquired; hearing stores a position snapshot; bots reload via shared input', () => {
  const s = duel(), bot = s.bodies[0], enemy = s.bodies[1]; enemy.z = 5;
  combatInput(s, bot); assert.equal(bot.combat.target, -1);
  s.heardShots = [{ x: 7, y: 0, z: 5, team: 1 }]; s.tick++;
  combatInput(s, bot); assert.deepEqual(bot.combat.lastKnown, { x: 7, y: 0, z: 5 });
  s.heardShots = []; enemy.x = 9; s.tick++; combatInput(s, bot);
  assert.deepEqual(bot.combat.lastKnown, { x: 7, y: 0, z: 5 });
  bot.ammo[0] = 0; bot.human = false; step(s); const end = bot.reloadUntil;
  assert.equal(end, s.tick + 120);
  while (s.tick < end) step(s);
  assert.equal(bot.ammo[0], 30); assert.equal(bot.reloadUntil, 0);
});
test('both bot teams fire real three-shot bursts, rest, reload and reacquire after respawn', () => {
  for (const index of [0, 1]) {
    const s = duel(), bot = s.bodies[index], target = s.bodies[1-index];
    target.health = 100000;
    const shots = [];
    while (shots.length < 33 && s.tick < 3000) {
      const input = combatInput(s, bot); input.b &= BTN.FIRE | BTN.RELOAD;
      const inputs = [{ b: 0 }, { b: 0 }]; inputs[index] = input;
      step(s, inputs);
      if (s.events.some(e => e.type === 'fire' && e.body === index)) shots.push(s.tick);
    }
    assert.equal(shots.length, 33);
    for (let i=1;i<shots.length;i++) {
      if (i%3===0) assert.ok(shots[i]-shots[i-1]>=42, 'three shots must be followed by a rest');
      else assert.equal(shots[i]-shots[i-1],6, 'burst uses the shared 600RPM weapon');
    }
    assert.ok(shots[30]-shots[29]>=120, 'empty magazine still requires the shared reload');
    bot.lifeId++; bot.ammo[0]=30;
    assert.equal(combatInput(s,bot).b & BTN.FIRE,0);
    assert.ok(bot.combat.reactAt>=s.tick+48, 'new life reacquires instead of inheriting a ready trigger');
  }
});
test('burst rest survives switching to a newly visible target', () => {
  const s=duel(), bot=s.bodies[0];combatInput(s,bot);
  bot.combat.nextBurstAt=300;
  s.bodies[1].alive=false;
  Object.assign(s.bodies[3],{alive:true,x:5,y:0,z:0,shield:0});
  s.tick=100;combatInput(s,bot);
  s.tick=bot.combat.reactAt;
  assert.equal(combatInput(s,bot).b & BTN.FIRE,0);
  assert.equal(bot.combat.nextBurstAt,300);
});
test('paused simulation clock freezes match and respawn; a new session has no previous state', () => {
  const s = duel(); hurt(s, s.bodies[0], 1000, -1, 'void');
  const clock = new SimulationClock(); const before = JSON.stringify(s);
  clock.advance(60000, () => stepCombatMatch(s)); assert.equal(JSON.stringify(s), before);
  const fresh = createCombatMatch(); assert.equal(fresh.clock, 18000); assert.equal(fresh.result, null);
  for (const b of fresh.bodies) { assert.equal(b.kills, 0); assert.equal(b.deaths, 0); assert.equal(b.ammo[0], 30); assert.equal(b.combat, undefined); }
});
test('10 seeds finish complete 4v4 games with actual shots and no unresolved five-second bot idle', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const s = createCombatMatch({ seed });
    while (s.phase !== 'over' && s.tick <= 18000) stepCombatMatch(s);
    assert.equal(s.phase, 'over'); assert.ok(s.matchStats.shots > 0);
    assert.ok(s.teamScore[0] + s.teamScore[1] > 0);
    for (const b of s.matchStats.bots.slice(1)) { assert.ok(b.movedMetres > 1); assert.ok(b.maxIdleTicks < 300, `seed ${seed} bot ${b.id}: ${b.maxIdleTicks}`); }
    for (const t of [0, 1]) assert.equal(s.bodies.filter(b => b.team === t).reduce((a, b) => a + b.kills, 0), s.teamScore[t]);
    assert.ok(!s.events.some(e => e.type === 'unwedge'));
  }
});
test('candidate 6v6 completes with real AI and same seeds replay deterministically', () => {
  const run = () => { const s = createCombatMatch({ candidate: true, seed: 3 }); while (s.phase !== 'over') stepCombatMatch(s); return JSON.stringify({ result: s.result, stats: s.matchStats }); };
  assert.equal(run(), run());
});
test('ZIP_STORED reproduces a Python zipfile oracle without local artifact dependencies', () => {
  const zip = zipFiles([['app.js', Buffer.from('console.log(1);')], ['index.html', Buffer.from('<h1>test</h1>')]]);
  assert.equal(createHash('sha256').update(zip).digest('hex'), 'f4679f799b5db10a428da06cde7c2e317189c7da6c5ba337404ad0caf60ac817');
});
