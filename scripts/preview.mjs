// Static, loopback-only preview. No compiler, shell, upload, or source execution endpoint.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const routes = new Map([
  ['/', ['web/index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['web/styles.css', 'text/css; charset=utf-8']],
  ['/app.mjs', ['web/app.mjs', 'text/javascript; charset=utf-8']],
  ['/report.mjs', ['web/report.mjs', 'text/javascript; charset=utf-8']],
  ...['type_mismatch', 'undefined_name', 'argument_count', 'hello'].map(name =>
    [`/fixtures/${name}.json`, [`tests/fixtures/${name}.json`, 'application/json; charset=utf-8']])
]);
export function makeServer() {
  return createServer(async (req, res) => {
    const headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer'};
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, {...headers, Allow: 'GET, HEAD'}).end(); return; }
    const route = routes.get(req.url?.split('?')[0]);
    if (!route) { res.writeHead(404, headers).end('Not found'); return; }
    try {
      const body = await readFile(resolve(root, route[0]));
      res.writeHead(200, {...headers, 'Content-Type': route[1]});
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(503, headers).end('Preview file is unavailable. Run the fixture capture script.'); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.DOCTOR_PREVIEW_PORT || 8765);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid preview port');
  const server = makeServer();
  server.on('error', e => { console.error(e.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Doctor preview: http://127.0.0.1:${port} (Ctrl+C to stop)`));
}
