import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSettings, SETTINGS_KEY, DEFAULTS } from '../../src/metafight/platform/settings.js';
import { ProbeInput } from '../../src/metafight/probe-input.js';
import { drawingSize, FrameBudget } from '../../src/metafight/runtime.js';
import { createProbe } from '../../src/metafight/probe-scene.js';
import { step } from '../../src/game/sim.js';
import { hashState } from '../../src/game/state.js';
import { BTN } from '../../src/constants.js';
import { auditArtifact } from '../artifact-audit.mjs';
import { zipFiles } from '../zip.mjs';
import { gameViewport, gamePoint } from '../../src/metafight/viewport.js';

const memory = initial => { let value = initial || null; return { getItem: () => value, setItem: (key, next) => { assert.equal(key, SETTINGS_KEY); value = next; } }; };
const sdkHost = (storage, overrides = {}) => ({ localStorage: storage, xhs: { launchOptions: { miniToolEnv: { buildVersion: 9462004 } }, miniTool: { getStorage: async () => ({ data: storage.getItem() }), setStorage: async ({ data }) => storage.setItem(SETTINGS_KEY, data), ...overrides } } });

test('no SDK: independent web loads and persists a validated setting', async () => {
  const host = { localStorage: memory() }, a = await createSettings('web', host);
  assert.equal(a.sdkPresent, false); assert.equal((await a.save({ sensitivity: 2 })).ok, true);
  assert.equal((await createSettings('web', host)).value.sensitivity, 2);
  assert.throws(() => a.save({ sensitivity: Infinity }));
});
test('modern client uses SDK; version build suffix ignored; missing API does not fork storage', async () => {
  const disk = memory(), host = sdkHost(disk), a = await createSettings('xiaohongshu', host);
  assert.equal(a.backend, 'xhs-storage'); await a.save({ sensitivity: 1.5 });
  const bad = sdkHost(memory(), { getStorage: undefined, setStorage: undefined });
  const b = await createSettings('xiaohongshu', bad);
  assert.equal((await b.save({ sensitivity: 2 })).ok, false); assert.equal(bad.localStorage.getItem(), null);
});
test('legacy version and missing launch API use exception-safe fallback', async () => {
  const host = sdkHost(memory()); host.xhs.launchOptions.miniToolEnv.buildVersion = 9459999;
  assert.equal((await createSettings('xiaohongshu', host)).backend, 'legacy-localStorage');
  const broken = { get localStorage() { throw new Error('disabled'); } };
  const a = await createSettings('xiaohongshu', broken);
  assert.equal((await a.save({ sensitivity: 2 })).ok, false); assert.equal(a.value.sensitivity, 2);
});
test('async launch options supported; platform failures do not write browser storage', async () => {
  let writes = 0; const host = sdkHost({ getItem: () => null, setItem: () => writes++ }, { getLaunchOptions: async () => ({ miniToolEnv: { buildVersion: 9490001 } }), setStorage: async () => { throw new Error('quota'); } });
  delete host.xhs.launchOptions;
  const a = await createSettings('xiaohongshu', host); assert.equal(a.buildVersion, 9490001);
  assert.equal((await a.save({ sensitivity: 2 })).ok, false); assert.equal(writes, 0);
});
test('migration only when target absent; modern settings take precedence', async () => {
  let target = null; const host = sdkHost(memory(JSON.stringify({ ...DEFAULTS, revision: 4, sensitivity: 2 })), {
    getStorage: async () => ({ data: target }), setStorage: async ({ data }) => { target = data; },
  });
  const a = await createSettings('xiaohongshu', host); assert.equal(a.value.sensitivity, 2); assert.ok(target);
  target = JSON.stringify({ ...DEFAULTS, revision: 9, sensitivity: 1.25 });
  assert.equal((await createSettings('xiaohongshu', host)).value.sensitivity, 1.25);
});
test('unknown schema is preserved; corrupt JSON degrades without blocking play', async () => {
  const host = { localStorage: memory('{"schemaVersion":2}') }, a = await createSettings('web', host);
  assert.equal((await a.save({ sensitivity: 2 })).ok, false); assert.equal(host.localStorage.getItem(), '{"schemaVersion":2}');
  assert.equal((await createSettings('web', { localStorage: memory('{broken') })).value.sensitivity, 1);
});
test('writes serialized; a late read cannot overwrite an edit', async () => {
  let finishWrite, readLater, reads = 0; const writes = [];
  const host = sdkHost(memory(), { getStorage: () => ++reads === 1 ? Promise.resolve({ data: null }) : new Promise(r => { readLater = r; }),
    setStorage: ({ data }) => { writes.push(JSON.parse(data)); return writes.length === 1 ? new Promise(r => { finishWrite = r; }) : Promise.resolve(); } });
  const a = await createSettings('xiaohongshu', host);
  const reading = a.load(); await Promise.resolve();
  const one = a.save({ sensitivity: 2 }), two = a.save({ sensitivity: 3 });
  await new Promise(r => setTimeout(r, 0)); assert.equal(writes.length, 1);
  readLater({ data: JSON.stringify(DEFAULTS) }); assert.equal((await reading).stale, true);
  finishWrite(); await Promise.all([one, two]); assert.equal(writes.length, 2); assert.equal(a.value.sensitivity, 3); assert.equal(writes[1].revision, 2);
});
test('timed out native write disables further persistence to avoid stale completion overwrite', async () => {
  let count = 0; const a = await createSettings('xiaohongshu', sdkHost(memory(), { setStorage: () => { count++; return new Promise(() => {}); } }), 15);
  assert.equal((await a.save({ sensitivity: 2 })).ok, false);
  assert.equal((await a.save({ sensitivity: 3 })).ok, false); assert.equal(count, 1);
});
test('three pointer roles remain bound; cancellation and short fire edge clear predictably', () => {
  const p = new ProbeInput(); p.enabled = true; p.down(1, 'move', 10, 10); p.down(2, 'look', 100, 10); p.down(3, 'fire', 200, 10);
  p.move(1, 30, -20); p.move(3, 250, 0); p.up(3);
  let sample = p.read(); assert.ok(sample.b & BTN.FWD); assert.ok(sample.b & BTN.RIGHT); assert.ok(sample.b & BTN.FIRE); assert.ok(sample.yaw > 0);
  assert.equal(p.read().b & BTN.FIRE, 0); p.clear(); assert.equal(p.read().b, 0); assert.equal(p.points.size, 0);
});
test('pixel cap survives large/high-DPR viewports; low-FPS degrades rendering then stops', () => {
  for (const [w, h] of [[3840, 2160], [844, 390], [390, 844]]) {
    const size = drawingSize(w, h, 4); assert.ok(size.width * size.height <= 1000000); assert.ok(size.dpr <= 1);
  }
  const b = new FrameBudget(); let actions = [];
  for (let i = 0; i < 160; i++) { const r = b.sample(120); if (r) actions.push(r); }
  assert.deepEqual(actions.slice(0, 3), ['degrade', 'degrade', 'stop']);
});
test('both platform adapters drive the same real core and seed without rule drift', async () => {
  const states = [];
  for (const channel of ['web', 'xiaohongshu']) {
    const setting = await createSettings(channel, sdkHost(memory())); await setting.save({ sensitivity: 1.5 });
    const s = createProbe(42);
    for (let i = 0; i < 360; i++) step(s, [{ b: i < 20 ? BTN.FWD : BTN.FIRE, yaw: 0, pitch: 0 }]);
    states.push(s);
  }
  assert.equal(hashState(states[0]), hashState(states[1])); assert.equal(states[0].bodies.length, 2);
  assert.ok(states[0].bodies[0].ammo[0] < 60); assert.ok(states[0].bodies[1].deaths > 0);
});
test('built artifacts meet static gate (METAFIGHT_WEB_ONLY=1 limits this to web); rejects inline/module/network regressions', () => {
  const dirs = process.env.METAFIGHT_WEB_ONLY === '1' ? ['dist/web'] : ['dist/web', 'dist/xiaohongshu'];
  for (const dir of dirs) assert.deepEqual(auditArtifact(dir).errors, []);
  const temp = mkdtempSync(path.join(tmpdir(), 'metafight-audit-'));
  try {
    cpSync(dirs[dirs.length - 1], temp, { recursive: true });
    writeFileSync(path.join(temp, 'app.js'), 'fetch("https://example.com")'); assert.notEqual(auditArtifact(temp).errors.length, 0);
    writeFileSync(path.join(temp, 'app.js'), 'export const x = 1'); assert.notEqual(auditArtifact(temp).errors.length, 0);
    writeFileSync(path.join(temp, 'app.js'), 'const x = 1');
    writeFileSync(path.join(temp, 'index.html'), '<script>alert(1)</script>'); assert.notEqual(auditArtifact(temp).errors.length, 0);
  } finally { rmSync(temp, { recursive: true }); }
});
test('deterministic ZIP has same bytes independent of input order', () => {
  const entries = [['index.html', Buffer.from('page')], ['app.js', Buffer.from('code')]];
  assert.deepEqual(zipFiles(entries), zipFiles(entries.slice().reverse()));
});

