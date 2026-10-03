import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameConfig, validateGameConfig, simulationRules } from '../../src/metafight/config.js';
import { SimulationClock } from '../../src/metafight/simulation-clock.js';
import { createProbe } from '../../src/metafight/probe-scene.js';
import { step } from '../../src/game/sim.js';
import { hashState } from '../../src/game/state.js';
import { BTN } from '../../src/constants.js';

test('PRD config survives JSON round trip, uses finite values, and is immutable', () => {
  const config = createGameConfig();
  assert.deepEqual(createGameConfig(JSON.parse(JSON.stringify(config))), config);
  for (const value of Object.values(config)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
  assert.equal(config.maxHp / config.bodyDamage, 4);
  assert.equal(config.maxHp / config.headDamage, 2);
  assert.equal(config.magazineSize, 30); assert.equal(config.reserveAmmo, 'unlimited');
  assert.equal(config.scoreLimit, 50); assert.equal(config.timeLimitSec, 300);
  assert.deepEqual(simulationRules(config), {
    bodyCount: 8, shotIntervalTicks: 6, reloadTicks: 120,
    respawnTicks: 180, protectionTicks: 120, timeLimitTicks: 18000,
  });
  assert.throws(() => { config.teamSize = 6; }, TypeError);
});

test('12 actors only allowed by explicit development fixture; inconsistent or corrupt config rejected', () => {
  const raw = { fixture: 'load-12', teamSize: 6, seed: -2147483648 };
  assert.equal(validateGameConfig(raw).ok, false);
  const config = createGameConfig(raw, { development: true });
  assert.equal(simulationRules(config, { development: true }).bodyCount, 12);
  raw.teamSize = 999; assert.equal(config.teamSize, 6);
  for (const value of [null, [], new Date(), { teamSize: 6 }, { fixture: 'load-12' },
    { mode: 'ctf' }, { bodyDamage: Infinity }, { seed: NaN }, { seed: 1.5 },
    { seed: 2147483648 }, { fixedHz: 30 }, { reloadSec: 0 }, { unknown: 1 },
    JSON.parse('{"__proto__":{"teamSize":6}}')]) {
    assert.equal(validateGameConfig(value, { development: true }).ok, false, JSON.stringify(value));
    assert.throws(() => createGameConfig(value, { development: true }), { code: 'INVALID_GAME_CONFIG' });
  }
});

function replay(frameMs, withPause = false) {
  const state = createProbe(42), clock = new SimulationClock();
  const simulate = () => step(state, [{ b: state.tick < 20 ? BTN.FWD : BTN.FIRE, yaw: 0, pitch: 0 }]);
  clock.resume(); clock.advance(0, simulate);
  let time = 0;
  for (let i = 1; i <= Math.round(5000 / frameMs); i++) {
    time = i * frameMs;
    clock.advance(time, simulate);
  }
  if (withPause) {
    clock.pause(); const before = hashState(state);
    clock.advance(time + 60000, simulate); assert.equal(hashState(state), before);
    clock.resume(); clock.advance(time + 60000, simulate); // establish new origin
    assert.equal(hashState(state), before);
  }
  return { state, clock };
}

test('real shared core reaches identical state at 30, 60 and 120 render FPS', () => {
  const runs = [30, 60, 120].map(fps => replay(1000 / fps));
  for (const run of runs) {
    assert.equal(run.clock.ticks, 300); assert.equal(run.clock.droppedMs, 0);
    assert.equal(hashState(run.state), hashState(runs[0].state));
    assert.ok(run.state.bodies[0].ammo[0] < 60); // existing M0.5 rules, not M1 rifle proof
  }
});

test('background pause discards elapsed wall time and resumes without replaying shots', () => {
  const a = replay(1000 / 60), b = replay(1000 / 60, true);
  assert.equal(hashState(a.state), hashState(b.state));
  const shotCount = b.state.bodies[0].ammo[0];
  b.clock.resume(); // repeated resume must not reset an active clock
  b.clock.advance(65000 + 1000 / 60, () => step(b.state, [{ b: 0, yaw: 0, pitch: 0 }]));
  assert.equal(b.clock.ticks, 301); assert.equal(b.state.bodies[0].ammo[0], shotCount);
});

test('stalls execute at most six steps, record discarded time, and retain fractional interpolation', () => {
  const clock = new SimulationClock(); let steps = 0;
  const simulate = () => steps++;
  clock.resume(); clock.advance(0, simulate);
  assert.equal(clock.advance(1005, simulate), 6); assert.equal(steps, 6);
  assert.ok(Math.abs(clock.droppedMs - 900) < 1e-6);
  assert.ok(Math.abs(clock.alpha - 0.3) < 1e-6);
  assert.equal(clock.advance(1005, simulate), 0);
  assert.equal(clock.advance(1000, simulate), 0);
  assert.equal(clock.advance(1017, simulate), 1);
  clock.reset(); assert.equal(clock.ticks, 0); assert.equal(clock.droppedMs, 0);
  assert.equal(clock.advance(2000, simulate), 0);
});

test('pause during a step stops remaining steps; simulation exceptions cannot leave clock running', () => {
  const clock = new SimulationClock(); clock.resume(); clock.advance(0, () => {});
  assert.equal(clock.advance(100, () => clock.pause()), 1);
  assert.equal(clock.running, false); assert.equal(clock.alpha, 0);
  clock.resume(); clock.advance(1000, () => {});
  assert.throws(() => clock.advance(1100, () => { throw new Error('core failed'); }), /core failed/);
  assert.equal(clock.running, false);
  assert.throws(() => clock.advance(NaN, () => {}));
  assert.throws(() => new SimulationClock({ fixedHz: 30 }));
  assert.throws(() => new SimulationClock({ maxSteps: 100 }));
});
