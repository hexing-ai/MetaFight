import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'acorn';

export function filesIn(dir, prefix = '') {
  return readdirSync(path.join(dir, prefix)).sort().flatMap(name => {
    const rel = path.posix.join(prefix, name);
    return statSync(path.join(dir, rel)).isDirectory() ? filesIn(dir, rel) : [rel];
  });
}
export function auditArtifact(dir) {
  const files = filesIn(dir), errors = [], warnings = [];
  const allowed = new Set(['.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.woff', '.woff2', '.json']);
  const htmlFiles = files.filter(f => f.endsWith('.html'));
  if (htmlFiles.length !== 1 || htmlFiles[0] !== 'index.html') errors.push('ZIP根目录必须为唯一index.html');
  const forbidden = new Set(['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'RTCPeerConnection', 'Worker', 'SharedWorker', 'WebAssembly', 'eval', 'Function', 'requestFullscreen', 'webkitRequestFullscreen', 'requestPointerLock', 'exitPointerLock', 'clipboard', 'serviceWorker', 'geolocation', 'getBattery', 'getDisplayMedia', 'SharedArrayBuffer', 'OffscreenCanvas', 'Accelerometer', 'Gyroscope', 'Magnetometer', 'DeviceMotionEvent', 'DeviceOrientationEvent', 'PaymentRequest']);
  let textBytes = 0;
  for (const file of files) {
    const ext = path.extname(file), bytes = statSync(path.join(dir, file)).size;
    if (!allowed.has(ext) || /(^|\/)(\.|node_modules|server|tools)/.test(file)) errors.push('不允许文件：' + file);
    if (!['.html', '.css', '.js', '.json'].includes(ext)) continue;
    textBytes += bytes; if (bytes > 2 * 1024 * 1024) warnings.push(file + '文本超过2MiB');
    const source = readFileSync(path.join(dir, file), 'utf8');
    for (const match of source.matchAll(/data:[^;,]*;base64,([A-Za-z0-9+/=]+)/g)) {
      const size = Buffer.from(match[1], 'base64').length;
      if (size > 1024 * 1024) errors.push('Base64超过1MiB');
      else if (size > 100 * 1024) warnings.push('Base64建议拆为独立文件');
    }
    if (ext === '.js') {
      try {
        const ast = parse(source, { ecmaVersion: 2017, sourceType: 'script' });
        function walk(node) {
          if (!node || typeof node !== 'object') return;
          if (node.type === 'Identifier' && forbidden.has(node.name)) errors.push('禁用标识符：' + node.name);
          if (node.type === 'MemberExpression') {
            const name = node.computed && node.property.type === 'Literal' ? node.property.value : node.property.name;
            if (forbidden.has(name)) errors.push('禁用成员：' + name);
            if (node.object.name === 'window' && ['open', 'prompt'].includes(name)) errors.push('禁用窗口能力');
            if (node.object.name === 'Object' && ['fromEntries', 'hasOwn'].includes(name)) errors.push('缺少Chrome61兼容：' + name);
            if (['replaceAll', 'structuredClone'].includes(name)) errors.push('新API需人工检查：' + name);
          }
          for (const value of Object.values(node)) {
            if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') walk(value);
          }
        }
        walk(ast);
      } catch (error) { errors.push(file + ': ES2017解析失败 ' + error.message); }
    }
    if (ext === '.html') {
      if (!/<!doctype html>/i.test(source) || !/lang="zh-CN"/.test(source) || !/charset="UTF-8"/i.test(source) || !/viewport-fit=cover/.test(source)) errors.push('缺少HTML或视口声明');
      if (/<(?:base|iframe|object|form)\b|http-equiv\s*=|\bon\w+\s*=|javascript:|type=["']module|\bdownload\b|target=["']_blank/i.test(source)) errors.push('HTML存在禁用内容');
      for (const m of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (!/src=/.test(m[1]) || m[2].trim()) errors.push('脚本必须外置');
      }
      for (const m of source.matchAll(/\b(?:src|href)=["']([^"']+)/g)) {
        if (!m[1].startsWith('./') || !files.includes(m[1].slice(2))) errors.push('引用未闭包：' + m[1]);
      }
    }
    if (ext === '.css') {
      for (const m of source.matchAll(/url\(\s*['"]?([^)'"\s]+)/g)) if (!m[1].startsWith('./') || !files.includes(m[1].slice(2))) errors.push('CSS外部或缺失资源');
      if (/@import|@layer|@container|:has\(|(?<![-\w])(?:gap|inset|aspect-ratio)\s*:|\b(?:clamp|min|max)\(/.test(source)) errors.push('CSS需Chrome61回退检查');
    }
  }
  if (textBytes > 5 * 1024 * 1024) warnings.push('解压文本超过5MiB');
  return { status: errors.length ? 'FAIL' : 'PASS', files, textBytes, errors: [...new Set(errors)], warnings, limits: 'Static checks only; PC simulator and physical Android/iOS pending' };
}
