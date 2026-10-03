/**
 * The noise, synthesised.
 *
 * No files, for the same reason there are no textures on disk: a game that is
 * one folder of source is a game you can read. Everything here is an oscillator,
 * a burst of noise, and a filter with an envelope on it - which is enough for a
 * gun, a rocket, a footstep and a klaxon, and not enough for anything anybody
 * would call music.
 *
 * The one thing worth saying about the arrangement: every sound is positioned.
 * A shot forty metres away behind you is quieter and to the left, and in an
 * arena where you are usually being shot from somewhere you cannot see, that is
 * not decoration - it is the only warning you get.
 */

import { WEAPONS } from './constants.js';

export class Audio {
  constructor() {
    this.ctx = null;
    this.on = true;
    this.volume = 0.7;
    this.listener = { x: 0, y: 0, z: 0, dx: 1, dz: 0 };
    this.lastStep = 0;
  }

  /** Browsers will not make a sound until a person has clicked something. */
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    // A little reverb, made out of decaying noise. An arena is a big concrete
    // room and it should sound like one.
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this.makeRoom(1.9, 2.6);
    const wet = this.ctx.createGain();
    wet.gain.value = 0.22;
    this.reverb.connect(wet);
    wet.connect(this.master);
    this.wet = this.reverb;

    // One long buffer of noise, looped. The announcer's voice needs it for the
    // wander in its pitch, its breath and its hiss, and building a new one per
    // syllable would be a new buffer sixty times a match.
    const rate = this.ctx.sampleRate;
    this.longNoise = this.ctx.createBuffer(1, rate * 2, rate);
    const data = this.longNoise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  makeRoom(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const length = Math.floor(rate * seconds);
    const buffer = this.ctx.createBuffer(2, length, rate);
    for (let c = 0; c < 2; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        data[i] = (Math.random() * 2 - 1) * (1 - t) ** decay * (i > rate * 0.02 ? 1 : 0.2);
      }
    }
    return buffer;
  }

  setListener(x, y, z, dx, dz) {
    this.listener = { x, y, z, dx, dz };
  }

  /** Where a sound is, relative to the ears: how loud, and how far to one side. */
  place(x, y, z, reach) {
    const l = this.listener;
    const dx = x - l.x;
    const dy = y - l.y;
    const dz = z - l.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const gain = Math.max(0, 1 - d / reach) ** 1.6;
    if (gain <= 0.001) return null;
    // Right is the listener's forward turned a quarter: no maths beyond that,
    // because a shooter needs left-or-right and nothing finer.
    const rx = -l.dz;
    const rz = l.dx;
    const side = d < 0.01 ? 0 : Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d));
    return { gain, pan: side, dist: d };
  }

  node(where, wet = 0.5) {
    const gain = this.ctx.createGain();
    gain.gain.value = where.gain;
    const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (pan) {
      pan.pan.value = where.pan * 0.85;
      gain.connect(pan);
      pan.connect(this.master);
      if (this.wet && wet > 0) {
        const send = this.ctx.createGain();
        send.gain.value = wet;
        pan.connect(send);
        send.connect(this.wet);
      }
    } else {
      gain.connect(this.master);
    }
    return gain;
  }

  noise(duration) {
    const rate = this.ctx.sampleRate;
    const length = Math.max(1, Math.floor(rate * duration));
    const buffer = this.ctx.createBuffer(1, length, rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    return src;
  }

  /**
   * One shot, from one gun. The differences between them are three numbers:
   * how much bottom end, how bright the crack is, and how long it rings.
   */
  gun(weapon, where) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const out = this.node(where, 0.45);
    const shapes = {
      mg: { body: 140, crack: 2600, len: 0.09, ring: 0.05, level: 0.6 },
      scatter: { body: 90, crack: 1500, len: 0.22, ring: 0.14, level: 1.0 },
      rocket: { body: 70, crack: 900, len: 0.30, ring: 0.2, level: 0.9 },
      rail: { body: 220, crack: 4200, len: 0.30, ring: 0.24, level: 0.85 },
      insta: { body: 300, crack: 5200, len: 0.34, ring: 0.28, level: 0.9 },
    };
    const s = shapes[weapon.key] || shapes.mg;

    const src = this.noise(s.len);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(s.crack, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(120, s.crack * 0.18), now + s.len);
    filter.Q.value = 1.1;
    const env = ctx.createGain();
    env.gain.setValueAtTime(s.level, now);
    env.gain.exponentialRampToValueAtTime(0.0008, now + s.len + s.ring);
    src.connect(filter);
    filter.connect(env);
    env.connect(out);
    src.start(now);
    src.stop(now + s.len + s.ring);

    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(s.body, now);
    thump.frequency.exponentialRampToValueAtTime(s.body * 0.4, now + 0.1);
    const tenv = ctx.createGain();
    tenv.gain.setValueAtTime(s.level * 0.8, now);
    tenv.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    thump.connect(tenv);
    tenv.connect(out);
    thump.start(now);
    thump.stop(now + 0.16);
  }

  boom(where) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const out = this.node(where, 0.9);
    const src = this.noise(0.7);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1800, now);
    filter.frequency.exponentialRampToValueAtTime(90, now + 0.6);
    const env = ctx.createGain();
    env.gain.setValueAtTime(1.4, now);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    src.connect(filter);
    filter.connect(env);
    env.connect(out);
    src.start(now);
    src.stop(now + 0.8);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(90, now);
    sub.frequency.exponentialRampToValueAtTime(28, now + 0.5);
    const senv = ctx.createGain();
    senv.gain.setValueAtTime(1.1, now);
    senv.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    sub.connect(senv);
    senv.connect(out);
    sub.start(now);
    sub.stop(now + 0.6);
  }

  blip(where, freq, len, type = 'square', level = 0.35, slide = 1) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const out = this.node(where, 0.3);
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slide !== 1) osc.frequency.exponentialRampToValueAtTime(freq * slide, now + len);
    const env = ctx.createGain();
    env.gain.setValueAtTime(level, now);
    env.gain.exponentialRampToValueAtTime(0.001, now + len);
    osc.connect(env);
    env.connect(out);
    osc.start(now);
    osc.stop(now + len + 0.02);
  }

  thud(where, level = 0.6) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const out = this.node(where, 0.35);
    const src = this.noise(0.13);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 520;
    const env = ctx.createGain();
    env.gain.setValueAtTime(level, now);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    src.connect(filter);
    filter.connect(env);
    env.connect(out);
    src.start(now);
    src.stop(now + 0.15);
  }

  /** Everything the simulation said happened, turned into noise. */
  play(state, events, me) {
    if (!this.on || !this.ctx) return;
    const near = (x, y, z, reach) => this.place(x, y, z, reach);
    for (const e of events) {
      if (e.type === 'fire') {
        const where = near(e.x, e.y, e.z, 90);
        if (where) this.gun(WEAPONS[e.weapon], e.body === me ? { gain: 0.85, pan: 0 } : where);
      } else if (e.type === 'explode') {
        const where = near(e.x, e.y, e.z, 120);
        if (where) this.boom(where);
      } else if (e.type === 'impact') {
        const where = near(e.x, e.y, e.z, 45);
        if (where) this.thud({ ...where, gain: where.gain * 0.35 }, 0.35);
      } else if (e.type === 'hurt' && e.body === me) {
        this.blip({ gain: 0.5, pan: 0 }, 210, 0.16, 'sawtooth', 0.4, 0.4);
      } else if (e.type === 'hit' && e.body === me) {
        this.blip({ gain: 0.45, pan: 0 }, 1500, 0.05, 'square', 0.18, 1.5);
      } else if (e.type === 'death') {
        const where = near(e.x, e.y, e.z, 70);
        if (where) this.blip(where, 300, 0.4, 'sawtooth', 0.35, 0.25);
      } else if (e.type === 'pickup' && e.body === me) {
        this.blip({ gain: 0.5, pan: 0 }, 720, 0.11, 'square', 0.22, 1.8);
      } else if (e.type === 'pad') {
        const where = near(e.x, e.y, e.z, 55);
        if (where) this.blip(where, 340, 0.28, 'sine', 0.4, 3.2);
      } else if (e.type === 'jump' && e.body === me) {
        this.blip({ gain: 0.25, pan: 0 }, 180, 0.07, 'sine', 0.2, 1.5);
      } else if (e.type === 'land') {
        const body = state.bodies[e.body];
        const where = e.body === me ? { gain: 0.5, pan: 0 } : near(body.x, body.y, body.z, 40);
        if (where) this.thud(where, Math.min(0.7, 0.15 + e.speed * 0.03));
      } else if (e.type === 'take' || e.type === 'capture') {
        this.blip({ gain: 0.6, pan: 0 }, e.type === 'capture' ? 520 : 380, 0.4, 'square', 0.3, 2.2);
      } else if (e.type === 'begin') {
        this.blip({ gain: 0.7, pan: 0 }, 440, 0.5, 'square', 0.35, 1.5);
      } else if (e.type === 'spawn' && e.body === me) {
        this.blip({ gain: 0.4, pan: 0 }, 620, 0.2, 'sine', 0.25, 1.4);
      }
    }
  }

  /** Footsteps, which are not events: they come from the body still moving. */
  steps(body, time) {
    if (!this.on || !this.ctx || !body.alive || !body.onGround) return;
    const speed = Math.sqrt(body.vx * body.vx + body.vz * body.vz);
    if (speed < 1.5) return;
    const gap = Math.max(0.26, 0.62 - speed * 0.035);
    if (time - this.lastStep < gap) return;
    this.lastStep = time;
    this.thud({ gain: 0.16, pan: 0 }, 0.22);
  }
}