test('locked portrait uses landscape geometry; every corner maps back to game space', () => {
  for (const [w, h] of [[390, 844], [360, 640], [430, 932]]) {
    const view = gameViewport(w, h, true);
    assert.equal(view.width, h); assert.equal(view.height, w);
    for (const [x, y] of [[0, 0], [h, 0], [0, w], [h, w], [h / 2, w / 2]]) {
      // CSS rotate(90deg) with translate origin at (physical width, 0).
      assert.deepEqual(gamePoint(view, w - y, x), { x, y });
    }
    assert.equal(gameViewport(w, h).rotated, false);
    const native = gameViewport(h, w, true);
    assert.equal(native.rotated, false); assert.deepEqual(gamePoint(native, 21, 42), { x: 21, y: 42 });
  }
});

test('rotated three-finger gestures produce the same core inputs as native landscape', () => {
  const results = [];
  for (const rotated of [false, true]) {
    const view = rotated ? gameViewport(390, 844, true) : gameViewport(844, 390);
    const p = new ProbeInput(); p.enabled = true;
    const physical = (x, y) => rotated ? [390 - y, x] : [x, y];
    const down = (id, role, x, y) => { const q = gamePoint(view, ...physical(x, y)); p.down(id, role, q.x, q.y); };
    const move = (id, x, y) => { const q = gamePoint(view, ...physical(x, y)); p.move(id, q.x, q.y); };
    down(1, 'move', 100, 230); down(2, 'look', 450, 180); down(3, 'fire', 750, 290);
    move(1, 125, 200); move(2, 465, 170); move(3, 770, 280);
    results.push(p.read());
    p.clear(); assert.equal(p.read().b, 0); assert.equal(p.points.size, 0);
  }
  assert.deepEqual(results[0], results[1]);
  assert.ok(results[1].b & BTN.FWD); assert.ok(results[1].b & BTN.RIGHT); assert.ok(results[1].b & BTN.FIRE);
});
