import test from 'node:test';
import assert from 'node:assert/strict';
import { PerformanceRun } from '../../src/metafight/performance.js';
const low = { teamSize: 4, preferred: 'low', effective: 'low', degradeLevel: 0, scale: 1 };
function run() { const r = new PerformanceRun(); r.reset(0); r.configure(low, 0); r.phaseTo('PLAYING', 0); return r; }
function advance(r, start, end, step = 20) { for (let t = start; t <= end; t += step) r.frame(t); }

test('real intervals exclude 120-second warmup, first frame and background; never synthesize 60fps', () => {
  const r = run(); advance(r, 0, 120000); assert.equal(r.snapshot(120000).groups[0].frames, 0);
  advance(r, 120020, 120200); let s = r.snapshot(120200); assert.equal(s.groups[0].frames, 10);
  assert.equal(s.groups[0].averageFps, 50); assert.equal(s.groups[0].p95UpperMs, 20);
  r.phaseTo('BACKGROUND', 120200); r.frame(500000); r.phaseTo('PAUSED', 500000); r.phaseTo('PLAYING', 500100);
  r.frame(500100); r.frame(500120); s = r.snapshot(500120);
  assert.equal(s.groups[0].frames, 11); assert.equal(s.phaseMs.BACKGROUND, 379800);
  assert.equal(s.groups[0].maxFrameMs, 20);
});

test('slow intervals retain overflow and dropped time, with no false finite P95', () => {
  const r = run(); advance(r, 0, 120000); r.frame(121000, 900);
  const g = r.snapshot(121000).groups[0]; assert.equal(g.averageFps, 1);
  assert.equal(g.p95UpperMs, null); assert.equal(g.p95Overflow, true); assert.equal(g.histogram[51], 1);
  assert.equal(g.droppedSimulationMs, 900); assert.equal(g.maxFrameMs, 1000);
});

test('quality and team-size groups are separated; respawn and new matches accumulate', () => {
  const r = run(); advance(r, 0, 120200); r.phaseTo('RESPAWNING', 120200); r.frame(120220);
  r.phaseTo('RESULT', 120220); r.phaseTo('PLAYING', 121000); r.frame(121000); r.frame(121020);
  r.configure({ ...low, preferred: 'medium', effective: 'medium' }, 121020); r.frame(121020); r.frame(121040);
  r.configure({ ...low, teamSize: 6 }, 121040); r.frame(121040); r.frame(121060);
  const s = r.snapshot(121060); assert.equal(s.groups.length, 3); assert.equal(s.groups[0].frames, 12);
  assert.equal(s.groups[1].frames, 1); assert.equal(s.groups[2].frames, 1);
});

test('last-five-minute coverage is bounded, ages during pauses and freezes when stopped', () => {
  const r = run(); advance(r, 0, 800000);
  let s = r.snapshot(800000), g = s.groups[0]; assert.ok(g.sampledCombatMs >= 600000);
  assert.ok(g.lastFiveMinutes.sampledCombatMs >= 299000 && g.lastFiveMinutes.sampledCombatMs <= 300000);
  assert.ok(r.recent.length <= 302); r.phaseTo('PAUSED', 800000);
  assert.equal(r.snapshot(1200000).groups[0].lastFiveMinutes.frames, 0);
  r.stop(1200000); s = r.snapshot(1500000); assert.equal(s.elapsedMs, 1200000);
  assert.equal(s.phaseMs.PAUSED, 400000);
});

test('resource peaks and event truncation are explicit; a new run clears old data', () => {
  const r = run(); r.resources({ buffer: 24 }); r.resources({ buffer: 0 });
  for (let i = 0; i < 70; i++) r.event('quality', 'low', i);
  let s = r.snapshot(100); assert.equal(s.events.length, 60); assert.equal(s.omittedEventCount, 10);
  assert.equal(s.resourcePeak.buffer, 24); r.reset(200); s = r.snapshot(200);
  assert.deepEqual(s.groups, []); assert.deepEqual(s.resourcePeak, {}); assert.equal(s.elapsedMs, 0);
  assert.equal(new PerformanceRun().snapshot(100000).elapsedMs, 0);
});

test('P95 uses conservative five-ms bucket upper bounds including threshold edges', () => {
  const r = run(); advance(r, 0, 120000); let now = 120000;
  for (let i = 0; i < 94; i++) r.frame(now += 16.7);
  for (let i = 0; i < 6; i++) r.frame(now += 50.1);
  const g = r.snapshot(now).groups[0]; assert.equal(g.frames, 100); assert.equal(g.p95UpperMs, 55);
});
