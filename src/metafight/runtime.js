export function drawingSize(width, height, deviceDpr, scale = 1, quality = 'low') {
  const medium = quality === 'medium';
  const dpr = Math.min(deviceDpr || 1, medium ? 1.5 : 1, Math.sqrt((medium ? 2000000 : 1000000) / Math.max(1, width * height))) * scale;
  return { width: Math.max(1, Math.floor(width * dpr)), height: Math.max(1, Math.floor(height * dpr)), dpr };
}

export class FrameBudget {
  constructor() { this.preferred = 'low'; this.level = 0; this.elapsed = 0; this.frames = 0; this.averageMs = 0; }
  setQuality(quality) { this.preferred = quality === 'medium' ? 'medium' : 'low'; this.level = 0; this.resetWindow(); }
  resetWindow() { this.elapsed = 0; this.frames = 0; }
  sample(ms) {
    this.elapsed += ms; this.frames++;
    if (this.elapsed < 5000) return null;
    this.averageMs = this.elapsed / this.frames; this.resetWindow();
    const max = this.preferred === 'medium' ? 3 : 2;
    if (this.averageMs > 50 && this.level < max) { this.level++; return 'degrade'; }
    if (this.averageMs > 100 && this.level === max) return 'stop';
    return null;
  }
  get effectiveQuality() { return this.preferred === 'medium' && this.level === 0 ? 'medium' : 'low'; }
  get scale() { return [1, 0.75, 0.5][Math.max(0, this.level - (this.preferred === 'medium' ? 1 : 0))]; }
}

// Track this owned context's resources and draw workload without GPU readback.
export function trackGPU(gl) {
  const handles = {}, originals = {}, metrics = { draws: 0, triangles: 0, peakDraws: 0, peakTriangles: 0, textureBytes: 0, maxTextureEdge: 0 };
  const wrap = (name, fn) => { originals[name] = gl[name]; gl[name] = fn; };
  for (const type of ['Buffer', 'Texture', 'Program', 'Shader']) {
    handles[type] = new Set();
    const create = gl['create' + type], remove = gl['delete' + type];
    wrap('create' + type, function(...args) { const h = create.apply(gl, args); if (h) handles[type].add(h); return h; });
    wrap('delete' + type, function(h) { handles[type].delete(h); return remove.call(gl, h); });
  }
  const draw = gl.drawElements;
  wrap('drawElements', function(mode, count, type, offset) {
    metrics.draws++; if (mode === gl.TRIANGLES) metrics.triangles += count / 3;
    return draw.call(gl, mode, count, type, offset);
  });
  const tex = gl.texImage2D;
  wrap('texImage2D', function(...args) {
    const width = args.length >= 9 ? args[3] : args[5].width;
    const height = args.length >= 9 ? args[4] : args[5].height;
    metrics.textureBytes += width * height * 4 * 4 / 3; // conservative mipmap estimate
    metrics.maxTextureEdge = Math.max(metrics.maxTextureEdge, width, height);
    return tex.apply(gl, args);
  });
  return {
    metrics,
    resources() { const counts = {}; for (const type of Object.keys(handles)) counts[type.toLowerCase()] = handles[type].size; return counts; },
    begin() { metrics.draws = 0; metrics.triangles = 0; },
    end() {
      metrics.peakDraws = Math.max(metrics.peakDraws, metrics.draws);
      metrics.peakTriangles = Math.max(metrics.peakTriangles, metrics.triangles);
      if (metrics.draws > 50 || metrics.triangles > 50000 || metrics.textureBytes > 32 * 1024 * 1024 || metrics.maxTextureEdge > 1024) throw new Error('超出低档图形预算，已停止测试');
    },
    dispose() {
      for (const type of Object.keys(handles)) { for (const h of handles[type]) originals['delete' + type].call(gl, h); handles[type].clear(); }
      for (const name of Object.keys(originals)) gl[name] = originals[name];
    },
  };
}
