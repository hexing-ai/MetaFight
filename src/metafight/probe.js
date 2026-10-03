import { Renderer } from '../render/renderer.js';
import { getContext } from '../render/gl.js';
import { Audio } from '../audio.js';
import { step } from '../game/sim.js';
import { createProbe } from './probe-scene.js';
import { ProbeInput } from './probe-input.js';
import { createSettings } from './platform/settings.js';
import { drawingSize, FrameBudget, trackGPU } from './runtime.js';
import { gameViewport, gamePoint } from './viewport.js';

const channel = __CHANNEL__, buildId = __BUILD_ID__;
const $ = id => document.getElementById(id);
const input = new ProbeInput(), budget = new FrameBudget(), audio = new Audio();
const canvas = $('screen'), play = $('play');
const events = [];
let settings, renderer, gpu, state, raf = 0, lastTime = 0, accumulator = 0, running = false;
let initAttempts = 0, initializing = false, contextLost = false, soundEnabled = false;
let shots = 0, hits = 0, frames = 0, lastHud = 0, pages = [], pageIndex = 0;
let lastError = '', generation = 0, audioGeneration = 0;
let landscapeRequested = false;
let viewport = gameViewport(window.innerWidth, window.innerHeight);
const record = (type, detail = '') => { events.push({ time: Date.now(), type, detail }); if (events.length > 60) events.shift(); };
const landscape = () => viewport.width >= viewport.height;
const show = (id, visible) => $(id).classList.toggle('hidden', !visible);
const setStatus = () => { $('storageStatus').textContent = settings ? settings.status : '设置尚未就绪'; };

$('build').textContent = buildId;
$('channel').textContent = channel === 'web' ? '独立网页版 · 本地运行' : '小红书测试包 · 容器结果待验证';

