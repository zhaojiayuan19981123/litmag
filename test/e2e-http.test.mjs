/* Real HTTP end-to-end smoke test: a local OpenAI-compatible server streams
 * SSE chunks, and the plugin's real http.js/ai.js code parses them through a
 * Zotero.HTTP.request shim backed by node:http. */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { loadModulesOnly } from '../scripts/support.mjs';

function startServer() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'mock-b' }, { id: 'mock-a' }] }));
        return;
      }
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        if (body.includes('bad-key')) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const chunks = [
          'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"，Zotero"}}]}\n\n',
          'data: [DONE]\n\n',
        ];
        let i = 0;
        const tick = () => {
          if (i >= chunks.length) { res.end(); return; }
          res.write(chunks[i++]);
          setTimeout(tick, 5);
        };
        tick();
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/* Zotero.HTTP.request shim, including progressive XHR responses. */
function realRequest(method, url, opts = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = http.request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method,
      headers: opts.headers || {},
    }, (res) => {
      let full = '';
      const xhr = {
        status: res.statusCode,
        response: '',
        onprogress: null,
        abort() { req.destroy(); },
      };
      if (opts.requestObserver) opts.requestObserver(xhr);
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        full += chunk;
        xhr.response = full;
        if (xhr.onprogress) xhr.onprogress({ target: xhr });
      });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          const e = new Error('HTTP ' + res.statusCode);
          e.xmlhttp = { status: res.statusCode, responseText: full };
          reject(e);
          return;
        }
        xhr.response = full;
        resolve(xhr);
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

test('streaming a real SSE response through the plugin produces the full answer', async (t) => {
  const { server, port } = await startServer();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const env = loadModulesOnly({
    httpRequest: realRequest,
    prefs: {
      provider: 'openai', baseURL: `http://127.0.0.1:${port}/v1`,
      apiKey: 'sk-test', model: 'mock-model', stream: true, fullURL: false,
    },
  });
  const P = env.context.LitMag;
  assert.equal(P.ai.chatEndpoint(), `http://127.0.0.1:${port}/v1/chat/completions`);
  const deltas = [];
  const answer = await P.ai.chat(
    [{ role: 'system', content: '规则' }, { role: 'user', content: '你好' }],
    { onToken: (piece) => deltas.push(piece) });
  assert.equal(answer, '你好，Zotero');
  assert.ok(deltas.length >= 2);
  assert.equal(deltas.join(''), '你好，Zotero');
  assert.deepEqual(await P.ai.listModels(), ['mock-a', 'mock-b']);
});

test('a real 401 becomes an actionable credential error', async (t) => {
  const { server, port } = await startServer();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const env = loadModulesOnly({
    httpRequest: realRequest,
    prefs: {
      provider: 'openai', baseURL: `http://127.0.0.1:${port}/v1`,
      apiKey: 'sk-test', model: 'bad-key', stream: false, fullURL: false,
    },
  });
  await assert.rejects(
    () => env.context.LitMag.ai.chat([{ role: 'user', content: 'hi' }]),
    (e) => {
      assert.equal(e.kind, 'auth');
      assert.match(e.message, /密钥验证失败/);
      assert.match(e.message, /HTTP 401/);
      return true;
    });
});
