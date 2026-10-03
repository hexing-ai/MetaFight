// Bounded, local-only rAF interval statistics. No simulated ticks as FPS.
const BIN_MS = 5, LIMIT_MS = 250, BINS = 52;
const active = phase => phase === 'PLAYING' || phase === 'RESPAWNING';
function counters() { return { frames: 0, ms: 0, maxMs: 0, droppedMs: 0, histogram: new Uint32Array(BINS) }; }
function add(c, ms, dropped) {
  c.frames++; c.ms += ms; c.maxMs = Math.max(c.maxMs, ms); c.droppedMs += dropped;
  c.histogram[Math.min(BINS - 1, Math.ceil(ms / BIN_MS))]++;
}
function merge(a, b) {
  a.frames += b.frames; a.ms += b.ms; a.maxMs = Math.max(a.maxMs, b.maxMs); a.droppedMs += b.droppedMs;
  for (let i = 0; i < BINS; i++) a.histogram[i] += b.histogram[i];
}
function summary(c) {
  let upper = null, count = 0;
  for (let i = 0; i < BINS && c.frames; i++) {
    count += c.histogram[i];
    if (count >= Math.ceil(c.frames * .95)) { upper = i === BINS - 1 ? null : i * BIN_MS; break; }
  }
  return { frames: c.frames, sampledCombatMs: c.ms, averageFps: c.ms ? c.frames * 1000 / c.ms : null,
    p95UpperMs: upper, p95Overflow: !!c.frames && upper === null, maxFrameMs: c.maxMs,
    droppedSimulationMs: c.droppedMs, histogram: Array.from(c.histogram) };
}

export class PerformanceRun {
  constructor() { this.reset(0); this.enabled = false; this.endedAt = 0; }
  reset(now) {
    this.enabled = true; this.startedAt = now; this.endedAt = null; this.phase = 'MENU'; this.phaseAt = now;
    this.phaseMs = {}; this.lastFrame = null; this.warmupMs = 0; this.warmupTargetMs = 120000;
    this.groups = []; this.current = null; this.recent = []; this.events = []; this.lostEvents = 0;
    this.resourcePeak = {}; this.matches = 0; this.droppedMs = 0;
  }
  phaseTo(phase, now) {
    if (!this.enabled || phase === this.phase) return;
    this.phaseMs[this.phase] = (this.phaseMs[this.phase] || 0) + Math.max(0, now - this.phaseAt);
    if (!active(phase) || !active(this.phase)) this.lastFrame = null;
    this.phase = phase; this.phaseAt = now;
  }
  configure(context, now) {
    if (!this.enabled) return;
    const key = JSON.stringify(context);
    let group = this.groups.find(g => g.key === key);
    if (!group) {
      if (this.groups.length >= 24) { this.event('group-limit', '', now); this.stop(now); return; }
      group = { key, context: { ...context }, stats: counters() }; this.groups.push(group);
    }
    if (this.current !== group) { this.current = group; this.lastFrame = null; }
  }
  event(type, detail, now) {
    if (!this.enabled) return;
    this.events.push({ elapsedMs: Math.max(0, now - this.startedAt), type, detail });
    if (this.events.length > 60) { this.events.shift(); this.lostEvents++; }
  }
  resources(counts) {
    if (!this.enabled || !counts) return;
    for (const key of Object.keys(counts)) this.resourcePeak[key] = Math.max(this.resourcePeak[key] || 0, counts[key]);
  }
  frame(now, dropped = 0) {
    if (!this.enabled || !active(this.phase) || !this.current || !Number.isFinite(now) || now < this.phaseAt) return;
    this.droppedMs += Math.max(0, dropped);
    const previous = this.lastFrame; this.lastFrame = now;
    if (previous === null || now <= previous) return;
    const ms = now - previous;
    // Discard the entire interval crossing the warmup boundary, never invent a frame.
    if (this.warmupMs < this.warmupTargetMs) { this.warmupMs += ms; return; }
    add(this.current.stats, ms, Math.max(0, dropped));
    const second = Math.floor(now / 1000);
    let bin = this.recent[this.recent.length - 1];
    if (!bin || bin.second !== second || bin.key !== this.current.key) {
      bin = { second, key: this.current.key, start: previous, end: now, stats: counters() };
      this.recent.push(bin);
    }
    bin.end = now; add(bin.stats, ms, Math.max(0, dropped));
    // At most 302 time/configuration slices; old or excess slices are explicitly excluded.
    while (this.recent.length > 302 || (this.recent.length && this.recent[0].end < now - 300000)) this.recent.shift();
  }
  stop(now) {
    if (!this.enabled) return;
    this.phaseTo('STOPPED', now); this.endedAt = now; this.enabled = false;
  }
  snapshot(now) {
    const end = this.endedAt === null ? now : this.endedAt;
    const phaseMs = { ...this.phaseMs };
    if (this.enabled) phaseMs[this.phase] = (phaseMs[this.phase] || 0) + Math.max(0, end - this.phaseAt);
    const groups = this.groups.map(g => {
      const recent = counters(); let from = null, to = null;
      for (const bin of this.recent) if (bin.key === g.key && bin.start >= end - 300000 && bin.end <= end) {
        merge(recent, bin.stats); if (from === null) from = bin.start; to = bin.end;
      }
      return { context: g.context, ...summary(g.stats), lastFiveMinutes: { ...summary(recent), fromElapsedMs: from === null ? null : from - this.startedAt,
        toElapsedMs: to === null ? null : to - this.startedAt, boundary: 'Only whole 1-second slices inside the final 300000ms; inspect actual sampled coverage, not a full-window guarantee.' } };
    });
    return { schemaVersion: 1, enabled: this.enabled, elapsedMs: Math.max(0, end - this.startedAt), phase: this.phase,
      warmupTargetMs: this.warmupTargetMs, warmupCombatMs: this.warmupMs, phaseMs, groups,
      histogram: { binWidthMs: BIN_MS, finiteLimitMs: LIMIT_MS, overflowIndex: BINS - 1, percentile: 'nearest rank, conservative bucket upper bound; overflow has no finite upper bound' },
      droppedSimulationMs: this.droppedMs, matches: this.matches, resourcePeak: { ...this.resourcePeak },
      events: this.events.slice(), omittedEventCount: this.lostEvents,
      measurement: 'Foreground rAF intervals only; first frame after resume/config change excluded. Includes respawn. Pauses, menus, results and background excluded. No input-to-photon or physical-device certification.' };
  }
}
