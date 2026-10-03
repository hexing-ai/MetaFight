/**
 * The page: the menu, the loop, and the wiring between the parts.
 *
 * Nothing about the game is decided here. The simulation is in game/, the
 * picture is in render/, the buttons are in input.js, and this file's whole job
 * is to run one at sixty ticks a second, hand the result to the second, and take
 * the third's word for what the person wants.
 *
 * The loop is a fixed step with an accumulator, which is the only arrangement
 * that works with lockstep: the simulation must advance in whole ticks, in the
 * same order, on every machine, whatever the screen is doing. What is allowed to
 * vary with the frame rate is the picture - the camera reads the mouse directly
 * rather than the simulation, so the view turns the instant the mouse does even
 * when the tick it belongs to is still four frames away from being agreed.
 */

import { FRAME_TIME, MAX_BODIES, MAX_PLAYERS, MODES, SKILLS, TICK_RATE } from './constants.js';
import { MAPS, loadMap } from './game/maps.js';
import { createMatch } from './game/state.js';
import { step } from './game/sim.js';
import { Renderer } from './render/renderer.js';
import { Hud } from './render/hud.js';
import {
  ACTIONS, ACTION_LABELS, Input, PRESETS, clampSensitivity, keyLabel, loadSettings, saveSettings,
} from './input.js';
import { Touch } from './touch.js';
import { Audio } from './audio.js';
import { Speech } from './speech.js';
import { LINES, WORDS } from './commentary.js';
import { relayFor } from './config.js';
import { LocalTransport, OnlineTransport } from './net/transport.js';
import { Signal } from './net/signal.js';

const ui = {
  app: document.getElementById('app'),
  screen: document.getElementById('screen'),
  hud: document.getElementById('hud'),
  menu: document.getElementById('menu'),
  pause: document.getElementById('pause'),
  over: document.getElementById('over'),
  loading: document.getElementById('loading'),
  touch: document.getElementById('touch'),
  start: document.getElementById('start'),
  resume: document.getElementById('resume'),
  quit: document.getElementById('quit'),
  overBack: document.getElementById('overBack'),
  overTitle: document.getElementById('overTitle'),
  overText: document.getElementById('overText'),
  mapButtons: document.getElementById('mapButtons'),
  botButtons: document.getElementById('botButtons'),
  presetButtons: document.getElementById('presetButtons'),
  sensValue: document.getElementById('sensValue'),
  touchSensValue: document.getElementById('touchSensValue'),
  keysBody: document.getElementById('keysBody'),
  bindHint: document.getElementById('bindHint'),
  modeBlurb: document.getElementById('modeBlurb'),
  instaBlurb: document.getElementById('instaBlurb'),
  mapBlurb: document.getElementById('mapBlurb'),
  skillBlurb: document.getElementById('skillBlurb'),
  netStatus: document.getElementById('netStatus'),
  roster: document.getElementById('roster'),
  roomCode: document.getElementById('roomCode'),
  btnCreate: document.getElementById('btnCreate'),
  btnJoin: document.getElementById('btnJoin'),
};

const settings = loadSettings();
const config = {
  mode: 'dm',
  instagib: false,
  map: 'foundry',
  bots: 3,
  skill: 'normal',
  sound: true,
  voice: true,
};

const MODE_BLURB = {
  dm: 'Everybody for themselves, twenty frags, and the clock is only there so it ends.',
  tdm: 'Two sides, forty frags between them. No friendly fire, so the corridor is yours as well as theirs.',
  ctf: 'Three captures. Yours has to be on its stand for one to count, which is what makes a defender worth having.',
};

const INSTA_BLURB = {
  off: 'Four guns on the floor, and armour and health worth crossing the map for.',
  on: 'One rifle, one shot, one hit. Nothing to pick up and nowhere to hide - everything is decided by who saw whom.',
};

let renderer = null;
let hud = null;
let input = null;
let touch = null;
let audio = null;
let speech = null;
/** When the announcer's mouth is next free, on the audio clock. */
let speakAt = 0;

