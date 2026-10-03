// Local static preview only. Does not serve repository metadata or a relay.
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const port = Number(process.env.PORT || 5173);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer from 1 to 65535');
}
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};
const entries = new Set(['index.html', 'styles.css', 'manifest.webmanifest']);
const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    const allowed = entries.has(rel)
      || (rel.startsWith('src/') && rel.endsWith('.js'))
      || (rel.startsWith('icons/') && rel.endsWith('.png'));
    if (!allowed || rel.split('/').some(p => !p || p.startsWith('.')) || rel.includes('\\')) {
      res.writeHead(404).end();
      return;
    }
    const resolved = await realpath(path.join(root, rel));
    if (!resolved.startsWith(root + path.sep)) {
      res.writeHead(404).end();
      return;
    }
    const body = await readFile(resolved);
    res.writeHead(200, {
      'Content-Type': types[path.extname(rel)] || 'application/octet-stream',
      'Content-Length': body.length, 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (err) {
    res.writeHead(err instanceof URIError ? 400 : 404).end();
  }
});
server.on('error', err => {
  console.error(`Cannot start local preview (${err.code || err.message}). Try another PORT.`);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`MetaFight M0 preview: http://127.0.0.1:${port}/`);
  console.log('Upstream baseline gameplay; not a MetaFight greybox or mini-tool package. Ctrl+C to stop.');
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
