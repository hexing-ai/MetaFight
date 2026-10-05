import { Renderer } from '../render/renderer.js';
import { getContext } from '../render/gl.js';
import { Audio } from '../audio.js';

import { BTN } from '../constants.js';
import { SimulationClock } from './simulation-clock.js';
import { aimSlowdown } from './practice.js';
import { createCombatMatch, stepCombatMatch } from './match.js';
import { DEFAULTS } from './platform/settings.js';
import { GAME_DEFAULTS } from './config.js';
import { ProbeInput } from './probe-input.js';
import { createSettings } from './platform/settings.js';
import { drawingSize, FrameBudget, trackGPU } from './runtime.js';
import { gameViewport, gamePoint } from './viewport.js';
import { cargoAppearance, cargoTextures, loadCargoMaterials, VISUAL_VERSION } from './visuals/cargo.js';
import { cargoBody, cargoRifle } from './visuals/models.js';
import { actorMarker } from './visuals/markers.js';
import { CombatFeedback, GUIDE_STEPS } from './presentation.js';
import { cosA, sinA } from '../util.js';
import { PerformanceRun } from './performance.js';
import { PRIVACY_TEXT, ASSET_TEXT } from './legal.js';

const channel = __CHANNEL__, buildId = __BUILD_ID__;
const $ = id => document.getElementById(id);
const clock = new SimulationClock();
let hitUntil = 0, damageUntil = 0, exitArmed = false, matchNumber = 0;
const input = new ProbeInput(), budget = new FrameBudget(), audio = new Audio();
const canvas = $('screen'), play = $('play');
const visual = __M3_VISUALS__;
const performanceRun = visual && __DEV_PROBE__ ? new PerformanceRun() : null;
const startupMs = performance.now();
let readyMs = null;
let preparing = false;
let markers = [];
const feedback = new CombatFeedback();
let guideIndex=0, guideOpen=false, guideStart=false, guideSessionDone=false, jumpUntil=0;
const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let disposedResources=null;
let resultSoundPlayed=false;
const events = [];
let settings, renderer, gpu, state, raf = 0, lastTime = 0, accumulator = 0, running = false;
let initAttempts = 0, initializing = false, contextLost = false, soundEnabled = false;
let shots = 0, hits = 0, frames = 0, lastHud = 0, pages = [], pageIndex = 0;
let lastError = '', generation = 0, audioGeneration = 0;
let landscapeRequested = false;
let viewport = gameViewport(window.innerWidth, window.innerHeight);
const record = (type, detail = '') => { events.push({ time: Date.now(), type, detail }); if (events.length > 60) events.shift(); if (performanceRun) performanceRun.event(type, detail, performance.now()); };
const landscape = () => viewport.width >= viewport.height;
const show = (id, visible) => $(id).classList.toggle('hidden', !visible);
const setStatus = () => { $('storageStatus').textContent = settings ? settings.status : '设置尚未就绪'; };

$('build').textContent = buildId;
$('channel').textContent = __DEV_PROBE__ ? (channel === 'web' ? '独立网页版 · 本地运行' : '小红书测试包 · 容器结果待验证') : (channel === 'web' ? '独立网页版 · 公开测试候选' : '小红书版 · 公开测试候选');

