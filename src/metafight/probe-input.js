import { BTN, PITCH_LIMIT, YAW_UNITS } from '../constants.js';

export class ProbeInput {
  constructor() { this.points = new Map(); this.keys = new Set(); this.yaw = 0; this.pitch = 0; this.sensitivity = 1; this.aimScale = 1; this.actions = 0; this.fireEdge = false; this.enabled = false; }
  down(id, role, x, y) {
    if (!this.enabled || this.points.has(id)) return;
    if (Array.from(this.points.values()).some(p => p.role === role)) return;
    this.points.set(id, { role, x, y, startX: x, startY: y });
    if (role === 'fire') this.fireEdge = true;
  }
  move(id, x, y) {
    const p = this.points.get(id); if (!p) return;
    if (p.role === 'look' || p.role === 'fire') {
      this.yaw = ((this.yaw + (x - p.x) * 55 * this.sensitivity * this.aimScale) % YAW_UNITS + YAW_UNITS) % YAW_UNITS;
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - (y - p.y) * 55 * this.sensitivity * this.aimScale));
    }
    p.x = x; p.y = y;
  }
  up(id) { this.points.delete(id); }
  clear() { this.points.clear(); this.keys.clear(); this.fireEdge = false; this.actions = 0; this.aimScale = 1; }
  action(mask) { if (this.enabled) this.actions |= mask; }
  read() {
    let b = 0;
    if (this.enabled) {
      if (this.keys.has('KeyW')) b |= BTN.FWD;
      if (this.keys.has('KeyS')) b |= BTN.BACK;
      if (this.keys.has('KeyA')) b |= BTN.LEFT;
      if (this.keys.has('KeyD')) b |= BTN.RIGHT;
      for (const p of this.points.values()) {
        if (p.role === 'fire') b |= BTN.FIRE;
        if (p.role === 'move') {
          if (p.y - p.startY < -10) b |= BTN.FWD;
          if (p.y - p.startY > 10) b |= BTN.BACK;
          if (p.x - p.startX < -10) b |= BTN.LEFT;
          if (p.x - p.startX > 10) b |= BTN.RIGHT;
        }
      }
      if (this.fireEdge) b |= BTN.FIRE;
      b |= this.actions;
    }
    this.fireEdge = false;
    this.actions = 0;
    return { b, yaw: Math.round(this.yaw), pitch: Math.round(this.pitch) };
  }
}
