/**
 * The buttons, the mouse and the gamepad, turned into the three numbers the
 * simulation takes: a bitmask, a yaw and a pitch.
 *
 * Where you are looking is not a button and it does not go through the
 * simulation's turn rate - the mouse has already decided, and what travels is
 * the angle it decided on, as an integer. That matters for two reasons. Online,
 * an angle sent as a float is an angle two machines round differently, and two
 * machines that disagree about an angle disagree about who got shot. Locally, it
 * is what makes the aim feel like a mouse pointer rather than like a tank
 * turret: the picture turns on the frame the mouse moved, at the mouse's own
 * resolution, whatever the tick rate is doing.
 */

import { BTN, PITCH_LIMIT, YAW_UNITS } from './constants.js';

export const ACTIONS = ['fwd', 'back', 'left', 'right', 'jump', 'fire', 'next', 'prev', 'w1', 'w2', 'w3', 'w4'];

export const ACTION_BIT = {
  fwd: BTN.FWD,
  back: BTN.BACK,
  left: BTN.LEFT,
  right: BTN.RIGHT,
  jump: BTN.JUMP,
  fire: BTN.FIRE,
  next: BTN.NEXT,
  prev: BTN.PREV,
  w1: BTN.W1,
  w2: BTN.W2,
  w3: BTN.W3,
  w4: BTN.W4,
};

export const ACTION_LABELS = {
  fwd: 'Forward',
  back: 'Back',
  left: 'Left',
  right: 'Right',
  jump: 'Jump',
  fire: 'Fire',
  next: 'Next weapon',
  prev: 'Last weapon',
  w1: 'Autogun',
  w2: 'Scattergun',
  w3: 'Rockets',
  w4: 'Rail rifle',
};

export const PRESETS = [
  {
    key: 'wasd',
    label: 'W A S D + mouse',
    bindings: {
      fwd: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space',
      fire: 'Mouse0', next: 'KeyE', prev: 'KeyQ',
      w1: 'Digit1', w2: 'Digit2', w3: 'Digit3', w4: 'Digit4',
    },
  },
  {
    key: 'esdf',
    label: 'E S D F + mouse',
    bindings: {
      fwd: 'KeyE', back: 'KeyD', left: 'KeyS', right: 'KeyF', jump: 'Space',
      fire: 'Mouse0', next: 'KeyR', prev: 'KeyW',
      w1: 'Digit1', w2: 'Digit2', w3: 'Digit3', w4: 'Digit4',
    },
  },
  {
    key: 'arrows',
    label: 'Arrows + right hand',
    bindings: {
      fwd: 'ArrowUp', back: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', jump: 'ShiftRight',
      fire: 'Mouse0', next: 'Period', prev: 'Comma',
      w1: 'Digit1', w2: 'Digit2', w3: 'Digit3', w4: 'Digit4',
    },
  },
];

const STORAGE_KEY = 'webreal.controls.v1';

export function defaultBindings() {
  return { ...PRESETS[0].bindings };
}

/**
 * What each device is set to.
 *
 * The mouse and the thumb are two different instruments and they do not share a
 * number. A mouse is a pointer you push the view with; a thumb on glass is
 * holding the scene, so it wants the opposite sign and about a fifth of the
 * gain. Anybody testing the phone controls on a laptop touchpad meets both
 * conventions in the same hour, which is the whole reason these are separate.
 */
export function loadSettings(key = STORAGE_KEY) {
  const fallback = {
    bindings: defaultBindings(),
    // Mouse and gamepad.
    sensitivity: 1.0,
    invert: false,
    // Thumbs. Normal means the mouse's convention - drag right, turn right -
    // and the vertical is inverted by default because that is what nearly
    // everybody wants from a thumb: drag down, look up, as though the screen
    // were being tipped.
    touchSensitivity: 1.0,
    touchInvertX: false,
    touchInvertY: true,
  };
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return fallback;
    const saved = JSON.parse(raw);
    // Copied across one field at a time: anything missing or malformed in
    // storage quietly keeps its default rather than breaking the controls.
    for (const action of ACTIONS) {
      const code = saved?.bindings?.[action];
      if (typeof code === 'string' && code) fallback.bindings[action] = code;
    }
    if (Number.isFinite(saved?.sensitivity)) {
      fallback.sensitivity = clampSensitivity(saved.sensitivity);
    }
    if (Number.isFinite(saved?.touchSensitivity)) {
      fallback.touchSensitivity = clampSensitivity(saved.touchSensitivity);
    }
    fallback.invert = !!saved?.invert;
    // The two thumb axes used to be one setting called touchHold, which said
    // "the drag holds the scene" and did not. Anything stored under the old
    // name is read as what it actually did.
    if (saved?.touchHold !== undefined) {
      fallback.touchInvertX = !saved.touchHold;
      fallback.touchInvertY = !saved.touchInvertY;
    }
    if (saved?.touchInvertX !== undefined) fallback.touchInvertX = !!saved.touchInvertX;
    if (saved?.touchInvertY !== undefined && saved?.touchHold === undefined) {
      fallback.touchInvertY = !!saved.touchInvertY;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export function saveSettings(settings, key = STORAGE_KEY) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(settings));
  } catch { /* private mode, storage full: not worth interrupting a game for */ }
}

