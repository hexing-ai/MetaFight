import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { networkInterfaces } from 'node:os';
const args = process.argv.slice(2), index = args.indexOf('--port');
const port = Number(index >= 0 ? args[index + 1] : process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
const lan = args.includes('--lan');
const host = lan ? '0.0.0.0' : '127.0.0.1';
const types = { 'index.html': 'text/html; charset=utf-8', 'app.js': 'text/javascript; charset=utf-8', 'style.css': 'text/css; charset=utf-8' };
const server = createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) return res.writeHead(405).end();
  const route = new URL(req.url, 'http://localhost').pathname;
  if (route === '/') return res.writeHead(302, { Location: '/release/web/' }).end();
  const match = /^\/(m[123]\/|release\/)?(web|xiaohongshu)\/(index\.html|app(?:\.[a-f0-9]{12})?\.js|style(?:\.[a-f0-9]{12})?\.css|icon\.png|assets\/(?:cover-daylight|ship-materials)\.jpg)?$/.exec(route);
  if (!match) return res.writeHead(404).end();
  try {
    const file = match[3] || 'index.html', data = await readFile(path.join('dist', match[1] || '', match[2], file));
    const mime = types[file] || (file.endsWith('.js') ? types['app.js'] : file.endsWith('.css') ? types['style.css'] : file.endsWith('.jpg') ? 'image/jpeg' : 'image/png');
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self'; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'" });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404).end(); }
});
server.on('error', e => { console.error(e.message); process.exitCode = 1; });
server.listen(port, host, () => {
  console.log(`MetaFight preview http://127.0.0.1:${port}/release/web/ (Ctrl+C to stop)`);
  if (lan) {
    const addresses = Object.values(networkInterfaces()).flat().filter(n => n && !n.internal && n.family === 'IPv4' && /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(n.address));
    for (const address of new Set(addresses.map(n => n.address))) console.log(`Phone (same Wi-Fi): http://${address}:${port}/release/web/`);
    console.log('LAN preview enabled; serves only built game files. Keep this computer awake.');
  }
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