function silence() {
  audioGeneration++;
  if (audio.ctx) {
    try { audio.master.gain.value = 0; Promise.resolve(audio.ctx.suspend()).catch(() => {}); } catch { /* silent fallback */ }
  }
}
function clearInput() { input.enabled = false; input.clear(); feedback.emptyHeld=false; $('fire').classList.remove('held'); if(visual) $('stick').style.transform=''; }
function pause(reason) {
  if (state && state.result) { presentResult(); return; }
  generation++;
  if (visual) { preparing = false; show('preparing', false); $('panel').classList.toggle('cover', !state); }
  running = false; clock.pause(); cancelAnimationFrame(raf); raf = 0; accumulator = 0; lastTime = 0;
  budget.resetWindow(); clearInput(); silence();
  if (performanceRun) performanceRun.phaseTo(lastError ? 'ERROR' : state ? 'PAUSED' : 'MENU', performance.now());
  show('play', false); show('panel', true);
  if (!visual || state) $('heading').textContent = state ? '对局已暂停' : '进入甲板';
  else $('heading').innerHTML = '<em>METAFIGHT</em><span>货轮交锋</span>';
  $('message').textContent = reason || '点击继续，再次试试移动、转向和开火。';
  $('start').textContent = state ? '继续对局' : visual ? '开始战斗' : '进入甲板';
  show('reset', !!state); show('leave', !!state); if (__DEV_PROBE__) $('fixture').disabled = !!state; updateOrientation(); record('pause', reason);
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
  const size = drawingSize(viewport.width, viewport.height, window.devicePixelRatio, budget.scale, budget.effectiveQuality);
  if (renderer) { canvas.width = size.width; canvas.height = size.height; }
  if (changed && (running || initializing)) pause('显示区域已变化，点击继续。');
  updateOrientation();
}
function updateOrientation() {
  show('rotate', !visual && !landscape());
  show('displayMode', !visual && (window.innerWidth < window.innerHeight || landscapeRequested));
  $('displayMode').textContent = landscapeRequested ? '恢复自动显示' : '开启横向显示';
  show('displayHint', !visual && viewport.rotated);
  show('recoverDisplay', viewport.rotated && !running && !preparing);
  $('start').disabled = !settings || !window.PointerEvent || (!visual && !landscape()) || contextLost || initializing || (!renderer && initAttempts >= 2);
  if (!landscape() && running) pause('已暂停。请横过来后点击继续。');
}
function newProbe() {
  feedback.reset(); lastHud=0; jumpUntil=0; resultSoundPlayed=false;
  state = createCombatMatch({ candidate: __DEV_PROBE__ && $('fixture').value === 'match-12', seed: 20261001 + matchNumber++ }); clock.reset(); input.clear(); input.yaw = state.bodies[0].yaw; input.pitch = 0;
  if (performanceRun && performanceRun.enabled) performanceRun.matches++;
  shots = 0; hits = 0; accumulator = 0; lastTime = 0;
  for (const b of state.bodies) { b.px = b.x; b.py = b.y; b.pz = b.z; b.pyaw = b.yaw; }
  if (renderer) { renderer.effects.length = 0; renderer.eyeY = 0; }
  if (visual) {
    $('markers').textContent = '';
    markers = state.bodies.map(b => {
      const node = document.createElement('span'); node.className = 'actor-marker team-' + b.team;
      node.textContent = b.team ? '▼ 敌方' : '◆ 队友'; node.hidden = true; $('markers').appendChild(node); return node;
    });
  }
}
async function start() {
  if (!settings || running || initializing || guideOpen || (!visual && !landscape()) || contextLost || document.hidden || (state && state.result)) return;
  const fresh = !state;
  if (visual) { landscapeRequested = true; resize(); show('settingsPanel', false); }
  exitArmed = false; $('leave').textContent = '退出本局';
  // Create/resume audio while still inside the user's start gesture.
  try {
    if (!audio.ctx) { audio.start(); soundEnabled = !!audio.ctx; }
    if (audio.ctx && soundEnabled) Promise.resolve(audio.ctx.resume()).catch(() => { soundEnabled = false; $('audioStatus').textContent = '声音不可用，已静音继续'; });
    else if (!audio.ctx) $('audioStatus').textContent = '设备未提供声音，已静音继续';
  } catch (error) { soundEnabled = false; $('audioStatus').textContent = '声音不可用，已静音继续'; record('audio-error', error.message); }
  if (!renderer && initAttempts >= 2) return;
  initializing = true; $('start').disabled = true;
  const token = ++generation;
  try {
    if (!renderer) {
      initAttempts++; $('message').textContent = '正在准备货轮甲板…';
      // Yield once so the loading message can paint; no network, worker or extra engine.
      await new Promise(resolve => setTimeout(resolve, 0));
      if (visual) await loadCargoMaterials();
      if (token !== generation || document.hidden || !landscape()) return;
      const gl = getContext(canvas);
      if (!gl) throw new Error('当前图形能力不足。请更换设备或重新打开测试。');
      gpu = trackGPU(gl); renderer = new Renderer(canvas, visual ? { textures:cargoTextures, bodies:[cargoBody(0),cargoBody(1)], weapons:[cargoRifle()], viewScale:0.52 } : undefined); newProbe();
      renderer.setMap(state.map.key, visual ? cargoAppearance(state.map) : state.map); resize(); record('initialized', gl.webgl2 ? 'WebGL2' : 'WebGL1');
    }
    if (token !== generation || document.hidden || !landscape()) return;
    if (visual && fresh) {
      preparing = true; show('panel', false); show('preparing', true); show('recoverDisplay', false);
      $('prepareHint').textContent = viewport.rotated ? '手机顶部朝左，横握进入战斗' : '准备登上甲板';
      renderer.draw(state, {index:0,dt:0,alpha:0,yaw:input.yaw,pitch:input.pitch});
      for (let count = 3; count > 0; count--) {
        $('prepareCount').textContent = String(count);
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (token !== generation || document.hidden || !landscape()) return;
      }
      preparing = false; show('preparing', false);
    }
    input.sensitivity = settings.value.sensitivity; input.clear(); input.enabled = !!state.bodies[0].alive;
    if (soundEnabled && audio.ctx) {
      audio.master.gain.value = settings.value.volume;
      Promise.resolve(audio.ctx.resume()).catch(() => { soundEnabled = false; $('audioStatus').textContent = '声音恢复失败，可再次点击试听'; });
    }
    lastError = ''; lastTime = 0; accumulator = 0; budget.resetWindow(); running = true; clock.resume();
    if (performanceRun) { configurePerformance(); performanceRun.resources(gpu.resources()); performanceRun.phaseTo(state.bodies[0].alive ? 'PLAYING' : 'RESPAWNING', performance.now()); }
    if (visual) $('panel').classList.remove('cover');
    show('panel', false); show('play', true); show('details', false); show('result', false);
    raf = requestAnimationFrame(frame); record('continue');
  } catch (error) { if (token === generation) fail(error); }
  finally { initializing = false; updateOrientation(); }
}
function frame(now) {
  raf = 0;
  if (!running) return;
  try {
    const ms = lastTime ? now - lastTime : 16.67;
    lastTime = now; frames++;
    const droppedBefore = clock.droppedMs;
    const dt = Math.min(ms / 1000, 0.1);
    clock.advance(now, () => {
      const oldLife = state.bodies[0].lifeId;
      const controls=input.read();
      if(visual && feedback.emptyTrigger(!!(controls.b & BTN.FIRE),state.bodies[0])) cue('empty');
      stepCombatMatch(state, controls);
      if (state.result) clock.pause();
      const me = state.bodies[0];
      if (!me.alive) clearInput();
      if (me.lifeId !== oldLife) { input.clear(); input.yaw = me.yaw; input.pitch = 0; input.enabled = true; renderer.eyeY = me.y + 1.62; }
      for (const event of state.events) {
        if (event.type === 'fire' && event.body === 0) shots++;
        if (event.type === 'hit' && event.body === 0) { hits++; hitUntil = now + 160; }
        if (event.type === 'hurt' && event.body === 0) damageUntil = now + 220;
      }
      if(visual) for(const sound of feedback.consume(state,state.events)) cue(sound);
      if (budget.scale === 1 && !reducedMotion) renderer.addEvents(state, state.events, 0, { quality: budget.effectiveQuality });
      if (renderer.effects.length > 16) renderer.effects.splice(0, renderer.effects.length - 16);
      if (soundEnabled && audio.ctx && audio.ctx.state === 'running') {
        audio.setListener(me.x, me.y + 1.6, me.z, cosA(input.yaw), sinA(input.yaw));
        audio.play(state, state.events, 0);
      }
    });
    if (performanceRun) performanceRun.frame(now, clock.droppedMs - droppedBefore);
    if (state.result) { presentResult(); return; }
    if (performanceRun) performanceRun.phaseTo(state.bodies[0].alive ? 'PLAYING' : 'RESPAWNING', now);
    const action = budget.sample(ms);
    if (action === 'stop') { record('performance-stop'); pause('最低画质仍然过慢，已暂停。可稍后继续或更换设备。'); return; }
    if (action === 'degrade') { renderer.effects.length = 0; resize(); qualityStatus(); record('render-degraded', String(budget.level)); configurePerformance(); }
    $('reticle').classList.toggle('hit', now < hitUntil);
    play.classList.toggle('hurt', now < damageUntil);
    renderer.step(dt); gpu.begin();
    renderer.draw(state, { index: 0, dt, alpha: clock.alpha, yaw: input.yaw, pitch: input.pitch, reducedMotion });
    gpu.end();
    if (visual) {
      renderFeedback();
      for (const body of state.bodies) {
        const node = markers[body.index], p = actorMarker(state, body, renderer.viewProj, viewport.width, viewport.height, renderer.cameraEye);
        node.hidden = !p;
        if (p) { node.classList.toggle('target-hit',feedback.view(state,input.yaw).hit && body.index === feedback.lastVictim); node.style.opacity = p.opacity; }
        if (p) node.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px) translate(-50%,-100%)';
      }
    }
    if (now - lastHud > 250) {
      lastHud = now;
      const me = state.bodies[0];
      const status = !me.alive ? '复活 ' + (me.respawnIn / 60).toFixed(1) + '秒 · ' + (me.nemesis >= 0 ? state.bodies[me.nemesis].name + '击败了你' : '意外阵亡') : me.reloadUntil ? '换弹 ' + (Math.max(0, me.reloadUntil - state.tick) / 60).toFixed(1) + '秒' : me.shield ? '出生保护' : me.ammo[0] ? me.health <= 25 ? '低生命 · 寻找掩体' : '备用 ∞' : '弹匣空 · 自动换弹';
      $('matchHud').textContent = '红队 ' + state.teamScore[0] + ' : ' + state.teamScore[1] + ' 蓝队 · ' + timeText(state.clock);
      $('ammo').textContent = 'HP ' + me.health + ' · ' + me.ammo[0] + '/30 · ' + status;
      $('liveStatus').textContent = state.bodies.length + '人 · ' + canvas.width + '×' + canvas.height + (budget.level ? ' · 已降画质' : '');
      if (visual) {
        $('redScore').textContent = state.teamScore[0]; $('blueScore').textContent = state.teamScore[1];
        $('timer').textContent = timeText(state.clock); $('hpValue').textContent = me.health;
        $('hpFill').style.width = Math.max(0,me.health) + '%';
        $('rounds').textContent = me.ammo[0]; $('weaponStatus').textContent = status;
        $('liveStatus').textContent = budget.level ? '已自动降低画质' : '';
      }
    }
    raf = requestAnimationFrame(frame);
  } catch (error) { fail(error); }
}

