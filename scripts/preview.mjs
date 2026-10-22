// Loopback-only UI and thin transport for the Cangjie core. No arbitrary source execution.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { NativeBridge, EXAMPLE_IDS } from './native-bridge.mjs';
import { PAGE_ROUTES } from '../web/navigation.mjs';
import { RevisionStore } from './revision-store.mjs';
import { MAX_REVISION_BYTES } from '../web/revision.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const pageRoutes = new Map([['/', PAGE_ROUTES[0]], ...PAGE_ROUTES.map(page => [page.path, page])]);
const routes = new Map([
  ...[...pageRoutes.keys()].map(path => [path, ['web/index.html', 'text/html; charset=utf-8']]),
  ['/styles.css', ['web/styles.css', 'text/css; charset=utf-8']],
  ['/app.mjs', ['web/app.mjs', 'text/javascript; charset=utf-8']],
  ['/navigation.mjs', ['web/navigation.mjs', 'text/javascript; charset=utf-8']],
  ['/report.mjs', ['web/report.mjs', 'text/javascript; charset=utf-8']],
  ['/revision.mjs', ['web/revision.mjs', 'text/javascript; charset=utf-8']],
  ['/task.mjs', ['web/task.mjs', 'text/javascript; charset=utf-8']],
  ...['type_mismatch', 'undefined_name', 'argument_count', 'hello'].map(name =>
    [`/fixtures/${name}.json`, [`tests/fixtures/${name}.json`, 'application/json; charset=utf-8']])
]);
export function makeServer({bridge = null, revisionStore = bridge?.root ? new RevisionStore(bridge.root) : null} = {}) {
  return createServer(async (req, res) => {
    const headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer'};
    const send = (code, body) => { if (!res.destroyed) res.writeHead(code, {...headers, 'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify(body)); };
    const address = req.socket.localPort;
    const expectedHost = `127.0.0.1:${address}`;
    if (req.headers.host !== expectedHost) { send(403, {error:'Invalid local host'}); return; }
    if (req.url?.startsWith('/api/')) {
      try {
        if (req.method === 'GET' && req.url === '/api/health') {
          send(200, {...(bridge?.health ?? {available:false, code:'preview_only', detail:'静态记录预览，未配置仓颉核心。'}), token:bridge?.token, busy:bridge?.busy ?? false}); return;
        }
        // API data and mutation require the local origin plus a per-start token.
        // Regular cross-origin pages cannot read the token or add this header without preflight.
        if (!bridge || req.headers['x-doctor-token'] !== bridge.token ||
            (req.headers.origin && req.headers.origin !== `http://${expectedHost}`)) {
          send(403, {error:'请从本地 Doctor 页面操作。'}); return;
        }
        if (req.method === 'POST' && req.url === '/api/probe') {
          if (bridge.busy) { send(409, {error:'正在编译，请稍后检查环境。'}); return; }
          send(200, {...await bridge.probe(), token:bridge.token, busy:bridge.busy}); return;
        }
        if (req.method === 'GET' && req.url === '/api/history') { send(200, {...await bridge.history(),busy:bridge.busy}); return; }
        if (req.url === '/api/revisions' || req.url.startsWith('/api/revisions/')) {
          if (!revisionStore) { send(503,{error:'修改记录存储尚未配置。'}); return; }
          if (req.method === 'GET' && req.url === '/api/revisions') { send(200,await revisionStore.list()); return; }
          if (req.method === 'GET' && /^\/api\/revisions\/[a-f0-9]{32}$/.test(req.url)) {
            send(200,await revisionStore.get(req.url.slice('/api/revisions/'.length))); return;
          }
          if (req.method === 'POST' && req.url === '/api/revisions') {
            if (req.headers['content-type'] !== 'application/json') { send(415,{error:'Expected JSON'}); return; }
            const chunks = []; let bytes = 0;
            for await (const chunk of req) {
              bytes += chunk.length;
              if (bytes > MAX_REVISION_BYTES) { send(413,{error:'修改记录超过大小限制。'}); return; }
              chunks.push(chunk);
            }
            let input;
            try { input = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))); }
            catch { send(400,{error:'Invalid JSON'}); return; }
            send(200,await revisionStore.save(input)); return;
          }
          send(404,{error:'Unknown revision API'}); return;
        }
        if (req.method === 'POST' && req.url === '/api/retrieve') {
          if (req.headers['content-type'] !== 'application/json') { send(415,{error:'Expected JSON'}); return; }
          const chunks = []; let bytes = 0;
          for await (const chunk of req) {
            bytes += chunk.length;
            if (bytes > 2 * 1024 * 1024 + 16384) { send(413,{error:'诊断记录超过大小限制。'}); return; }
            chunks.push(chunk);
          }
          let input;
          try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          catch { send(400,{error:'Invalid JSON'}); return; }
          const controller = new AbortController();
          const cancel = () => { if (!res.writableEnded) controller.abort(); };
          res.on('close',cancel);
          if (res.destroyed) controller.abort();
          try { send(200,await bridge.retrieve(input,controller.signal)); }
          finally { res.removeListener('close',cancel); }
          return;
        }
        if (req.method === 'POST' && req.url === '/api/compile-example') {
          if (req.headers['content-type'] !== 'application/json') { send(415, {error:'Expected JSON'}); return; }
          let body = '', bytes = 0;
          for await (const chunk of req) { bytes += chunk.length; if (bytes > 1024) { send(413, {error:'Request too large'}); return; } body += chunk.toString('utf8'); }
          let input;
          try { input = JSON.parse(body); } catch { send(400, {error:'Invalid JSON'}); return; }
          if (!input || Object.keys(input).length !== 1 || !EXAMPLE_IDS.includes(input.caseId)) { send(400, {error:'只接受已审核的样例编号，不接受源码或命令。'}); return; }
          const controller = new AbortController();
          const cancel = () => { if (!res.writableEnded) controller.abort(); };
          res.on('close', cancel);
          if (res.destroyed) controller.abort();
          try { send(200, await bridge.compile(input.caseId, controller.signal)); }
          finally { res.removeListener('close', cancel); }
          return;
        }
        send(404, {error:'Unknown API'}); return;
      } catch (e) { send(e.status || 500, {error:e.message,taskId:e.taskId,taskState:e.taskState,retrievalId:e.retrievalId}); return; }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, {...headers, Allow: 'GET, HEAD'}).end(); return; }
    const path = req.url?.split('?')[0];
    const route = routes.get(path);
    if (!route) { res.writeHead(404, headers).end('Not found'); return; }
    try {
      let body = await readFile(resolve(root, route[0]));
      const page = pageRoutes.get(path);
      if (page) body = body.toString('utf8').replace(/(<body\b[^>]*\bdata-page=")[^"]*(")/, `$1${page.path.slice(1)}$2`);
      res.writeHead(200, {...headers, 'Content-Type': route[1]});
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(503, headers).end('Preview file is unavailable. Run the fixture capture script.'); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.DOCTOR_PREVIEW_PORT || 8765);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid preview port');
  const executable = process.env.DOCTOR_BINARY || join(root, 'target/debug', process.platform === 'win32' ? 'doctor.exe' : 'doctor');
  const compiler = process.env.DOCTOR_COMPILER || (process.env.CANGJIE_HOME ? join(process.env.CANGJIE_HOME, 'bin', process.platform === 'win32' ? 'cjc.exe' : 'cjc') : null);
  const bridge = new NativeBridge({root, executable, compiler});
  await bridge.probe();
  const server = makeServer({bridge,revisionStore:new RevisionStore(root)});
  server.on('error', e => { console.error(e.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Doctor preview: http://127.0.0.1:${port} (Ctrl+C to stop)`));
}