let state = null;
let transport = null;
let signal = null;
let seat = 0;
let room = { code: null, role: null, seats: [false, false, false, false] };

let paused = false;
let scoreboard = false;
/** What the person last pressed: 'touch', 'mouse', or nothing yet. */
let pointerKind = null;
/** ?touch=1, for photographing the phone controls from a desktop. */
let pinnedThumbs = false;
let accumulator = 0;
let lastFrame = 0;
let running = false;

// --- Setting up ---------------------------------------------------------------

function boot() {
  try {
    renderer = new Renderer(ui.screen);
  } catch (err) {
    document.body.innerHTML = `<div class="overlay"><div class="panel small"><h2>NO WEBGL</h2><p class="status">${err.message}</p></div></div>`;
    return;
  }
  hud = new Hud(ui.hud);
  input = new Input(ui.screen, settings);
  audio = new Audio();
  speech = new Speech(audio, { WORDS, LINES });
  input.attach();
  // Losing the pointer means the person has tabbed away, hit Escape, or the
  // browser took it back. Whichever it was, they are not playing any more.
  input.onLockChange = (locked) => {
    if (!locked && state && running && !paused && !input.touch) pause(true);
  };

  // The thumb controls are always built and only sometimes used, so that
  // picking up a mouse halfway through a match needs no reload.
  touch = new Touch(ui.touch, ui.screen);
  pinnedThumbs = new URLSearchParams(location.search).get('touch') === '1';
  input.touch = thumbsWanted() ? touch : null;

  // Whatever is pressed decides, from the first press onwards. Captured, and
  // before anything else sees it, so that the click which starts a match has
  // already told us which kind of machine this is.
  window.addEventListener('pointerdown', (e) => {
    const kind = e.pointerType === 'mouse' ? 'mouse' : 'touch';
    if (kind === pointerKind) return;
    pointerKind = kind;
    applyThumbs();
  }, true);

  buildMenu();
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && state) {
      pause(!paused);
      e.preventDefault();
    } else if (e.code === 'Tab' && state) {
      scoreboard = true;
      e.preventDefault();
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'Tab') scoreboard = false;
  });

  const pauseButton = document.getElementById('btnPause');
  if (pauseButton) {
    pauseButton.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (state) pause(!paused);
    });
  }

  // Clicking the picture takes the pointer, whether or not the thumbs are up:
  // the thumb layer ignores the mouse, so both can be in use on the same
  // machine.
  ui.screen.addEventListener('pointerdown', (e) => {
    if (!state) return;
    if (paused) resume();
    else if (e.pointerType === 'mouse' || !e.pointerType) input.lock();
  });

  document.body.classList.add('menu');
  requestAnimationFrame(frame);
  autoStart();
}

/**
 * Start a match straight from the address bar.
 *
 *   ?play=foundry&mode=dm&bots=5&skill=hard&insta=1&ticks=900&watch=2
 *
 * It exists for tools/screenshot.js, which drives a headless browser and cannot
 * click anything, and it is the quickest way to look at one particular corner of
 * one particular arena without playing your way to it. `ticks` fast-forwards the
 * match before the first frame is drawn; `watch` puts the camera behind one of
 * the bots, which is the only way to photograph the game being played.
 */
