import test from 'node:test';
import assert from 'node:assert/strict';
import { createPractice, stepPractice, aimSlowdown } from '../../src/metafight/practice.js';
import { hurt, step } from '../../src/game/sim.js';
import { nearestNode, findPath } from '../../src/game/nav.js';
import { boxBlocked, traceRay } from '../../src/game/world.js';
import { BTN } from '../../src/constants.js';
import { hashState } from '../../src/game/state.js';
import { SimulationClock } from '../../src/metafight/simulation-clock.js';
import { ProbeInput } from '../../src/metafight/probe-input.js';

function fixture() {
  const s = createPractice();
  s.bodies.forEach((b, i) => { b.shield = 0; if (i > 1) { b.x = -21; b.z = -8 + i * 2; } });
  return s;
}
const shot = (s, pitch = 0) => step(s, [{ b: BTN.FIRE, yaw: 0, pitch }]);
const idle = (s, n) => { for (let i = 0; i < n; i++) step(s, [{ b: 0, yaw: 0, pitch: 0 }]); };

test('reload/jump edges are consumed once and cleared by pause/death input reset', () => {
  const input = new ProbeInput(); input.enabled = true;
  input.action(BTN.RELOAD | BTN.JUMP);
  assert.equal(input.read().b, BTN.RELOAD | BTN.JUMP);
  assert.equal(input.read().b, 0);
  input.action(BTN.RELOAD); input.clear(); assert.equal(input.read().b, 0);
  input.enabled = false; input.action(BTN.JUMP); assert.equal(input.read().b, 0);
});

test('cargo spawns are free and all three lanes connect both spawn zones', () => {
  const s = createPractice();
  for (const p of s.map.spawns) {
    assert.equal(boxBlocked(s.world, p.x - .42, .05, p.z - .42, p.x + .42, 1.8, p.z + .42), null);
    const a = nearestNode(s.nav, p.x, p.y, p.z);
    for (const z of [-9, 0, 9]) {
      const b = nearestNode(s.nav, 0, 0, z);
      assert.ok(findPath(s.nav, a, b).length > 0, JSON.stringify({ p, z }));
    }
  }
  assert.ok(traceRay(s.world, -21, 1.62, 0, 1, 0, 0, 42).dist < 5);
});

test('two head hits or four torso hits kill 100HP through the shared ray/damage core', () => {
  for (const [pitch, damage, count] of [[0, 50, 2], [-650, 25, 4]]) {
    const s = fixture();
    for (let i = 0; i < count; i++) {
      shot(s, pitch);
      assert.equal(s.bodies[1].health, Math.max(0, 100 - damage * (i + 1)));
      if (i < count - 1) idle(s, 5);
    }
    assert.equal(s.bodies[1].deaths, 1); assert.equal(s.teamScore[0], 1);
    assert.equal(hurt(s, s.bodies[1], 50, 0, 'mg'), false);
    assert.equal(s.bodies[1].deaths, 1);
  }
});

test('friendly bodies, spawn protection, and cargo walls block shots', () => {
  const s = fixture(), friend = s.bodies[2];
  friend.x = -10; friend.z = 0; friend.y = 0;
  shot(s); assert.equal(friend.health, 100); assert.equal(s.bodies[1].health, 100);
  friend.z = 8; s.bodies[1].shield = 120; idle(s, 5); shot(s);
  assert.equal(s.bodies[1].health, 100);
  s.bodies[1].shield = 0; s.bodies[0].z = 5; s.bodies[1].z = 5;
  idle(s, 5); shot(s); assert.equal(s.bodies[1].health, 100);
});

test('600RPM, 30-round magazine, no empty-shot events, exact two-second reload', () => {
  const s = fixture(); const ticks = [];
  s.bodies[1].z = 10;
  for (let i = 0; i < 240; i++) {
    shot(s); if (s.events.some(e => e.type === 'fire' && e.body === 0)) ticks.push(s.tick);
  }
  assert.equal(ticks.length, 30);
  assert.ok(ticks.slice(1).every((t, i) => t - ticks[i] === 6));
  assert.equal(s.bodies[0].ammo[0], 0);
  const end = s.bodies[0].reloadUntil;
  assert.equal(end, ticks[29] + 120, 'last shot starts automatic reload immediately');
  while (s.tick < end - 1) { shot(s); assert.equal(s.bodies[0].ammo[0], 0); }
  idle(s, 1); assert.equal(s.bodies[0].ammo[0], 30);
  step(s, [{ b: BTN.RELOAD }]); assert.equal(s.bodies[0].reloadUntil, 0);
});