export const SENSITIVITY_MIN = 0.1;
export const SENSITIVITY_MAX = 6;

/** Kept inside the range the steppers can reach, and to one decimal place: a
 *  sensitivity of 1.2000000000000002 in a menu is a bug people report. */
export function clampSensitivity(value) {
  const v = Math.max(SENSITIVITY_MIN, Math.min(SENSITIVITY_MAX, Number(value) || 1));
  return Math.round(v * 10) / 10;
}

/** Keys the browser does something else with, swallowed whether bound or not. */
const ALWAYS_SWALLOW = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

export function keyLabel(code) {
  if (!code) return '—';
  const named = {
    Space: 'Space',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    ShiftLeft: 'L Shift',
    ShiftRight: 'R Shift',
    ControlLeft: 'L Ctrl',
    ControlRight: 'R Ctrl',
    Mouse0: 'Left click',
    Mouse1: 'Middle click',
    Mouse2: 'Right click',
    Period: '.',
    Comma: ',',
  };
  if (named[code]) return named[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

/**
 * Everything a person can press, in one place.
 *
 * It holds the aim, because the aim is a running total rather than a state:
 * the mouse reports how far it moved, never where it is.
 */
export class Input {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    this.down = new Set();
    this.pressed = new Set();
    this.yaw = 0;
    this.pitch = 0;
    this.locked = false;
    this.lockRefused = null;
    this.wheel = 0;
    this.touch = null;
    this.onLockChange = null;

    this.handlers = {
      keydown: (e) => {
        if (e.repeat) return;
        this.down.add(e.code);
        if (ALWAYS_SWALLOW.has(e.code) || this.isBound(e.code)) e.preventDefault();
      },
      keyup: (e) => {
        this.down.delete(e.code);
        if (ALWAYS_SWALLOW.has(e.code) || this.isBound(e.code)) e.preventDefault();
      },
      blur: () => this.down.clear(),
      mousedown: (e) => {
        this.down.add(`Mouse${e.button}`);
        if (this.locked) e.preventDefault();
      },
      mouseup: (e) => this.down.delete(`Mouse${e.button}`),
      contextmenu: (e) => { if (this.locked) e.preventDefault(); },
      mousemove: (e) => {
        if (!this.locked) return;
        // Degrees of view per pixel of pointer movement, at sensitivity 1.
        //
        // This was 0.022, on the theory that a pixel here is a mouse count and
        // that is what other shooters call "1". A pixel here is not a mouse
        // count: under pointer lock the browser reports movement in CSS pixels,
        // after the operating system's acceleration curve, and on a touchpad
        // that is a few hundred of them for a whole swipe of the pad. Measured,
        // the old number turned the view four degrees for two hundred pixels,
        // which on a touchpad is indistinguishable from the mouse not working.
        // At this one the same swipe is worth about a third of a turn, and the
        // stepper in the menu reaches an eighth of it and six times it.
        const k = this.settings.sensitivity * (YAW_UNITS / 360) * 0.16;
        // Yaw counts clockwise: raising it turns you right, which is what the
        // camera does with it. Taking movementX away from it therefore turned
        // the view left when the mouse went right, for the whole of this game's
        // short life, and the test that was meant to cover it had been written
        // from the same assumption instead of from the camera.
        this.yaw = wrapYaw(this.yaw + e.movementX * k);
        const dy = e.movementY * k * (this.settings.invert ? -1 : 1);
        this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - dy));
      },
      wheel: (e) => {
        if (!this.locked) return;
        this.wheel += e.deltaY > 0 ? 1 : -1;
        e.preventDefault();
      },
      pointerlockchange: () => {
        this.locked = document.pointerLockElement === this.canvas;
        if (this.locked) this.lockRefused = null;
        if (!this.locked) this.down.clear();
        if (this.onLockChange) this.onLockChange(this.locked);
      },
    };
  }

  attach() {
    window.addEventListener('keydown', this.handlers.keydown, { passive: false });
    window.addEventListener('keyup', this.handlers.keyup, { passive: false });
    window.addEventListener('blur', this.handlers.blur);
    window.addEventListener('mousedown', this.handlers.mousedown);
    window.addEventListener('mouseup', this.handlers.mouseup);
    window.addEventListener('contextmenu', this.handlers.contextmenu);
    window.addEventListener('mousemove', this.handlers.mousemove);
    window.addEventListener('wheel', this.handlers.wheel, { passive: false });
    document.addEventListener('pointerlockchange', this.handlers.pointerlockchange);
  }

  detach() {
    window.removeEventListener('keydown', this.handlers.keydown);
    window.removeEventListener('keyup', this.handlers.keyup);
    window.removeEventListener('blur', this.handlers.blur);
    window.removeEventListener('mousedown', this.handlers.mousedown);
    window.removeEventListener('mouseup', this.handlers.mouseup);
    window.removeEventListener('contextmenu', this.handlers.contextmenu);
    window.removeEventListener('mousemove', this.handlers.mousemove);
    window.removeEventListener('wheel', this.handlers.wheel);
    document.removeEventListener('pointerlockchange', this.handlers.pointerlockchange);
  }

  isBound(code) {
    for (const action of ACTIONS) if (this.settings.bindings[action] === code) return true;
    return false;
  }

  /**
   * Ask for the pointer.
   *
   * It can be refused - the commonest reason being that whatever gesture led
   * here has already expired - and a refusal used to be swallowed whole, which
   * made it look exactly like a broken mouse. It is remembered now, and the HUD
   * says so.
   */
  lock() {
    if (this.locked) return;
    const request = this.canvas.requestPointerLock?.bind(this.canvas);
    if (!request) return;
    try {
      const result = request();
      if (result && typeof result.catch === 'function') {
        result.catch((err) => { this.lockRefused = err?.message || 'refused'; });
      }
    } catch (err) {
      this.lockRefused = err?.message || 'refused';
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Face this way, please. Used when the match starts or a body respawns. */
  setAim(yaw, pitch = 0) {
    this.yaw = wrapYaw(yaw);
    this.pitch = pitch;
  }

  /** The one call the game loop makes: what is being asked for, right now. */
  read() {
    let mask = 0;
    for (const action of ACTIONS) {
      const code = this.settings.bindings[action];
      if (code && this.down.has(code)) mask |= ACTION_BIT[action];
    }

    // The wheel picks weapons, one notch per step, and is consumed as it is
    // read so a flick of it cannot be counted twice.
    if (this.wheel > 0) { mask |= BTN.NEXT; this.wheel--; } else if (this.wheel < 0) { mask |= BTN.PREV; this.wheel++; }

    if (this.touch) mask = this.touch.apply(this, mask);
    mask = this.readPad(mask);

    return { b: mask, yaw: wrapYaw(this.yaw), pitch: Math.round(this.pitch) };
  }

  /**
   * A gamepad, if one is plugged in. No setting up: the left stick walks, the
   * right stick looks, the right trigger fires, the bottom button jumps.
   */
  readPad(mask) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const dead = (v) => (Math.abs(v) < 0.22 ? 0 : v);
      const lx = dead(pad.axes[0] || 0);
      const ly = dead(pad.axes[1] || 0);
      const rx = dead(pad.axes[2] || 0);
      const ry = dead(pad.axes[3] || 0);
      if (ly < 0) mask |= BTN.FWD;
      if (ly > 0) mask |= BTN.BACK;
      if (lx < 0) mask |= BTN.LEFT;
      if (lx > 0) mask |= BTN.RIGHT;
      // A stick is a rate, not a position, so it is squared to give some
      // control near the middle and all of it at the edge.
      const k = this.settings.sensitivity * 620;
      this.yaw = wrapYaw(this.yaw + rx * Math.abs(rx) * k);
      const dy = ry * Math.abs(ry) * k * (this.settings.invert ? -1 : 1);
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - dy));
      if (pad.buttons[0]?.pressed) mask |= BTN.JUMP;
      if (pad.buttons[7]?.pressed || pad.buttons[5]?.pressed) mask |= BTN.FIRE;
      if (pad.buttons[4]?.pressed) mask |= BTN.PREV;
      if (pad.buttons[6]?.pressed) mask |= BTN.NEXT;
      break;
    }
    return mask;
  }
}

export function wrapYaw(value) {
  const v = Math.round(value) % YAW_UNITS;
  return v < 0 ? v + YAW_UNITS : v;
}