function autoStart() {
  const q = new URLSearchParams(location.search);
  if (!q.has('play') || q.get('nostart') === '1') return;
  config.map = q.get('play') || config.map;
  if (q.has('mode')) config.mode = q.get('mode');
  if (q.has('bots')) config.bots = Number(q.get('bots'));
  if (q.has('skill')) config.skill = q.get('skill');
  if (q.has('insta')) config.instagib = q.get('insta') === '1';
  if (q.get('sound') === '0') config.sound = false;
  const watch = q.has('watch') ? Number(q.get('watch')) : 0;
  const fast = q.has('ticks') ? Number(q.get('ticks')) : 0;
  const seed = q.has('seed') ? Number(q.get('seed')) : 20260909;

  begin({ seats: 1, seatIndex: 0, seed });
  // begin() waits two frames for the browser to paint, so this does too.
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => {
    if (!state) return;
    for (let i = 0; i < fast; i++) {
      transport.sample(state.tick);
      remember();
      step(state, transport.poll(state.tick));
      if (state.phase === 'over') break;
    }
    if (watch > 0 && state.bodies[watch]) {
      // Hand the camera to a bot, and let it keep driving itself. If it happens
      // to be face down at that moment, wait for it: a photograph of the
      // respawn counter is a photograph of nothing.
      seat = watch;
      const body = state.bodies[watch];
      let guard = 0;
      while ((!body.alive || body.shield > 0) && guard++ < 600) {
        transport.sample(state.tick);
        remember();
        step(state, transport.poll(state.tick));
      }
      input.setAim(body.yaw, body.pitch);

      // Wind on until something worth photographing happens to them. This is
      // how the announcer gets its picture: a real double kill, found by
      // waiting for one, rather than a caption pasted over a quiet frame.
      const until = q.get('until');
      if (until) {
        let guard = 0;
        let found = false;
        while (!found && guard++ < 30000) {
          transport.sample(state.tick);
          remember();
          step(state, transport.poll(state.tick));
          for (const e of state.events) {
            if (e.type === until && e.body === watch) found = true;
          }
          // Only the HUD is fed: it is the thing that shows the announcement,
          // and the renderer's effects would pile up unaged for as long as this
          // loop runs, which is a lot of sparks nobody will ever see.
          hud.addEvents(state, state.events, seat);
        }
        renderer.effects.length = 0;
      }
    }
    // Stop the clock, if asked. A photograph of a match that is still running is
    // a photograph of whatever happened between the shutter and the file.
    if (q.get('freeze') === '1') running = false;
    // Hung off the window on purpose, and only on this path: tools/keytest and
    // anybody debugging in the console want to look at the match, and there is
    // no other way in - the module keeps it to itself.
    window.__ready = true;
  }, 60)));
}

/**
 * Whether this machine gets thumbs - decided by what is being used, not by what
 * the machine says it is.
 *
 * Asking the browser is the usual way and it is a guess: a touchscreen laptop
 * answers one thing and its owner does another, and a tablet with a keyboard
 * case changes its mind when the case is folded back. So the browser is asked
 * once, for the very first frame, and after that whatever was last pressed
 * decides. Touch the screen and the thumb controls appear; press the mouse and
 * they go away and it takes the pointer instead. Both work on the same machine,
 * in the same match, and nobody has to find a setting for it.
 */
function thumbsWanted() {
  if (pinnedThumbs) return true;
  if (pointerKind === 'touch') return true;
  if (pointerKind === 'mouse') return false;
  return Touch.wanted();
}

function applyThumbs() {
  const want = thumbsWanted();
  if (input.touch === (want ? touch : null)) return;
  input.touch = want ? touch : null;
  if (want) {
    if (state && running) touch.attach();
    // A locked pointer is no use to a thumb, and it hides the cursor of the
    // mouse that has just been put down.
    input.unlock();
  } else {
    touch.detach();
    // Reached from a pointerdown, so the gesture is still warm and this is
    // allowed - which is the whole lesson of the FIGHT handler above.
    if (state && running && !paused) input.lock();
  }
}

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = ui.app.clientWidth;
  const h = ui.app.clientHeight;
  renderer.resize(w, h, dpr);
  hud.resize(w, h, dpr);
}

// --- The menu -----------------------------------------------------------------

