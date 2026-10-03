// Wall time only schedules steps. Gameplay timers advance inside the core.
// No DOM, rAF, or background timer: the owning session drives this clock.
export class SimulationClock {
  constructor({ fixedHz = 60, maxSteps = 6 } = {}) {
    if (fixedHz !== 60 || !Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 6) {
      throw new Error('模拟时钟须为60Hz，每帧最多补算1至6步');
    }
    this.stepMs = 1000 / fixedHz; this.maxSteps = maxSteps; this.reset();
  }

  reset() {
    this.running = false; this.lastTime = null; this.accumulatorMs = 0;
    this.ticks = 0; this.droppedMs = 0;
  }

  pause() { this.running = false; this.lastTime = null; this.accumulatorMs = 0; }
  resume() {
    if (this.running) return;
    this.lastTime = null; this.accumulatorMs = 0; this.running = true;
  }

  advance(now, step) {
    if (!Number.isFinite(now) || now < 0 || typeof step !== 'function') throw new Error('模拟时钟输入无效');
    if (!this.running) return 0;
    if (this.lastTime === null) { this.lastTime = now; return 0; }
    if (now <= this.lastTime) return 0;
    this.accumulatorMs += now - this.lastTime; this.lastTime = now;
    // Tolerate sub-nanosecond rounding at exact tick boundaries.
    const due = Math.floor((this.accumulatorMs + 1e-7) / this.stepMs);
    const count = Math.min(due, this.maxSteps);
    const dropped = Math.max(0, due - count);
    this.droppedMs += dropped * this.stepMs;
    this.accumulatorMs = Math.max(0, this.accumulatorMs - due * this.stepMs);
    let completed = 0;
    try {
      for (let i = 0; i < count && this.running; i++) {
        step(); this.ticks++; completed++;
      }
    } catch (error) { this.pause(); throw error; }
    return completed;
  }

  get alpha() { return this.accumulatorMs / this.stepMs; }
  snapshot() {
    return { running: this.running, ticks: this.ticks, droppedMs: this.droppedMs,
      accumulatorMs: this.accumulatorMs, maxSteps: this.maxSteps, fixedHz: 60 };
  }
}
