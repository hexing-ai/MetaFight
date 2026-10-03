/**
 * The same game on a phone.
 *
 * Two thumbs and no keyboard, so: the left half of the picture is a stick that
 * appears wherever it is first touched and walks you about, the right half is
 * the aim, and the buttons that have to be pressed at the same time as both of
 * those - fire, jump, weapon - are along the bottom right where a thumb already
 * is.
 *
 * The look is the hard part. A stick would be miserable, so dragging the right
 * side turns the view directly, and a short tap in that half fires: on a phone
 * the thing you most want after pointing at somebody is to shoot them, and
 * reaching for a button loses the aim.
 *
 * Which way the drag goes is not the same question as it is for a mouse. A mouse
 * is a pointer and you push the view with it; a thumb on glass is holding the
 * scene, so pulling it to the left brings the room to the left, which turns you
 * right. Both conventions have their people - `Invert Y` in the menu flips the
 * vertical half back - but this is the one that survived being played on a
 * phone.
 */

import { BTN, PITCH_LIMIT, YAW_UNITS } from './constants.js';
import { wrapYaw } from './input.js';

export class Touch {
  constructor(root, canvas) {
    this.root = root;
    this.canvas = canvas;
    this.enabled = false;
    this.moveId = null;
    this.lookId = null;
    this.moveFrom = { x: 0, y: 0 };
    this.moveAt = { x: 0, y: 0 };
    this.lookAt = { x: 0, y: 0 };
    this.lookStart = 0;
    this.lookMoved = 0;
    this.tapFire = 0;
    this.buttons = new Set();

    this.stick = root.querySelector('#stick');
    this.knob = root.querySelector('#knob');

    for (const el of root.querySelectorAll('[data-touch]')) {
      const action = el.dataset.touch;
      const press = (on) => (e) => {
        e.preventDefault();
        if (on) this.buttons.add(action); else this.buttons.delete(action);
        el.classList.toggle('held', on);
      };
      el.addEventListener('pointerdown', press(true));
      el.addEventListener('pointerup', press(false));
      el.addEventListener('pointercancel', press(false));
      el.addEventListener('pointerleave', press(false));
    }

    this.onDown = (e) => this.down(e);
    this.onMove = (e) => this.move(e);
    this.onUp = (e) => this.up(e);
  }

  /** Is this a machine that wants thumbs? Asked once, and overridable. */
  static wanted() {
    if (typeof window === 'undefined') return false;
    const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
    const touch = navigator.maxTouchPoints > 0;
    return !!(coarse && touch);
  }

  /**
   * Is this pointer a thumb?
   *
   * A machine can have both. A touchscreen laptop gets the thumb controls
   * automatically, and if this layer also swallowed the mouse then the mouse
   * would stop working the moment the thumbs appeared - no pointer lock, no
   * look, nothing. So it takes touches and pens and leaves the mouse to the
   * mouse, and the two work at the same time.
   */
  mine(e) {
    return !e.pointerType || e.pointerType === 'touch' || e.pointerType === 'pen';
  }