test('held fire cycles multiple magazines with one automatic reload per magazine', () => {
  const s = fixture(), me = s.bodies[0], shots = [], reloads = [], completed = [];
  s.bodies[1].z = 10;
  for (let i = 0; i < 600; i++) {
    shot(s);
    for (const e of s.events.filter(e => e.body === 0)) {
      if (e.type === 'fire') shots.push(s.tick);
      if (e.type === 'reload') reloads.push(s.tick);
      if (e.type === 'reload-complete') completed.push(s.tick);
    }
    assert.ok(me.ammo[0] >= 0 && me.ammo[0] <= 30);
  }
  assert.ok(shots.length > 60, 'held fire resumes after both reloads');
  assert.deepEqual(reloads, [shots[29], shots[59]]);
  assert.deepEqual(completed, reloads.map(t => t + 120));
  shots.slice(1).forEach((t, i) => assert.equal(t - shots[i], (i + 1) % 30 === 0 ? 120 : 6));
});

test('automatic reload finishes without firing; repeated reload input cannot extend it; manual top-up remains available', () => {
  const s = fixture(), me = s.bodies[0]; me.ammo[0] = 1;
  shot(s); const end = me.reloadUntil;
  assert.equal(end, s.tick + 120);
  while (s.tick < end - 1) {
    step(s, [{ b: s.tick % 2 ? BTN.RELOAD : 0 }]);
    assert.equal(me.reloadUntil, end);
    assert.equal(me.ammo[0], 0);
    assert.equal(s.events.some(e => e.body === 0 && ['fire', 'reload'].includes(e.type)), false);
  }
  idle(s, 1); assert.equal(me.ammo[0], 30); assert.equal(me.reloadUntil, 0);
  assert.equal(s.events.some(e => e.type === 'fire' && e.body === 0), false);
  shot(s); step(s, [{ b: BTN.RELOAD }]);
  assert.equal(me.ammo[0], 29); assert.equal(me.reloadUntil, s.tick + 120);
});

test('death cancels reload; respawn is 180 ticks, full magazine and protected for 120 ticks', () => {
  const s = fixture(), me = s.bodies[0];
  me.ammo[0] = 1; shot(s); assert.ok(me.reloadUntil);
  hurt(s, me, 1000, -1, 'void'); assert.equal(me.reloadUntil, 0);
  const score = [...s.teamScore]; idle(s, 179); assert.equal(me.alive, false);
  idle(s, 1); assert.equal(me.alive, true); assert.equal(me.ammo[0], 30); assert.equal(me.health, 100);
  assert.equal(me.shield, 120); assert.deepEqual(s.teamScore, score);
  for (let i = 0; i < 10; i++) step(s, [{ b: BTN.FWD }]);
  assert.equal(me.shield, 110); // moving never cancels product protection
  me.cooldown = 3; shot(s); assert.equal(me.shield, 109);
  idle(s, 2); shot(s); assert.equal(me.shield, 0);
});

test('pause freezes live reload and no match limits end the development practice', () => {
  const s = fixture(), c = new SimulationClock();
  s.bodies[0].ammo[0] = 1; shot(s); const remaining = s.bodies[0].reloadUntil - s.tick;
  c.advance(60000, () => stepPractice(s, { b: 0 }));
  assert.equal(s.bodies[0].reloadUntil - s.tick, remaining);
  s.clock = 1; s.teamScore[0] = 999; idle(s, 3); assert.equal(s.phase, 'live');
});

test('aim assist slows only visible enemies and leaves view untouched', () => {
  const s = fixture(), before = hashState(s);
  assert.equal(aimSlowdown(s, 0, 0, true), .75);
  assert.equal(aimSlowdown(s, 0, 0, false), 1); assert.equal(hashState(s), before);
  s.bodies[1].z = 5; s.bodies[0].z = 5;
  assert.equal(aimSlowdown(s, 0, 0, true), 1);
});

test('8/12 actor fixtures execute real movement, path queries and shots deterministically', () => {
  for (const [fixtureName, count] of [['load-8', 8], ['load-12', 12]]) {
    const states = [createPractice(fixtureName, 42), createPractice(fixtureName, 42)];
    for (const s of states) {
      assert.equal(s.bodies.length, count);
      for (let i = 0; i < 1800; i++) stepPractice(s, { b: 0, yaw: 0, pitch: 0 });
      assert.ok(s.workload.navigationQueries > count * 5);
      assert.ok(s.workload.shots > count * 10);
      assert.ok(s.workload.movedMetres > count * 10);
    }
    assert.equal(hashState(states[0]), hashState(states[1]));
    assert.deepEqual(states[0].workload, states[1].workload);
  }
});