function buildMenu() {
  for (const map of MAPS) {
    const b = document.createElement('button');
    b.dataset.map = map.key;
    b.textContent = map.name;
    ui.mapButtons.appendChild(b);
  }
  for (let n = 0; n <= MAX_BODIES - 1; n++) {
    const b = document.createElement('button');
    b.dataset.bots = String(n);
    b.textContent = String(n);
    ui.botButtons.appendChild(b);
  }
  for (const preset of PRESETS) {
    const b = document.createElement('button');
    b.dataset.preset = preset.key;
    b.textContent = preset.label;
    ui.presetButtons.appendChild(b);
  }

  ui.menu.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.mode) config.mode = d.mode;
    else if (d.insta) config.instagib = d.insta === 'on';
    else if (d.map) config.map = d.map;
    else if (d.bots) config.bots = Number(d.bots);
    else if (d.bots === '0') config.bots = 0;
    else if (d.skill) config.skill = d.skill;
    else if (d.sound) config.sound = d.sound === 'on';
    else if (d.voice) config.voice = d.voice === 'on';
    else if (d.sens) {
      settings.sensitivity = d.sens === 'reset' ? 1
        : clampSensitivity(settings.sensitivity + Number(d.sens));
    } else if (d.touchsens) {
      settings.touchSensitivity = d.touchsens === 'reset' ? 1
        : clampSensitivity(settings.touchSensitivity + Number(d.touchsens));
    } else if (d.invert) settings.invert = d.invert === 'on';
    else if (d.tinvertx) settings.touchInvertX = d.tinvertx === 'on';
    else if (d.tinverty) settings.touchInvertY = d.tinverty === 'on';

    else if (d.preset) {
      const preset = PRESETS.find((p) => p.key === d.preset);
      if (preset) settings.bindings = { ...preset.bindings };
    } else return;
    if (d.sens || d.touchsens || d.invert || d.tinvertx || d.tinverty || d.preset) {
      saveSettings(settings);
    }
    // Flag matches need a map with flags in it, and nothing else will do.
    if (config.mode === 'ctf' && !loadMap(config.map).flagMap) config.map = 'bastion';
    if (config.mode !== 'ctf' && !MAPS.find((m) => m.key === config.map).modes.includes(config.mode)) {
      config.map = 'foundry';
    }
    refreshMenu();
  });

  ui.start.addEventListener('click', () => {
    audio.start();
    // The pointer is asked for here, inside the click, and not later when the
    // match is ready. Pointer lock needs a user gesture in the task that asks
    // for it, and by the time begin() has waited two frames and baked the
    // light, the gesture is gone: Chrome answers "A user gesture is required to
    // request Pointer Lock", the promise rejects, and the only symptom is a
    // mouse that does nothing at all.
    if (!thumbsWanted()) input.lock();
    if (signal && room.code && room.role === 'host') hostStart();
    else if (signal && room.code) ui.netStatus.textContent = 'Waiting for whoever opened the room to start it.';
    else begin({ seats: 1, seatIndex: 0, seed: (Math.random() * 2 ** 31) | 0 });
  });

  ui.resume.addEventListener('click', resume);
  ui.quit.addEventListener('click', toMenu);
  ui.overBack.addEventListener('click', toMenu);
  ui.btnCreate.addEventListener('click', () => connect('create'));
  ui.btnJoin.addEventListener('click', () => connect('join'));

  refreshMenu();
}