function silence() {
  audioGeneration++;
  if (audio.ctx) {
    try { audio.master.gain.value = 0; Promise.resolve(audio.ctx.suspend()).catch(() => {}); } catch { /* silent fallback */ }
  }
}
function clearInput() { input.enabled = false; input.clear(); $('fire').classList.remove('held'); }
function pause(reason) {
  generation++;
  running = false; cancelAnimationFrame(raf); raf = 0; accumulator = 0; lastTime = 0;
  budget.resetWindow(); clearInput(); silence();
  show('play', false); show('panel', true);
  $('heading').textContent = state ? '测试已暂停' : '进入测试场';
  $('message').textContent = reason || '点击继续，再次试试移动、转向和开火。';
  $('start').textContent = state ? '继续测试' : '进入测试场';
  show('reset', !!state); updateOrientation(); record('pause', reason);
}
function fail(error) {
  lastError = error.message || String(error);
  pause(lastError); $('heading').textContent = '暂时无法继续';
  if (gpu) { gpu.dispose(); gpu = null; }
  renderer = null; state = null;
  $('start').textContent = initAttempts < 2 ? '重新初始化' : '请关闭后重新打开';
  $('start').disabled = initAttempts >= 2 || contextLost || !landscape();
  show('reset', false); record('error', lastError);
}
function resize() {
  const next = gameViewport(window.innerWidth, window.innerHeight, landscapeRequested);
  const changed = next.width !== viewport.width || next.height !== viewport.height || next.rotated !== viewport.rotated;
  viewport = next;
  const app = $('app');
  app.style.width = viewport.width + 'px'; app.style.height = viewport.height + 'px';
  // Keep the layout box at the origin. Rotate/translate together inside a
  // fixed clipping frame so focus scrolling cannot move the whole document.
  app.style.left = '0px';
  app.classList.toggle('rotated', viewport.rotated);
  app.classList.toggle('portrait', !landscape());
  app.classList.toggle('compact', landscape() && viewport.height <= 440);
  const size = drawingSize(viewport.width, viewport.height, window.devicePixelRatio, budget.scale);
  if (renderer) { canvas.width = size.width; canvas.height = size.height; }
  if (changed && (running || initializing)) pause('显示区域已变化，点击继续。');
  updateOrientation();
}
function updateOrientation() {
  show('rotate', !landscape());
  show('displayMode', window.innerWidth < window.innerHeight || landscapeRequested);
  $('displayMode').textContent = landscapeRequested ? '恢复自动显示' : '开启横向显示';
  show('displayHint', viewport.rotated);
  show('recoverDisplay', landscapeRequested);
  $('start').disabled = !settings || !window.PointerEvent || !landscape() || contextLost || initializing || (!renderer && initAttempts >= 2);
  if (!landscape() && running) pause('已暂停。请横过来后点击继续。');
}
function newProbe() {
  state = createProbe(); input.clear(); input.yaw = state.bodies[0].yaw; input.pitch = 0;
  shots = 0; hits = 0; accumulator = 0; lastTime = 0;
  if (renderer) { renderer.effects.length = 0; renderer.eyeY = 0; }
}
async function start() {
  if (!settings || initializing || !landscape() || contextLost || document.hidden) return;
  if (!renderer && initAttempts >= 2) return;
  initializing = true; $('start').disabled = true;
  const token = ++generation;
  try {
    if (!renderer) {
      initAttempts++; $('message').textContent = '正在准备测试场…';
      // Yield once so the loading message can paint; no network, worker or extra engine.
      await new Promise(resolve => setTimeout(resolve, 0));
      if (token !== generation || document.hidden || !landscape()) return;
      const gl = getContext(canvas);
      if (!gl) throw new Error('当前图形能力不足。请更换设备或重新打开测试。');
      gpu = trackGPU(gl); renderer = new Renderer(canvas); newProbe();
      renderer.setMap(state.map.key, state.map); resize(); record('initialized', gl.webgl2 ? 'WebGL2' : 'WebGL1');
    }
    if (token !== generation || document.hidden || !landscape()) return;
    input.sensitivity = settings.value.sensitivity; input.clear(); input.enabled = true;
    if (soundEnabled && audio.ctx) {
      audio.master.gain.value = settings.value.volume;
      Promise.resolve(audio.ctx.resume()).catch(() => { soundEnabled = false; $('audioStatus').textContent = '声音恢复失败，可再次点击试听'; });
    }
    lastTime = 0; accumulator = 0; budget.resetWindow(); running = true;
    show('panel', false); show('play', true); show('details', false);
    raf = requestAnimationFrame(frame); record('continue');
  } catch (error) { fail(error); }
  finally { initializing = false; updateOrientation(); }
}
function frame(now) {
  raf = 0;
  if (!running) return;
  try {
    const ms = lastTime ? now - lastTime : 16.67;
    lastTime = now; frames++;
    const action = budget.sample(ms);
    if (action === 'stop') { pause('最低画质仍然过慢，已暂停。可稍后继续或更换设备。'); return; }
    if (action === 'degrade') { renderer.effects.length = 0; resize(); record('render-degraded', String(budget.level)); }
    const dt = Math.min(ms / 1000, 0.1); accumulator += dt;
    let steps = 0;
    while (accumulator >= 1 / 60 && steps++ < 6) {
      for (const b of state.bodies) { b.px = b.x; b.py = b.y; b.pz = b.z; b.pyaw = b.yaw; }
      step(state, [input.read()]); accumulator -= 1 / 60;
      for (const event of state.events) {
        if (event.type === 'fire' && event.body === 0) shots++;
        if (event.type === 'hurt') hits++;
      }
      if (budget.level === 0) renderer.addEvents(state, state.events, 0);
      // Bound nonessential decoration; gameplay events are never dropped.
      if (renderer.effects.length > 16) renderer.effects.splice(0, renderer.effects.length - 16);
      if (soundEnabled && audio.ctx && audio.ctx.state === 'running') {
        const me = state.bodies[0]; audio.setListener(me.x, me.y + 1.6, me.z, 1, 0);
        audio.play(state, state.events, 0);
      }
    }
    renderer.step(dt); gpu.begin();
    renderer.draw(state, { index: 0, dt, alpha: Math.min(1, accumulator * 60), yaw: input.yaw, pitch: input.pitch });
    gpu.end();
    if (now - lastHud > 250) {
      lastHud = now;
      $('ammo').textContent = '开火 ' + shots + ' · 靶标 HP ' + state.bodies[1].health;
      $('liveStatus').textContent = '指针 ' + input.points.size + ' · ' + canvas.width + '×' + canvas.height + (budget.level ? ' · 已降画质' : '');
    }
    raf = requestAnimationFrame(frame);
  } catch (error) { fail(error); }
}

