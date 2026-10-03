import { hashState } from '../game/state.js';
import { MAX_PLAYERS } from '../constants.js';

/**
 * A transport supplies the inputs of ALL players, per tick.
 * The game loop only knows this interface:
 *
 *    transport.sample(tick)   record (and send) this machine's input
 *    transport.ready(tick)    are we allowed to simulate this tick?
 *    transport.poll(tick)  -> [input0, input1, input2, input3]
 *    transport.afterStep(state)
 *
 * Locally everything comes from the keyboard, the mouse and the gamepad; online
 * the rest of it comes from up to three other people. The simulation cannot tell
 * the difference - which is why adding online multiplayer needed no changes to
 * sim.js at all.
 *
 * This is websoccer, webtennis and webracing's netcode with one thing added: an
 * input here is not a single byte. It is a byte and two angles, because in a
 * shooter where you are looking is half of what you are doing, and an angle
 * recomputed from a turn rate on the far machine would be an angle that missed.
 * The angles are integers for the same reason - see constants.js.
 */

const IDLE = { b: 0, yaw: 0, pitch: 0 };

/** Everybody on one machine: the local player, and the CPU for the rest. */
export class LocalTransport {
  constructor(input, seat = 0) {
    this.input = input;
    this.seat = seat;
    this.online = false;
    this.current = { b: 0, yaw: 0, pitch: 0 };
  }

  sample() {
    this.current = this.input.read();
  }

  ready() {
    return true;
  }

  poll() {
    const out = new Array(MAX_PLAYERS).fill(IDLE);
    out[this.seat] = this.current;
    return out;
  }

  afterStep() {}
  dispose() {}
}

/**
 * Ring buffer of inputs per tick. Stores the tick number alongside the value, so
 * a stale entry can never pass for a fresh one after the buffer wraps around.
 */
export class InputBuffer {
  constructor(size = 1024) {
    this.size = size;
    this.b = new Int32Array(size);
    this.yaw = new Int32Array(size);
    this.pitch = new Int32Array(size);
    this.ticks = new Int32Array(size).fill(-1);
  }

  set(tick, b, yaw, pitch) {
    if (tick < 0) return;
    const i = tick % this.size;
    if (this.ticks[i] === tick) return; // first value to arrive wins
    this.b[i] = b;
    this.yaw[i] = yaw;
    this.pitch[i] = pitch;
    this.ticks[i] = tick;
  }

  get(tick) {
    const i = ((tick % this.size) + this.size) % this.size;
    if (this.ticks[i] !== tick) return null;
    return { b: this.b[i], yaw: this.yaw[i], pitch: this.pitch[i] };
  }
}

const now = () => (globalThis.performance ? performance.now() : Date.now());

/**
 * Online multiplayer: lockstep with input delay, for up to four.
 *
 * Every machine runs the same simulation and nothing but buttons crosses the
 * wire. Input is sent DELAY ticks ahead of time so it arrives before it is
 * needed. If it is not there anyway the simulation waits (a "stall") rather than
 * guessing, so nobody can drift apart from anybody else.
 *
 * The aim is the exception that proves the rule. It travels with the buttons and
 * is applied on the same tick everywhere - but the picture on your own machine
 * turns the moment you move the mouse, because the camera reads the mouse and
 * not the simulation. So the view is instant and the shot is on the tick. Which
 * is the right way round: a laggy camera is unplayable, and a shot that lands
 * four ticks late is a shot that lands.
 */
export class OnlineTransport {
  constructor({
    signal, input, seats = 2, localSeat = 0, delay = 4, minDelay = 3, maxDelay = 14,
  }) {
    this.signal = signal;
    this.input = input;
    this.seats = seats;
    this.localSeat = localSeat;
    this.delay = delay;
    this.minDelay = minDelay;
    this.maxDelay = maxDelay;
    this.online = true;

    this.buffers = [];
    for (let i = 0; i < MAX_PLAYERS; i++) this.buffers.push(new InputBuffer());
    this.lastSent = -1;

    /** Seats whose player has left. Their body carries on, standing still. */
    this.gone = [];
    this.stalls = 0;
    this.stallWindow = 0;
    this.calmSeconds = 0;
    this.stalling = false;
    this.ping = 0;
    this.pongs = 0;
    this.desync = false;

    this.myHashes = new Map();
    this.theirHashes = new Map();

    // For the first DELAY ticks nobody has been able to send anything yet.
    // Every machine fills in the same nothing, otherwise everyone waits for
    // everyone.
    for (let t = 0; t < delay; t++) {
      for (const buf of this.buffers) buf.set(t, 0, 0, 0);
    }

    signal.on('input', (m) => {
      // The seat is stamped by the relay, not by the sender: a client that could
      // name its own seat could drive somebody else's body.
      const buf = this.buffers[m.seat];
      if (!buf) return;
      for (const [tick, b, yaw, pitch] of m.frames) buf.set(tick, b, yaw, pitch);
    });
    signal.on('hash', (m) => this.onRemoteHash(m));
    signal.on('ping', (m) => signal.send({ t: 'pong', id: m.id }));
    signal.on('pong', (m) => {
      this.ping = Math.max(0, Math.round(now() - m.id));
      this.pongs++;
    });
    signal.on('peerleft', (m) => this.left(m.seat));
  }