function refreshMenu() {
  const map = loadMap(config.map);
  const mark = (selector, on) => {
    for (const b of ui.menu.querySelectorAll(selector)) {
      b.classList.toggle('active', on(b.dataset));
    }
  };
  mark('[data-mode]', (d) => d.mode === config.mode);
  mark('[data-insta]', (d) => (d.insta === 'on') === config.instagib);
  mark('[data-map]', (d) => d.map === config.map);
  mark('[data-bots]', (d) => Number(d.bots) === config.bots);
  mark('[data-skill]', (d) => d.skill === config.skill);
  mark('[data-sound]', (d) => (d.sound === 'on') === config.sound);
  mark('[data-voice]', (d) => (d.voice === 'on') === config.voice);
  mark('[data-invert]', (d) => (d.invert === 'on') === settings.invert);
  mark('[data-tinvertx]', (d) => (d.tinvertx === 'on') === settings.touchInvertX);
  mark('[data-tinverty]', (d) => (d.tinverty === 'on') === settings.touchInvertY);
  ui.sensValue.textContent = `${settings.sensitivity.toFixed(1)}×`;
  ui.touchSensValue.textContent = `${settings.touchSensitivity.toFixed(1)}×`;

  for (const b of ui.mapButtons.querySelectorAll('button')) {
    const def = MAPS.find((m) => m.key === b.dataset.map);
    const ok = config.mode === 'ctf' ? loadMap(def.key).flagMap : def.modes.includes(config.mode);
    b.disabled = !ok;
  }

  ui.modeBlurb.textContent = MODE_BLURB[config.mode];
  ui.instaBlurb.textContent = INSTA_BLURB[config.instagib ? 'on' : 'off'];
  ui.mapBlurb.textContent = map.blurb;
  ui.skillBlurb.textContent = {
    easy: 'They will let you look at the map.',
    normal: 'They lead their shots and they know where the armour is.',
    hard: 'They hit what they aim at and they take the high ground first.',
    brutal: 'They do not miss. This is not a difficulty, it is a demonstration.',
  }[config.skill];

  buildKeyTable();
}

function buildKeyTable() {
  ui.keysBody.innerHTML = '';
  for (const action of ACTIONS) {
    const tr = document.createElement('tr');
    const label = document.createElement('td');
    label.textContent = ACTION_LABELS[action];
    const cell = document.createElement('td');
    const b = document.createElement('button');
    b.textContent = keyLabel(settings.bindings[action]);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      ui.bindHint.textContent = `Press a key for ${ACTION_LABELS[action]}, or Escape to leave it.`;
      b.textContent = '…';
      const grab = (ev) => {
        ev.preventDefault();
        window.removeEventListener('keydown', grab, true);
        window.removeEventListener('mousedown', grabMouse, true);
        if (ev.code !== 'Escape') settings.bindings[action] = ev.code;
        saveSettings(settings);
        ui.bindHint.textContent = 'Click a key to change it.';
        buildKeyTable();
      };
      const grabMouse = (ev) => {
        ev.preventDefault();
        window.removeEventListener('keydown', grab, true);
        window.removeEventListener('mousedown', grabMouse, true);
        settings.bindings[action] = `Mouse${ev.button}`;
        saveSettings(settings);
        ui.bindHint.textContent = 'Click a key to change it.';
        buildKeyTable();
      };
      window.addEventListener('keydown', grab, true);
      setTimeout(() => window.addEventListener('mousedown', grabMouse, true), 60);
    });
    cell.appendChild(b);
    tr.appendChild(label);
    tr.appendChild(cell);
    ui.keysBody.appendChild(tr);
  }
}

// --- A match ------------------------------------------------------------------

function begin({ seats, seatIndex, seed, over }) {
  ui.loading.classList.remove('hidden');
  ui.menu.classList.add('hidden');
  // A frame for the browser to paint "building the arena" before the light bake
  // takes the thread for a fifth of a second.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const opts = over || config;
    const humans = new Array(seats).fill(true);
    const bots = Math.min(MAX_BODIES - seats, opts.bots);
    state = createMatch({
      seed,
      map: opts.map,
      mode: opts.mode,
      instagib: opts.instagib,
      skill: opts.skill,
      humans,
      bots,
      names: humans.map((_, i) => (i === seatIndex ? 'You' : `Player ${i + 1}`)),
    });
    seat = seatIndex;
    renderer.setMap(opts.map);
    hud.feed.length = 0;
    hud.shout = null;

    if (signal && room.code) {
      transport = new OnlineTransport({ signal, input, seats, localSeat: seatIndex });
    } else {
      transport = new LocalTransport(input, seatIndex);
    }

    const me = state.bodies[seatIndex];
    input.setAim(me.yaw, 0);
    audio.on = config.sound;
    if (config.sound) audio.start();

    // Hung off the window on purpose: tools/keytest.js and anybody debugging in
    // the console want to be able to look at the match, and the module keeps it
    // to itself otherwise.
    window.__state = state;
    accumulator = 0;
    lastFrame = performance.now();
    running = true;
    paused = false;
    ui.loading.classList.add('hidden');
    ui.over.classList.add('hidden');
    ui.pause.classList.add('hidden');
    document.body.classList.remove('menu');
    if (input.touch) input.touch.attach();
    else input.lock();
  }));
}