function pointerDown(e) {
  if (!running || e.target.closest('#pause')) return;
  e.preventDefault();
  const point = gamePoint(viewport, e.clientX, e.clientY);
  const role = e.target.closest('#fire') ? 'fire' : point.x < viewport.width * 0.43 ? 'move' : 'look';
  input.down(e.pointerId, role, point.x, point.y);
  try { play.setPointerCapture(e.pointerId); } catch { /* up/cancel are also handled at window */ }
  $('fire').classList.toggle('held', Array.from(input.points.values()).some(p => p.role === 'fire'));
}
function pointerUp(e) {
  input.up(e.pointerId); $('fire').classList.toggle('held', Array.from(input.points.values()).some(p => p.role === 'fire'));
}
play.addEventListener('pointerdown', pointerDown);
window.addEventListener('pointermove', e => { if (input.points.has(e.pointerId)) { e.preventDefault(); const p = gamePoint(viewport, e.clientX, e.clientY); input.move(e.pointerId, p.x, p.y); } }, { passive: false });
window.addEventListener('pointerup', pointerUp); window.addEventListener('pointercancel', e => { pointerUp(e); input.fireEdge = false; });
play.addEventListener('lostpointercapture', pointerUp);
window.addEventListener('keydown', e => {
  if (!running) return;
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) { e.preventDefault(); input.keys.add(e.code); }
  if (e.code === 'Escape') pause('已暂停');
});
window.addEventListener('keyup', e => input.keys.delete(e.code));
window.addEventListener('blur', () => { if (running || initializing) pause('页面失去焦点，点击继续'); else { clearInput(); silence(); } });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  if (running || initializing) pause('已暂停后台运行，点击继续');
  else { clearInput(); silence(); }
});
window.addEventListener('pagehide', () => {
  if (running || initializing) pause('页面已离开');
  else { clearInput(); silence(); }
});
window.addEventListener('resize', resize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); contextLost = true; fail(new Error('图形上下文丢失，已停止渲染。恢复后可重试一次。')); });
canvas.addEventListener('webglcontextrestored', () => { contextLost = false; updateOrientation(); record('context-restored'); });
$('pause').addEventListener('click', () => pause('已暂停，设置或查看测试记录后可继续'));
$('start').addEventListener('click', start);
$('displayMode').addEventListener('click', () => {
  pause('请横放手机，让手机顶部朝左，再点击进入或继续。');
  landscapeRequested = !landscapeRequested; resize();
  record('display-mode', viewport.rotated ? 'css-landscape' : 'native');
});
$('recoverDisplay').addEventListener('click', () => {
  landscapeRequested = false;
  resize(); pause('已恢复显示。可重新开启横向显示，或查看测试记录。');
  show('details', false); $('panel').scrollTop = 0;
  record('display-recovered');
});
$('reset').addEventListener('click', () => { if (renderer && !initializing) { newProbe(); record('reset'); start(); } });
$('sensitivity').addEventListener('input', () => { $('sensitivityValue').textContent = Number($('sensitivity').value).toFixed(2); });
$('save').addEventListener('click', async () => {
  if (!settings) return;
  const task = settings.save({ sensitivity: Number($('sensitivity').value) }); setStatus();
  const result = await task; input.sensitivity = settings.value.sensitivity; setStatus(); record('save', result.ok ? 'ok' : result.error);
});
$('sound').addEventListener('click', () => {
  try {
    const token = ++audioGeneration;
    if (!audio.ctx) audio.start();
    if (!audio.ctx) throw new Error('设备未提供声音能力');
    audio.master.gain.value = settings.value.volume;
    Promise.resolve(audio.ctx.resume()).then(() => {
      if (token !== audioGeneration || document.hidden) { silence(); return; }
      soundEnabled = true; audio.blip({ gain: 0.25, pan: 0 }, 600, 0.16);
      $('audioStatus').textContent = '已请求播放短音；请听辨，进入后启用枪声'; record('audio-request', audio.ctx.state);
    }).catch(() => { $('audioStatus').textContent = '声音被限制，请再次点击试听'; });
  } catch (error) { $('audioStatus').textContent = error.message + '，其他测试仍可继续'; }
});