function pointerDown(e) {
  if (!running || e.target.closest('#pause, #reload, #jump')) return;
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
window.addEventListener('pointermove', e => { if (input.points.has(e.pointerId)) { e.preventDefault(); const p = gamePoint(viewport, e.clientX, e.clientY); input.aimScale = aimSlowdown(state, input.yaw, input.pitch, settings.value.assist); input.move(e.pointerId, p.x, p.y); } }, { passive: false });
window.addEventListener('pointerup', pointerUp); window.addEventListener('pointercancel', e => { pointerUp(e); input.fireEdge = false; });
play.addEventListener('lostpointercapture', pointerUp);
window.addEventListener('keydown', e => {
  if (!running) return;
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) { e.preventDefault(); input.keys.add(e.code); }
  if (!e.repeat && e.code === 'KeyR') { e.preventDefault(); input.action(BTN.RELOAD); }
  if (!e.repeat && e.code === 'Space') { e.preventDefault(); input.action(BTN.JUMP); }
  if (e.code === 'Escape') pause('已暂停');
});
window.addEventListener('keyup', e => input.keys.delete(e.code));
window.addEventListener('blur', () => { if (running || initializing) pause('页面失去焦点，点击继续'); else { clearInput(); silence(); } });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { if (performanceRun) performanceRun.phaseTo(lastError ? 'ERROR' : state && state.result ? 'RESULT' : guideOpen ? 'GUIDE' : state ? 'PAUSED' : 'MENU', performance.now()); return; }
  if (running || initializing) pause('已暂停后台运行，点击继续');
  else { clearInput(); silence(); }
  if (performanceRun) performanceRun.phaseTo('BACKGROUND', performance.now());
});
window.addEventListener('pagehide', () => {
  if (running || initializing) pause('页面已离开');
  else { clearInput(); silence(); }
  if (performanceRun) performanceRun.phaseTo('BACKGROUND', performance.now());
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
$('reset').addEventListener('click', restartMatch);
function disposeMatch() {
  generation++; running = false; clock.pause(); cancelAnimationFrame(raf); raf = 0;
  clearInput(); silence();
  if (gpu) { gpu.dispose(); disposedResources=gpu.resources(); gpu = null; }
  renderer = null; state = null; initAttempts = 0; clock.reset();
  if (performanceRun) performanceRun.phaseTo('MENU', performance.now());
  hitUntil = 0; damageUntil = 0; exitArmed = false;
  feedback.reset();
  if (__DEV_PROBE__) $('fixture').disabled = false; $('leave').textContent = '退出本局';
  show('result', false); show('details', false);
}
function restartMatch() {
  if (initializing) return;
  disposeMatch(); pause('正在开始新对局。'); start();
}
$('leave').addEventListener('click', () => {
  if (!exitArmed) { exitArmed = true; $('leave').textContent = '确认退出'; $('message').textContent = '本局进度不会保留。再次点击确认退出，或继续对局。'; return; }
  returnHome('已退出本局，未生成胜负。');
});
function returnHome(message = '4 对 4 团队对抗 · 50 分获胜 · 5 分钟一局') {
  disposeMatch();
  if (visual) { preparing=false; show('preparing',false); landscapeRequested=false; resize(); }
  pause(message);
}
if (visual) {
  $('cancelPrepare').addEventListener('click',()=>returnHome());
  $('settingsOpen').addEventListener('click',()=>show('settingsPanel',true));
  $('settingsClose').addEventListener('click',()=>show('settingsPanel',false));
  $('quickGuide').addEventListener('click',()=>openGuide(false));
}
$('again').addEventListener('click', restartMatch);
$('home').addEventListener('click', () => returnHome());
function timeText(ticks) {
  const seconds = Math.ceil(Math.max(0, ticks) / 60);
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}
function presentResult() {
  const result = state.result;
  if (!result) return;
  if (performanceRun) performanceRun.phaseTo('RESULT', performance.now());
  running = false; clock.pause(); cancelAnimationFrame(raf); raf = 0; clearInput(); silence();
  if(visual && !resultSoundPlayed && soundEnabled && audio.ctx) {
    resultSoundPlayed=true;
    const token=audioGeneration;
    Promise.resolve(audio.ctx.resume()).then(()=>{
      if(token!==audioGeneration || !state || !state.result || document.hidden) return;
      audio.master.gain.value=settings.value.volume;
      audio.blip({gain:0.28,pan:0},result.winner===0?720:result.winner===1?240:440,0.3);
      setTimeout(()=>{if(token===audioGeneration) silence();},450);
    }).catch(()=>{});
  }
  show('play', false); show('panel', false); show('details', false); show('result', true);
  $('resultTitle').textContent = result.winner === -1 ? '平局' : result.winner === 0 ? '胜利' : '败北';
  $('resultScore').textContent = result.scores[0] + ' : ' + result.scores[1];
  const me = result.actors.find(b => b.player);
  $('resultSummary').textContent = (result.reason === 'limit' ? '达到目标分数' : '时间结束') + ' · 用时 ' + timeText(result.elapsedTicks) + ' · 我的击杀 ' + me.kills + ' / 死亡 ' + me.deaths;
  $('scoreboard').textContent = '';
  for (const team of [0, 1]) {
    const section = document.createElement('section'); section.className = 'team-results';
    const title = document.createElement('h2'); title.textContent = team ? '蓝队 · 敌方' : '红队 · 我方'; section.appendChild(title);
    const table = document.createElement('table'), head = document.createElement('tr');
    for (const label of ['角色', '击杀', '死亡']) { const cell = document.createElement('th'); cell.textContent = label; head.appendChild(cell); }
    const thead = document.createElement('thead'); thead.appendChild(head); table.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (const actor of result.actors.filter(b => b.team === team)) {
      const row = document.createElement('tr'); if (actor.player) row.className = 'self';
      for (const value of [actor.name + (actor.player ? ' · 我' : ' · 机器人'), actor.kills, actor.deaths]) { const cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell); }
      tbody.appendChild(row);
    }
    table.appendChild(tbody); section.appendChild(table); $('scoreboard').appendChild(section);
  }
  record('result', result.reason);
}
$('sensitivity').addEventListener('input', () => { $('sensitivityValue').textContent = Number($('sensitivity').value).toFixed(2); });
$('save').addEventListener('click', async () => {
  if (!settings) return;
  const patch={ sensitivity: Number($('sensitivity').value), volume: Number($('volume').value), assist: $('assist').checked };
  if(visual) patch.quality=$('quality').value;
  const task = settings.save(patch); setStatus();
  if(visual && budget.preferred!==patch.quality) applyQuality(patch.quality);
  const result = await task; input.sensitivity = settings.value.sensitivity; setStatus(); if (audio.ctx) audio.master.gain.value = running && soundEnabled ? settings.value.volume : 0; record('save', result.ok ? 'ok' : result.error);
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


$('reload').addEventListener('pointerdown', e => { e.preventDefault(); input.action(BTN.RELOAD); });
$('jump').addEventListener('pointerdown', e => { e.preventDefault(); input.action(BTN.JUMP); if(state) jumpUntil=state.tick+10; });
if (__DEV_PROBE__) $('fixture').addEventListener('change', () => { if (!state) $('message').textContent = $('fixture').value === 'match-12' ? '6对6开发候选，正式默认仍为4对4。' : '先到50分获胜，限时5分钟。'; });
$('defaults').addEventListener('click', () => {
  $('sensitivity').value = String(DEFAULTS.sensitivity); $('sensitivityValue').textContent = DEFAULTS.sensitivity.toFixed(2);
  $('volume').value = String(DEFAULTS.volume); $('assist').checked = DEFAULTS.assist;
  if(visual) $('quality').value=DEFAULTS.quality;
  $('save').click();
});

function cue(kind) {
  if(!soundEnabled || !audio.ctx || audio.ctx.state!=='running') return;
  const notes={hit:[740,.035],headshot:[1150,.06],kill:[950,.12],reload:[320,.06],'reload-complete':[640,.08],empty:[130,.05]};
  const note=notes[kind];
  if(note) try { audio.blip({gain:.2,pan:0},note[0],note[1]); } catch { soundEnabled=false; }
}
function qualityStatus() {
  if(!visual) return;
  $('qualityStatus').textContent=(budget.preferred==='medium'?'偏好：中画质':'偏好：低画质')+' · '+(budget.level?'运行已自动降低':'当前：'+(budget.effectiveQuality==='medium'?'中画质':'低画质'))+'；可在暂停时调整。';
}
function applyQuality(value) {
  if(running) return;
  budget.setQuality(value); if(renderer) renderer.effects.length=0;
  resize(); qualityStatus(); record('quality',budget.preferred); configurePerformance();
}
function renderFeedback() {
  const view=feedback.view(state,input.yaw);
  $('reticle').classList.toggle('hit',view.hit);
  $('reticle').classList.toggle('kill',view.kill);
  $('reticle').classList.toggle('shot',view.fire&&!reducedMotion);
  $('reticle').classList.toggle('headshot',view.hit&&view.headshot);
  play.classList.toggle('low-health',state.bodies[0].alive&&state.bodies[0].health<=25);
  $('combatNotice').textContent=view.kill?'击败 '+view.victim:view.hit?(view.headshot?'头部命中':'命中确认'):'';
  $('dangerNotice').textContent=!state.bodies[0].alive?'':view.hurt?(view.direction?view.direction+'受击':'受到伤害')+' · 寻找掩体':state.bodies[0].health<=25?'生命偏低 · 退回掩体':view.status==='protected'?'出生保护中 · 开火后解除':'';
  $('damageDirection').classList.toggle('hidden',!view.hurt||view.angle===null);
  if(view.angle!==null) $('damageDirection').style.transform='rotate('+view.angle+'rad)';
  $('weaponStatus').setAttribute('data-state',view.status);
  $('hpValue').parentElement.classList.toggle('danger',state.bodies[0].alive&&state.bodies[0].health<=25);
  $('reloadProgress').style.width=(Math.max(0,Math.min(1,view.reloadProgress))*100)+'%';
  $('reload').classList.toggle('active',view.status==='reload');
  $('fire').classList.toggle('shot',view.fire&&!reducedMotion);
  $('jump').classList.toggle('active',state.tick<jumpUntil);
  const move=Array.from(input.points.values()).find(p=>p.role==='move');
  let x=move?move.x-move.startX:0,y=move?move.y-move.startY:0;
  const length=Math.hypot(x,y); if(length>28){x=x/length*28;y=y/length*28;}
  $('stick').style.transform='translate('+x+'px,'+y+'px)';
}
function paintGuide() {
  const step=GUIDE_STEPS[guideIndex];
  $('guideTitle').textContent=step.title; $('guideBody').textContent=step.body;
  $('guideSymbol').textContent=step.symbol; $('guideHint').textContent=step.hint;
  if(guideIndex===2) {
    $('guideSymbol').textContent='';
    for(const [symbol,color] of [['◆','#ff9690'],['▼','#9dcbff']]) {
      const mark=document.createElement('span');mark.textContent=symbol+' ';mark.style.color=color;$('guideSymbol').appendChild(mark);
    }
  }
  $('guideCount').textContent='甲板行动指南 · '+(guideIndex+1)+' / '+GUIDE_STEPS.length;
  $('guideBack').disabled=guideIndex===0;
  $('guideNext').textContent=guideIndex===GUIDE_STEPS.length-1?(guideStart?'开始对局':'完成'):'下一步';
}
function openGuide(andStart=false) {
  if(!settings || initializing) return;
  pause('查看操作指南后可继续。'); guideOpen=true;guideIndex=0;guideStart=andStart;
  if (performanceRun) performanceRun.phaseTo('GUIDE', performance.now());
  show('panel',false);show('guide',true);paintGuide();$('guideNext').focus();
}
function closeGuide() {
  guideOpen=false;guideSessionDone=true;show('guide',false);show('panel',true);
  if (performanceRun) performanceRun.phaseTo(state ? 'PAUSED' : 'MENU', performance.now());
  const next=guideStart;guideStart=false;
  const saved=settings.save({guideDone:true}); setStatus();saved.then(setStatus);
  if(next) start(); else $('start').focus();
}
if(visual) {
  $('guideOpen').addEventListener('click',()=>openGuide(false));
  $('guideSkip').addEventListener('click',closeGuide);
  $('guideNext').addEventListener('click',()=>{if(guideIndex===GUIDE_STEPS.length-1)closeGuide();else{guideIndex++;paintGuide();}});
  $('guideBack').addEventListener('click',()=>{if(guideIndex>0){guideIndex--;paintGuide();}});
  $('quality').addEventListener('change',()=>{
    if(running || !settings) return;
    applyQuality($('quality').value);
    const saved=settings.save({quality:budget.preferred});setStatus();saved.then(setStatus);
  });
}

function diagnostic() {
  return {
    buildId, channel, sdkPresent: settings && settings.sdkPresent, hostVersion: settings && settings.buildVersion,
    visualVersion: visual ? VISUAL_VERSION : 'greybox',
    notice: '运行数据仅来自当前环境；普通网页与模拟SDK不能证明平台兼容或真机性能。',
    state: running ? 'running' : 'paused', tick: state && state.tick, frames, shots, hits,
    sessionState: preparing?'PREPARING':guideOpen?'GUIDE':lastError?'ERROR':state&&state.result?'RESULT':!state?'MENU':!running?'PAUSED':!state.bodies[0].alive?'RESPAWNING':'PLAYING',
    quality: {preferred:budget.preferred,effective:budget.effectiveQuality,degradeLevel:budget.level,scale:budget.scale},
    resources:gpu?gpu.resources():disposedResources,
    guide:visual?{open:guideOpen,step:guideIndex,done:guideSessionDone||!!(settings&&settings.value.guideDone)}:null,
    feedback:visual&&state?feedback.view(state,input.yaw):null,
    position: state && { x: state.bodies[0].x, z: state.bodies[0].z, yaw: state.bodies[0].yaw },
    viewport: { width: window.innerWidth, height: window.innerHeight, gameWidth: viewport.width, gameHeight: viewport.height,
      mode: viewport.rotated ? 'css-landscape' : 'native', canvasWidth: canvas.width, canvasHeight: canvas.height,
      appRect: (() => { const r = $('app').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })(),
      scrollX: window.scrollX, scrollY: window.scrollY },
    practice: state && { scores: state.teamScore, timeLeft: state.clock, fixture: state.fixture, actors: state.bodies.length, config: state.product, workload: state.matchStats, player: { health: state.bodies[0].health, ammo: state.bodies[0].ammo[0], reloadUntil: state.bodies[0].reloadUntil, respawnIn: state.bodies[0].respawnIn } }, clock: clock.snapshot(),
    result: state && state.result, matchStats: state && state.matchStats,
    graphics: gpu && gpu.metrics, renderLevel: budget.level, lastWindowMs: budget.averageMs,
    audio: audio.ctx ? audio.ctx.state : 'not-activated', storage: settings && { backend: settings.backend, status: settings.status, value: settings.value },
    pointerCount: input.points.size, lastError, events,
    performance: performanceRun ? performanceReport() : null,
  };
}
function renderPage() { $('detailsText').scrollTop = 0; $('detailsText').textContent = pages[pageIndex] || ''; $('pageNumber').textContent = (pageIndex + 1) + ' / ' + pages.length; $('previous').disabled = !pageIndex; $('next').disabled = pageIndex >= pages.length - 1; }
function details(mode) {
  const text = mode === 'license' ? __LICENSE_TEXT__ : mode === 'privacy' ? PRIVACY_TEXT : mode === 'assets' ? ASSET_TEXT : mode === 'feedback' ? feedbackText() : __DEV_PROBE__ ? (mode === 'performance' ? performanceText() : JSON.stringify(diagnostic(), null, 2)) : JSON.stringify(publicDiagnostic(), null, 2);
  pages = []; for (let i = 0; i < text.length; i += 1100) pages.push(text.slice(i, i + 1100));
  pageIndex = 0; $('detailsTitle').textContent = ({license:'开源许可',privacy:'隐私与本地数据',assets:'素材与来源',feedback:'问题反馈'})[mode] || (__DEV_PROBE__ ? '测试记录 · 可截图留存' : '版本与错误信息 · 可截图');
  if (!__DEV_PROBE__ && __CHANNEL__ === 'web') $('feedbackLink').classList.toggle('hidden', mode !== 'feedback' || !__RELEASE_META__.webFeedbackUrl);
  show('details', true); renderPage();
}
function publicDiagnostic() {
  return { version: __RELEASE_META__.version, buildId, channel, configVersion: GAME_DEFAULTS.configVersion,
    state: lastError ? 'ERROR' : state && state.result ? 'RESULT' : !state ? 'MENU' : !running ? 'PAUSED' : state.bodies[0].alive ? 'PLAYING' : 'RESPAWNING',
    quality: budget.effectiveQuality, lastError: lastError || '无已记录错误' };
}
function feedbackText() {
  return (__CHANNEL__ === 'web' ? (__RELEASE_META__.webFeedbackUrl ? '点击下方“前往反馈页面”，由你主动提交问题；不会自动附加游戏数据。' : '当前为未发布候选，网页反馈入口尚未配置。') : (__RELEASE_META__.xiaohongshuFeedback || '当前为未发布候选，站内反馈入口尚未配置。')) + '\n\n请提供游戏版本、手机与系统版本、发生问题的步骤及必要截图，避免包含私人信息。\n\n' + __RELEASE_META__.supportNote;
}
function configurePerformance() {
  if (!performanceRun || !state) return;
  performanceRun.configure({ teamSize: state.product.teamSize, preferred: budget.preferred,
    effective: budget.effectiveQuality, degradeLevel: budget.level, scale: budget.scale }, performance.now());
}
function performanceReport() {
  return { buildId, channel, hostVersion: settings && settings.buildVersion,
    mapVersion: state ? state.product.mapVersion : GAME_DEFAULTS.mapVersion, configVersion: state ? state.product.configVersion : GAME_DEFAULTS.configVersion,
    startup: { scriptToSettingsReadyMs: readyMs, note: 'Script evaluation to settings ready only; not network cold start or visible-input latency.' },
    run: performanceRun.snapshot(performance.now()) };
}
function performanceText() {
  const r = performanceReport(), run = r.run;
  const lines = ['性能记录 · ' + buildId, run.enabled ? '正在记录（跨局保留）' : '记录已停止或尚未开始',
    '渠道 ' + r.channel + '；宿主版本 ' + r.hostVersion + '；配置 ' + r.configVersion,
    '总时长 ' + (run.elapsedMs / 60000).toFixed(1) + ' 分钟；预热战斗 ' + Math.min(120, run.warmupCombatMs / 1000).toFixed(0) + '/120 秒',
    '先预热2分钟，再累计10分钟战斗；全程至少20分钟。', '手机型号／系统／小红书版本请随截图注明。'];
  for (const g of run.groups) {
    const fmt = n => n === null ? '未测' : n.toFixed(1);
    lines.push('', g.context.teamSize + '对' + g.context.teamSize + ' · 偏好' + g.context.preferred + '／实际' + g.context.effective + ' · 比例' + g.context.scale,
      '采样战斗 ' + (g.sampledCombatMs / 60000).toFixed(2) + ' 分钟；' + g.frames + ' 帧',
      '平均FPS ' + fmt(g.averageFps) + '；P95上界 ' + (g.p95Overflow ? '>250' : fmt(g.p95UpperMs)) + 'ms',
      '最近5分钟内采样 ' + (g.lastFiveMinutes.sampledCombatMs / 60000).toFixed(2) + ' 分钟；FPS ' + fmt(g.lastFiveMinutes.averageFps) + '；P95上界 ' + (g.lastFiveMinutes.p95Overflow ? '>250' : fmt(g.lastFiveMinutes.p95UpperMs)) + 'ms',
      g.sampledCombatMs < 600000 ? '采样时长不足，不能据此验收。' : '已够10分钟样本；仍需结合设备、末段覆盖和专项记录验收。');
  }
  lines.push('', '本次新建对局 ' + run.matches + '；丢弃模拟追帧 ' + run.droppedSimulationMs.toFixed(1) + 'ms',
    '状态用时(ms) ' + JSON.stringify(run.phaseMs), '资源峰值 ' + JSON.stringify(run.resourcePeak),
    '最近事件 ' + JSON.stringify(run.events.slice(-6)) + '；更早省略 ' + run.omittedEventCount + ' 条',
    '帧间隔按5ms分桶，溢出保留；后台／暂停不计入FPS。最近5分钟仅含完整1秒分片，覆盖时长以实数为准。',
    '不自动判定真机通过；输入到可见反馈延迟需另行录像。', '刷新页面会丢失本次记录，请先截图。');
  return lines.join('\n');
}
if (visual && __DEV_PROBE__) {
  $('performanceStart').addEventListener('click', () => {
    if ((performanceRun.enabled || performanceRun.groups.length) && !window.confirm('开始新的性能记录将清除本次采样，是否继续？')) return;
    performanceRun.reset(performance.now()); configurePerformance();
    performanceRun.phaseTo(state ? 'PAUSED' : 'MENU', performance.now());
    $('performanceStatus').textContent = '记录已开始：先进入对局预热2分钟，再跨局持续游玩，20分钟后停止并截图。';
  });
  $('performanceStop').addEventListener('click', () => { performanceRun.stop(performance.now()); $('performanceStatus').textContent = '记录已停止，可查看摘要并截图；刷新页面会清除。'; details('performance'); });
  $('performanceView').addEventListener('click', () => details('performance'));
  // Literal compile-time branch: the platform artifact contains no download code.
  if (__CHANNEL__ === 'web') {
    const button = document.createElement('button'); button.textContent = '导出性能 JSON'; button.id = 'performanceExport';
    $('performanceControls').appendChild(button);
    button.addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(performanceReport(), null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = buildId + '-performance.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
}
if (!__DEV_PROBE__) {
  $('privacy').addEventListener('click', () => details('privacy'));
  $('assets').addEventListener('click', () => details('assets'));
  $('feedback').addEventListener('click', () => details('feedback'));
  if (__CHANNEL__ === 'web' && __RELEASE_META__.webFeedbackUrl) $('feedbackLink').href = __RELEASE_META__.webFeedbackUrl;
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
  if(visual) { $('quality').value=settings.value.quality; applyQuality(settings.value.quality); }
  $('volume').value = String(settings.value.volume); $('assist').checked = settings.value.assist;
  $('sensitivity').value = String(input.sensitivity); $('sensitivityValue').textContent = input.sensitivity.toFixed(2);
  $('sensitivity').disabled = false; $('save').disabled = false; $('sound').disabled = false;
  $('start').textContent = visual ? '开始战斗' : '进入甲板'; setStatus(); updateOrientation();
  if (channel === 'xiaohongshu' && !settings.sdkPresent) $('channel').textContent = __DEV_PROBE__ ? '未检测到宿主 SDK · 当前不能记作平台通过' : '小红书版 · 本地模式';
  if (!window.PointerEvent) { $('message').textContent = '当前环境缺少指针输入能力，请更换支持设备。'; $('start').disabled = true; }
  record('settings-ready', settings.backend);
  readyMs = performance.now() - startupMs;
}).catch(error => { $('message').textContent = '设置初始化失败：' + error.message; });