function pause(on) {
  if (!state || !running) return;
  paused = on;
  ui.pause.classList.toggle('hidden', !on);
  if (on) input.unlock();
  else if (!input.touch) input.lock();
}

function resume() {
  pause(false);
}

function toMenu() {
  running = false;
  state = null;
  if (transport) transport.dispose();
  transport = null;
  paused = false;
  ui.pause.classList.add('hidden');
  ui.over.classList.add('hidden');
  ui.menu.classList.remove('hidden');
  document.body.classList.add('menu');
  input.unlock();
  touch.detach();
  refreshMenu();
}

function finish() {
  running = false;
  const mode = MODES[state.config.mode];
  ui.overTitle.textContent = 'MATCH OVER';
  if (mode.teams) {
    ui.overText.textContent = state.winner < 0 ? 'A draw.'
      : `${state.winner === 0 ? 'Red' : 'Blue'} wins, ${state.teamScore[0]} - ${state.teamScore[1]}.`;
  } else {
    const winner = state.bodies[state.winner];
    ui.overText.textContent = `${winner.name} wins with ${winner.score}.`;
  }
  ui.over.classList.remove('hidden');
  input.unlock();
}

// --- The loop -----------------------------------------------------------------

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (!state) return;

  const stepSeconds = FRAME_TIME / 1000;
  if (running && !paused) {
    accumulator += dt;
    let steps = 0;
    // Six at a time at most: a tab that has been in the background for a minute
    // should carry on from where the match got to, not simulate the minute.
    while (accumulator >= stepSeconds && steps < 6) {
      transport.sample(state.tick);
      if (!transport.ready(state.tick)) break;
      remember();
      step(state, transport.poll(state.tick));
      transport.afterStep(state);
      renderer.addEvents(state, state.events, seat);
      hud.addEvents(state, state.events, seat);
      audio.play(state, state.events, seat);
      callOut(state, state.events);
      accumulator -= stepSeconds;
      steps++;
      if (state.phase === 'over' && state.phaseTimer <= 0) { finish(); break; }
    }
  }

  renderer.step(dt);
  const me = state.bodies[seat];
  const look = input.read();
  const alpha = Math.max(0, Math.min(1, accumulator / stepSeconds));
  renderer.draw(state, {
    index: seat,
    dt,
    alpha,
    // The camera is the mouse, not the simulation. Online that is four ticks
    // ahead of the body it belongs to, and it is the right way round.
    yaw: transport.online || !me.human ? me.yaw : look.yaw,
    pitch: transport.online || !me.human ? me.pitch : look.pitch,
  });
  hud.draw(state, {
    index: seat, time: renderer.time, scoreboard, touch: !!input.touch, locked: input.locked,
  });
  audio.setListener(me.x, me.y + 1.6, me.z,
    Math.cos((me.yaw / 65536) * Math.PI * 2), Math.sin((me.yaw / 65536) * Math.PI * 2));
  audio.steps(me, renderer.time);
}

/**
 * The announcer.
 *
 * He speaks about your kills and everybody's flags, which is the division
 * Unreal Tournament settled on and the reason it works: a voice that announced
 * every double kill in a four player match would be talking over itself, and a
 * voice that ignored the flag would be no use to the two people chasing it.
 *
 * If he is already speaking the next thing waits its turn, and if the queue gets
 * more than a couple of lines behind, whatever is at the back of it is dropped.
 * Being told about a spree that ended four seconds ago is worse than not being
 * told.
 */