  /**
   * Somebody has closed their tab.
   *
   * Their body is handed nothing but zeroes from here on, which every machine
   * does identically, so the match carries on and stays in step. It does not end
   * it: three people should not lose their game because a fourth had to answer
   * the door.
   */
  left(seat) {
    if (seat === undefined || seat === null || this.gone.includes(seat)) return;
    this.gone.push(seat);
  }

  /** Record this machine's input for tick+DELAY and send it off. */
  sample(tick) {
    const target = tick + this.delay;
    if (target <= this.lastSent) return;
    const read = this.input.read();

    const mine = this.buffers[this.localSeat];
    // Fill every tick up to and including `target`. Usually that is exactly one,
    // but if the delay has just gone up there must be no gap: a missing tick
    // would leave everybody else waiting forever.
    for (let t = Math.max(this.lastSent + 1, 0); t <= target; t++) {
      mine.set(t, read.b, read.yaw, read.pitch);
    }
    this.lastSent = target;

    // The last few ticks ride along every time: lost packets repair themselves
    // without anything ever having to be re-requested.
    const frames = [];
    for (let t = Math.max(0, target - 6); t <= target; t++) {
      const v = mine.get(t);
      if (v) frames.push([t, v.b, v.yaw, v.pitch]);
    }
    this.signal.send({ t: 'input', frames });
  }

  ready(tick) {
    let ok = true;
    for (let seat = 0; seat < this.seats; seat++) {
      if (this.gone.includes(seat)) continue;
      if (this.buffers[seat].get(tick) === null) { ok = false; break; }
    }
    if (ok) {
      this.stalling = false;
    } else {
      this.stalls++;
      this.stallWindow++;
      this.stalling = true;
    }
    return ok;
  }

  /**
   * The input delay adapts to the connection: if we stall often we send our
   * input further ahead (slightly laggier controls, but a smooth picture). It
   * may differ per player - every input carries its own tick number, so the
   * simulation stays identical on every machine.
   */
  tuneDelay() {
    if (this.stallWindow > 8 && this.delay < this.maxDelay) {
      this.delay++;
      this.calmSeconds = 0;
    } else if (this.stallWindow === 0) {
      this.calmSeconds++;
      if (this.calmSeconds >= 8 && this.delay > this.minDelay) {
        this.delay--;
        this.calmSeconds = 0;
      }
    } else {
      this.calmSeconds = 0;
    }
    this.stallWindow = 0;
  }

  poll(tick) {
    const out = new Array(MAX_PLAYERS).fill(IDLE);
    for (let seat = 0; seat < this.seats; seat++) {
      if (this.gone.includes(seat)) continue;
      out[seat] = this.buffers[seat].get(tick) || IDLE;
    }
    return out;
  }

  /** Compare state once a second; any difference means a desync. */
  afterStep(state) {
    if (state.tick % 60 !== 0) return;
    this.tuneDelay();

    const mine = hashState(state);
    this.myHashes.set(state.tick, mine);
    if (this.myHashes.size > 40) this.myHashes.delete(this.myHashes.keys().next().value);

    this.signal.send({ t: 'hash', tick: state.tick, hash: mine });
    this.signal.send({ t: 'ping', id: now() });

    const theirs = this.theirHashes.get(state.tick);
    if (theirs !== undefined && theirs !== mine) this.desync = true;
  }

  onRemoteHash(m) {
    this.theirHashes.set(m.tick, m.hash);
    if (this.theirHashes.size > 40) {
      this.theirHashes.delete(this.theirHashes.keys().next().value);
    }
    const mine = this.myHashes.get(m.tick);
    if (mine !== undefined && mine !== m.hash) this.desync = true;
  }

  dispose() {
    this.signal.close();
  }
}