  attach() {
    this.enabled = true;
    this.root.classList.remove('hidden');
    this.canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove, { passive: false });
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
  }

  detach() {
    this.enabled = false;
    this.root.classList.add('hidden');
    this.canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    this.moveId = null;
    this.lookId = null;
    this.buttons.clear();
  }

  down(e) {
    if (!this.enabled || !this.mine(e)) return;
    const half = window.innerWidth / 2;
    if (e.clientX < half && this.moveId === null) {
      this.moveId = e.pointerId;
      this.moveFrom = { x: e.clientX, y: e.clientY };
      this.moveAt = { x: e.clientX, y: e.clientY };
      if (this.stick) {
        this.stick.style.left = `${e.clientX}px`;
        this.stick.style.top = `${e.clientY}px`;
        this.stick.classList.add('on');
      }
      e.preventDefault();
    } else if (e.clientX >= half && this.lookId === null) {
      this.lookId = e.pointerId;
      this.lookAt = { x: e.clientX, y: e.clientY };
      this.lookStart = performance.now();
      this.lookMoved = 0;
      e.preventDefault();
    }
  }

  move(e) {
    if (!this.enabled || !this.mine(e)) return;
    if (e.pointerId === this.moveId) {
      this.moveAt = { x: e.clientX, y: e.clientY };
      if (this.knob) {
        const dx = Math.max(-46, Math.min(46, e.clientX - this.moveFrom.x));
        const dy = Math.max(-46, Math.min(46, e.clientY - this.moveFrom.y));
        this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      }
      e.preventDefault();
    } else if (e.pointerId === this.lookId) {
      const dx = e.clientX - this.lookAt.x;
      const dy = e.clientY - this.lookAt.y;
      this.lookAt = { x: e.clientX, y: e.clientY };
      this.lookMoved += Math.abs(dx) + Math.abs(dy);
      this.dyaw = (this.dyaw || 0) + dx;
      this.dpitch = (this.dpitch || 0) + dy;
      e.preventDefault();
    }
  }

  up(e) {
    if (e.pointerId === this.moveId) {
      this.moveId = null;
      if (this.stick) this.stick.classList.remove('on');
      if (this.knob) this.knob.style.transform = 'translate(0px, 0px)';
    } else if (e.pointerId === this.lookId) {
      // A tap rather than a drag: fire once, for two frames, so a single tick
      // of the simulation cannot miss it.
      if (this.lookMoved < 14 && performance.now() - this.lookStart < 260) this.tapFire = 3;
      this.lookId = null;
    }
  }

  /** Fold the thumbs into the mask the game reads. Called from Input.read. */
  apply(input, mask) {
    if (!this.enabled) return mask;

    if (this.moveId !== null) {
      const dx = this.moveAt.x - this.moveFrom.x;
      const dy = this.moveAt.y - this.moveFrom.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 12) {
        const nx = dx / len;
        const ny = dy / len;
        if (ny < -0.4) mask |= BTN.FWD;
        if (ny > 0.4) mask |= BTN.BACK;
        if (nx < -0.4) mask |= BTN.LEFT;
        if (nx > 0.4) mask |= BTN.RIGHT;
      }
    }

    // Degrees of view per pixel of thumb, at sensitivity 1. A tenth of a degree
    // was the first guess and it is a tenth of a degree: it takes a swipe and a
    // half across the whole right side of a phone to turn ninety degrees, and by
    // then whoever you were turning towards has shot you. This is a swipe of
    // about two centimetres for the same ninety, and the same slider in the menu
    // moves it either way.
    // The thumb has its own settings, not the mouse's: a different gain, and its
    // own idea of which way each axis goes. Yaw counts clockwise, so adding the
    // drag to it turns you the way your thumb went; pitch counts upwards, so
    // adding the drag to it looks up as the thumb goes down, which is the
    // inverted vertical nearly every phone player wants.
    const k = input.settings.touchSensitivity * (YAW_UNITS / 360) * 0.38;
    if (this.dyaw) {
      const x = input.settings.touchInvertX ? -1 : 1;
      input.yaw = wrapYaw(input.yaw + this.dyaw * k * x);
      this.dyaw = 0;
    }
    if (this.dpitch) {
      const y = input.settings.touchInvertY ? 1 : -1;
      input.pitch = Math.max(-PITCH_LIMIT,
        Math.min(PITCH_LIMIT, input.pitch + this.dpitch * k * y));
      this.dpitch = 0;
    }

    if (this.buttons.has('fire')) mask |= BTN.FIRE;
    if (this.buttons.has('jump')) mask |= BTN.JUMP;
    if (this.buttons.has('next')) mask |= BTN.NEXT;
    if (this.tapFire > 0) {
      mask |= BTN.FIRE;
      this.tapFire--;
    }
    // A button is a press, not a hold: taking the finger off is what ends it,
    // and NEXT held down would cycle the whole rack in a fifth of a second.
    this.buttons.delete('next');
    return mask;
  }
}