function callOut(state, events) {
  if (!config.voice || !audio.ctx || !speech) return;
  const teams = MODES[state.config.mode].teams;
  const me = state.bodies[seat];

  const say = (key) => {
    const now = audio.ctx.currentTime;
    if (speakAt < now) speakAt = now;
    if (speakAt > now + 2.4) return; // too far behind to be worth hearing
    speech.say(key, speakAt);
    speakAt += 1.15;
  };
  const side = (team) => (team === 0 ? 'Red' : 'Blue');

  for (const e of events) {
    switch (e.type) {
      case 'begin': say('fight'); break;
      case 'firstblood': say('firstblood'); break;
      case 'multi': if (e.body === seat) say(`multi${e.count}`); break;
      case 'spree': if (e.body === seat) say(`spree${e.count}`); break;
      case 'spreeend': if (e.killer === seat) say('spreeend'); break;
      case 'revenge': if (e.body === seat) say('revenge'); break;
      case 'take': say(`taken${side(e.team)}`); break;
      case 'return': say(`return${side(e.team)}`); break;
      case 'drop': say(`drop${side(e.team)}`); break;
      case 'capture': say(`score${side(e.team)}`); break;
      case 'over': {
        const won = teams ? e.winner === me.team : e.winner === seat;
        say(won ? 'won' : 'lost');
        break;
      }
      default: break;
    }
  }
}

/** Where everything was last tick, so the picture can sit between two of them. */
function remember() {
  for (const body of state.bodies) {
    body.px = body.x;
    body.py = body.y;
    body.pz = body.z;
    body.pyaw = body.yaw;
  }
  for (const p of state.projectiles) {
    p.px = p.x;
    p.py = p.y;
    p.pz = p.z;
  }
}

// --- Playing with other people ------------------------------------------------

function connect(what) {
  audio.start();
  const url = relayFor(location);
  if (!url) {
    ui.netStatus.textContent = 'MetaFight M0 is an offline baseline. Online play is disabled.';
    return;
  }
  if (signal) signal.close();
  ui.netStatus.textContent = 'Connecting…';
  signal = new Signal(url);

  signal.on('open', () => {
    if (what === 'create') signal.create();
    else signal.join(ui.roomCode.value);
  });
  signal.on('room', (m) => {
    room = { code: m.code, role: m.role, seats: m.seats };
    seat = m.seat;
    ui.roomCode.value = m.code;
    showRoom();
  });
  signal.on('peer', (m) => {
    room.seats = m.seats;
    showRoom();
  });
  signal.on('peerleft', (m) => {
    room.seats = m.seats;
    showRoom();
  });
  signal.on('error', (m) => {
    ui.netStatus.textContent = m.msg || 'Something went wrong.';
  });
  signal.on('close', () => {
    room = { code: null, role: null, seats: [false, false, false, false] };
    ui.netStatus.textContent = 'Disconnected.';
    ui.roster.innerHTML = '';
  });
  signal.on('start', (m) => {
    if (room.role === 'host') return; // we sent it
    begin({ seats: m.seats, seatIndex: seat, seed: m.seed, over: m.config });
  });
}

function showRoom() {
  const taken = room.seats.filter(Boolean).length;
  ui.netStatus.textContent = room.role === 'host'
    ? `Room ${room.code} is open. ${taken} here. Press FIGHT when everybody has arrived.`
    : `In room ${room.code}, seat ${seat + 1}. Waiting for the start.`;
  ui.roster.innerHTML = '';
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const span = document.createElement('span');
    span.textContent = room.seats[i] ? `Player ${i + 1}` : 'empty';
    span.className = `${room.seats[i] ? 'taken' : ''} ${i === seat ? 'you' : ''}`;
    ui.roster.appendChild(span);
  }
}

function hostStart() {
  const seats = room.seats.lastIndexOf(true) + 1;
  const seed = (Math.random() * 2 ** 31) | 0;
  signal.send({
    t: 'start', seats, seed, config: { ...config },
  });
  begin({ seats, seatIndex: seat, seed });
}

boot();