function diagnostic() {
  return {
    buildId, channel, sdkPresent: settings && settings.sdkPresent, hostVersion: settings && settings.buildVersion,
    notice: '运行数据仅来自当前环境；普通网页与模拟SDK不能证明平台兼容或真机性能。',
    state: running ? 'running' : 'paused', tick: state && state.tick, frames, shots, hits,
    position: state && { x: state.bodies[0].x, z: state.bodies[0].z, yaw: state.bodies[0].yaw },
    viewport: { width: window.innerWidth, height: window.innerHeight, gameWidth: viewport.width, gameHeight: viewport.height,
      mode: viewport.rotated ? 'css-landscape' : 'native', canvasWidth: canvas.width, canvasHeight: canvas.height,
      appRect: (() => { const r = $('app').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })(),
      scrollX: window.scrollX, scrollY: window.scrollY },
    graphics: gpu && gpu.metrics, renderLevel: budget.level, lastWindowMs: budget.averageMs,
    audio: audio.ctx ? audio.ctx.state : 'not-activated', storage: settings && { backend: settings.backend, status: settings.status, value: settings.value },
    pointerCount: input.points.size, lastError, events,
  };
}
function renderPage() { $('detailsText').textContent = pages[pageIndex] || ''; $('pageNumber').textContent = (pageIndex + 1) + ' / ' + pages.length; $('previous').disabled = !pageIndex; $('next').disabled = pageIndex >= pages.length - 1; }
function details(mode) {
  const text = mode === 'license' ? __LICENSE_TEXT__ : JSON.stringify(diagnostic(), null, 2);
  pages = []; for (let i = 0; i < text.length; i += 1100) pages.push(text.slice(i, i + 1100));
  pageIndex = 0; $('detailsTitle').textContent = mode === 'license' ? '开源许可' : '测试记录 · 可截图留存';
  show('details', true); renderPage();
}
$('diagnostics').addEventListener('click', () => details('diagnostics'));
$('license').addEventListener('click', () => details('license'));
$('closeDetails').addEventListener('click', () => show('details', false));
$('previous').addEventListener('click', () => { if (pageIndex > 0) pageIndex--; renderPage(); });
$('next').addEventListener('click', () => { if (pageIndex < pages.length - 1) pageIndex++; renderPage(); });
// Read-only inspection hook is restricted to this explicitly marked developer probe.
if (__DEV_PROBE__) window.metafightProbe = { snapshot: diagnostic };
resize();

createSettings(channel, window).then(result => {
  settings = result; input.sensitivity = settings.value.sensitivity;
  $('sensitivity').value = String(input.sensitivity); $('sensitivityValue').textContent = input.sensitivity.toFixed(2);
  $('sensitivity').disabled = false; $('save').disabled = false; $('sound').disabled = false;
  $('start').textContent = '进入测试场'; setStatus(); updateOrientation();
  if (channel === 'xiaohongshu' && !settings.sdkPresent) $('channel').textContent = '未检测到宿主 SDK · 当前不能记作平台通过';
  if (!window.PointerEvent) { $('message').textContent = '当前环境缺少指针输入能力，请更换支持设备。'; $('start').disabled = true; }
  record('settings-ready', settings.backend);
}).catch(error => { $('message').textContent = '设置初始化失败：' + error.message; });
