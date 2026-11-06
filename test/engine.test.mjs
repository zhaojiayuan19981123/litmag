import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngineServer, PROTOCOL, PLUGIN_VERSION } from '../engine/server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function makeUpstream() {
  const server = http.createServer((req, res) => {
    if (String(req.url).startsWith('/stream')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write('data: hello\n\n');
      res.end();
      return;
    }
    if (String(req.url).startsWith('/missing')) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head></head><body><h1>Workbench</h1></body></html>');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('bridge engine API, workbench proxy and state file', async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'litmag-test-'));
  const upstream = await makeUpstream();
  const workbenchURL = `http://127.0.0.1:${upstream.address().port}`;
  const engine = await createEngineServer({
    port: 0,
    homeDir: tmp,
    token: 'unit-test-token',
    workbenchURL,
    writeState: true,
  });

  t.after(async () => {
    await engine.shutdown();
    await new Promise((resolve) => upstream.close(resolve));
    await fs.rm(tmp, { recursive: true, force: true });
  });

  const base = engine.url;
  const auth = { 'X-LitMag-Token': engine.token };

  await t.test('handshake reports protocol version and a live workbench', async () => {
    const r = await fetch(`${base}/api/litmag/handshake`);
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.ok, true);
    assert.equal(data.protocol, PROTOCOL);
    assert.equal(data.version, PLUGIN_VERSION);
    assert.equal(data.workbench.url, workbenchURL);
    assert.equal(data.workbench.online, true);
  });

  await t.test('ping works without a token', async () => {
    const r = await fetch(`${base}/api/litmag/ping`);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).pong, true);
  });

  await t.test('status requires the token', async () => {
    assert.equal((await fetch(`${base}/api/litmag/status`)).status, 401);
    const r = await fetch(`${base}/api/litmag/status`, { headers: auth });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).port, engine.port);
  });

  await t.test('context is written and read back with the token', async () => {
    const payload = {
      source: 'zotero-plugin', pluginVersion: '1.0', protocol: PROTOCOL,
      question: '总结这篇文献',
      items: [{ key: 'K1', title: 'Paper One' }, { key: 'K2', title: 'Paper Two' }],
    };
    const bad = await fetch(`${base}/api/litmag/context`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    assert.equal(bad.status, 401);

    const r = await fetch(`${base}/api/litmag/context`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify(payload),
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).count, 2);

    const got = await fetch(`${base}/api/litmag/context`, { headers: auth });
    const body = await got.json();
    assert.equal(body.context.question, '总结这篇文献');
    assert.equal(body.context.items[0].title, 'Paper One');
  });

  await t.test('status page is served in Chinese', async () => {
    const r = await fetch(`${base}/`);
    assert.equal(r.status, 200);
    assert.match(await r.text(), /LitMag 引擎已运行/);
  });

  await t.test('workbench HTML is proxied and receives the injected context', async () => {
    const r = await fetch(`${base}/workbench?litmag=1`);
    assert.equal(r.status, 200);
    const text = await r.text();
    assert.match(text, /<h1>Workbench<\/h1>/);
    assert.match(text, /window\.__LITMAG_CONTEXT__=/);
    assert.match(text, /Paper One/);
    assert.match(text, /window\.__LITMAG_PROTOCOL__=1/);
  });

  await t.test('SSE responses are streamed without HTML injection', async () => {
    const r = await fetch(`${base}/workbench/stream`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/event-stream/);
    const text = await r.text();
    assert.match(text, /data: hello/);
    assert.doesNotMatch(text, /__LITMAG_CONTEXT__/);
  });

  await t.test('upstream 404 is passed through', async () => {
    const r = await fetch(`${base}/workbench/missing`);
    assert.equal(r.status, 404);
  });

  await t.test('engine state file contains port and token', async () => {
    const state = JSON.parse(await fs.readFile(path.join(tmp, '.litmag', 'engine.json'), 'utf8'));
    assert.equal(state.port, engine.port);
    assert.equal(state.token, 'unit-test-token');
    assert.equal(state.protocol, PROTOCOL);
    assert.equal(state.workbenchURL, workbenchURL);
  });

  await t.test('unknown paths return JSON 404', async () => {
    const r = await fetch(`${base}/api/litmag/nope`);
    assert.equal(r.status, 404);
    assert.equal((await r.json()).ok, false);
  });
});

test('graceful shutdown removes the engine state file', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'litmag-state-'));
  const engine = await createEngineServer({
    port: 0,
    homeDir: tmp,
    token: 'state-token',
    workbenchURL: 'http://127.0.0.1:1',
    writeState: true,
  });
  const statePath = path.join(tmp, '.litmag', 'engine.json');
  assert.ok(await fs.stat(statePath).catch(() => null));
  await engine.shutdown();
  assert.equal(await fs.stat(statePath).catch(() => null), null);
  await fs.rm(tmp, { recursive: true, force: true });
});

test('engine shows a friendly page when the workbench is down', async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'litmag-down-'));
  const engine = await createEngineServer({
    port: 0,
    homeDir: tmp,
    token: 't',
    workbenchURL: 'http://127.0.0.1:1',
    writeState: false,
  });
  t.after(async () => {
    await engine.shutdown();
    await fs.rm(tmp, { recursive: true, force: true });
  });
  const r = await fetch(`${engine.url}/workbench`);
  assert.equal(r.status, 502);
  assert.match(await r.text(), /工作台未启动/);
  const h = await fetch(`${engine.url}/api/litmag/handshake`);
  assert.equal((await h.json()).workbench.online, false);
});

test('XPI does not include the engine sources', async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const xpi = path.join(root, 'dist', `litmag-${pkg.version}.xpi`);
  if (!await fs.stat(xpi).catch(() => null)) return;
  const buf = await fs.readFile(xpi);
  // A marker unique to engine/server.mjs. The literal path "engine/server.mjs"
  // legitimately appears in workbench.js as a user-facing hint, so do not use it.
  assert.equal(buf.includes(Buffer.from('LitMag bridge engine - zero dependencies', 'utf8')), false);
});
