/* LitMag bridge engine - zero dependencies, Node 20+.
 *
 * Why this exists: a Zotero plugin is Gecko privileged JS, not Node. Express,
 * pdfjs/ONNX, worker_threads, IMAP and native binaries cannot live in an XPI.
 * This tiny process keeps the existing workbench reachable at ONE stable local
 * URL, exposes a small JSON API for the plugin, and reverse-proxies the
 * workbench so the embedded <browser> stays same-origin HTTP.
 *
 * Nothing in the original workbench needs to change.
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PLUGIN_VERSION = '1.0';
export const PROTOCOL = 1;
export const DEFAULT_PORT = 23127;
export const DEFAULT_WORKBENCH_URL = 'http://127.0.0.1:3000';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function homeDir(options) {
  return options.homeDir || process.env.LITMAG_HOME || os.homedir();
}

function readConfigSync() {
  const defaults = {
    port: DEFAULT_PORT,
    workbenchURL: DEFAULT_WORKBENCH_URL,
    token: '',
    host: '127.0.0.1',
  };
  let merged = defaults;
  for (const name of ['config.example.json', 'config.json']) {
    try {
      const raw = fsSync.readFileSync(path.join(__dirname, name), 'utf8');
      if (raw) merged = { ...merged, ...JSON.parse(raw) };
    }
    catch (e) { /* missing or invalid -> keep previous */ }
  }
  return merged;
}

function resolveConfig(options) {
  const fileConfig = readConfigSync();
  const cfg = {
    host: options.host || process.env.LITMAG_HOST || fileConfig.host || '127.0.0.1',
    port: Number(options.port ?? process.env.LITMAG_PORT ?? fileConfig.port ?? DEFAULT_PORT),
    workbenchURL: String(options.workbenchURL || process.env.LITMAG_WORKBENCH_URL ||
      fileConfig.workbenchURL || DEFAULT_WORKBENCH_URL).replace(/\/+$/, ''),
    token: String(options.token ?? process.env.LITMAG_TOKEN ?? fileConfig.token ?? ''),
    homeDir: homeDir(options),
    writeState: options.writeState !== false,
  };
  if (!cfg.token) cfg.token = crypto.randomBytes(24).toString('hex');
  return cfg;
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-LitMag-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
}

function json(res, status, data) {
  setCors(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function html(res, status, body) {
  setCors(res);
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function inlineJSON(value) {
  return JSON.stringify(value === undefined ? null : value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function tokenFrom(req, url) {
  const header = req.headers['x-litmag-token'];
  if (header) return String(header);
  return String(url.searchParams.get('token') || '');
}

function statusPage(cfg, state) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>LitMag 引擎</title>
<style>body{font:15px/1.7 system-ui,sans-serif;max-width:760px;margin:60px auto;padding:0 24px;color:#222}
code{background:#f2f2f2;padding:2px 6px;border-radius:4px}h1{font-size:22px}table{border-collapse:collapse;width:100%}
td{padding:8px 4px;border-bottom:1px solid #e5e5e5}small{opacity:.65}</style></head><body>
<h1>LitMag 引擎已运行</h1>
<p>这是 Zotero 10 插件与「一站式科研终端」之间的本地桥接服务，只监听本机地址。</p>
<table>
<tr><td>引擎版本</td><td>${PLUGIN_VERSION}（协议 ${PROTOCOL}）</td></tr>
<tr><td>监听地址</td><td>http://${cfg.host}:${state.port}</td></tr>
<tr><td>工作台地址</td><td>${cfg.workbenchURL}</td></tr>
<tr><td>工作台状态</td><td>${state.workbenchOnline === null ? '未探测' : (state.workbenchOnline ? '在线' : '未启动')}</td></tr>
<tr><td>令牌</td><td>已写入 <code>~/.litmag/engine.json</code></td></tr>
</table>
<p>在 Zotero 中：工具 → 打开 LitMag 工作台，或右键条目 → 用 LitMag 分析选中条目。</p>
<p><small>工作台未启动时，本页与插件的条目面板仍可用；需要工作台时请先启动原应用（默认 3000 端口）。</small></p>
</body></html>`;
}

function upstreamErrorPage(cfg) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>工作台未启动</title>
<style>body{font:15px/1.7 system-ui,sans-serif;max-width:720px;margin:60px auto;padding:0 24px}</style></head><body>
<h2>工作台未启动</h2>
<p>LitMag 引擎已运行，但无法连接到 <code>${cfg.workbenchURL}</code>。</p>
<p>请先启动「一站式科研终端」（命令行 <code>npm start</code> 默认监听 3000 端口），或到 Zotero → 设置 → LitMag 修改工作台地址，然后刷新本页。</p>
<p>插件本身的条目面板、右键菜单不需要工作台即可使用。</p>
</body></html>`;
}

async function probeWorkbench(cfg) {
  try {
    const target = new URL('/', cfg.workbenchURL + '/');
    const mod = target.protocol === 'https:' ? https : http;
    return await new Promise((resolve) => {
      const req = mod.request(target, { method: 'GET', timeout: 1500 }, (res) => {
        res.resume();
        resolve(res.statusCode < 500);
      });
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.on('error', () => resolve(false));
      req.end();
    });
  }
  catch (e) { return false; }
}

function proxyRequest(req, res, cfg, state) {
  const rel = req.url.replace(/^\/workbench/, '') || '/';
  const base = cfg.workbenchURL + '/';
  let target;
  try {
    target = new URL(rel.replace(/^\//, ''), base);
  }
  catch (e) {
    return html(res, 400, '<meta charset="utf-8"><p>无效的工作台路径</p>');
  }

  const mod = target.protocol === 'https:' ? https : http;
  const headers = { ...req.headers };
  headers.host = target.host;
  // Ask the workbench for uncompressed HTML so we can inject the context script.
  if (req.method === 'GET') headers['accept-encoding'] = 'identity';
  delete headers['x-litmag-token'];
  delete headers.connection;

  const upstream = mod.request(target, {
    method: req.method,
    headers,
    timeout: 60000,
  }, (upstreamRes) => {
    const ct = String(upstreamRes.headers['content-type'] || '');
    const inject = req.method === 'GET' && ct.includes('text/html');

    const outHeaders = { ...upstreamRes.headers };
    delete outHeaders.connection;
    delete outHeaders['x-litmag-token'];
    setCors(res);

    if (!inject) {
      res.writeHead(upstreamRes.statusCode || 200, outHeaders);
      upstreamRes.pipe(res);
      return;
    }

    const chunks = [];
    upstreamRes.on('data', (c) => chunks.push(c));
    upstreamRes.on('end', async () => {
      let body = Buffer.concat(chunks).toString('utf8');
      let context = null;
      try { context = JSON.parse(await fs.readFile(state.contextPath, 'utf8')); }
      catch (e) { context = null; }
      const script = '<script>window.__LITMAG_CONTEXT__=' + inlineJSON(context) +
        ';window.__LITMAG_PROTOCOL__=' + PROTOCOL + ';</script>';
      body = /<\/body>/i.test(body) ? body.replace(/<\/body>/i, script + '</body>') : body + script;
      delete outHeaders['content-length'];
      delete outHeaders['content-encoding'];
      res.writeHead(upstreamRes.statusCode || 200, outHeaders);
      res.end(Buffer.from(body, 'utf8'));
    });
    upstreamRes.on('error', () => {
      if (!res.headersSent) html(res, 502, upstreamErrorPage(cfg));
      else res.end();
    });
  });

  upstream.on('timeout', () => upstream.destroy(new Error('upstream timeout')));
  upstream.on('error', () => {
    state.workbenchOnline = false;
    if (!res.headersSent) html(res, 502, upstreamErrorPage(cfg));
    else res.end();
  });

  req.pipe(upstream);
}

export async function createEngineServer(options = {}) {
  const cfg = resolveConfig(options);
  const state = {
    port: cfg.port,
    workbenchOnline: null,
    stateDir: path.join(cfg.homeDir, '.litmag'),
    contextPath: path.join(cfg.homeDir, '.litmag', 'context.json'),
    statePath: path.join(cfg.homeDir, '.litmag', 'engine.json'),
    startedAt: new Date().toISOString(),
  };
  await fs.mkdir(state.stateDir, { recursive: true });

  const server = http.createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); }
    catch (e) { return json(res, 400, { ok: false, error: 'bad url' }); }

    if (req.method === 'OPTIONS') {
      setCors(res);
      res.writeHead(204);
      return res.end();
    }

    const pathname = url.pathname;

    if (pathname === '/' || pathname === '/litmag' || pathname === '/index.html') {
      state.workbenchOnline = await probeWorkbench(cfg);
      return html(res, 200, statusPage(cfg, state));
    }

    if (pathname === '/api/litmag/ping') {
      return json(res, 200, { ok: true, pong: true, version: PLUGIN_VERSION });
    }

    if (pathname === '/api/litmag/handshake') {
      state.workbenchOnline = await probeWorkbench(cfg);
      return json(res, 200, {
        ok: true,
        name: 'litmag-engine',
        version: PLUGIN_VERSION,
        protocol: PROTOCOL,
        port: state.port,
        tokenRequired: true,
        workbench: {
          url: cfg.workbenchURL,
          online: !!state.workbenchOnline,
        },
      });
    }

    const authed = tokenFrom(req, url) === cfg.token;

    if (pathname === '/api/litmag/status') {
      if (!authed) return json(res, 401, { ok: false, error: 'invalid token' });
      return json(res, 200, {
        ok: true,
        version: PLUGIN_VERSION,
        protocol: PROTOCOL,
        port: state.port,
        startedAt: state.startedAt,
        workbench: { url: cfg.workbenchURL, online: !!state.workbenchOnline },
      });
    }

    if (pathname === '/api/litmag/context' && req.method === 'GET') {
      if (!authed) return json(res, 401, { ok: false, error: 'invalid token' });
      try {
        const data = JSON.parse(await fs.readFile(state.contextPath, 'utf8'));
        return json(res, 200, { ok: true, context: data });
      }
      catch (e) {
        return json(res, 200, { ok: true, context: null });
      }
    }

    if (pathname === '/api/litmag/context' && req.method === 'POST') {
      if (!authed) return json(res, 401, { ok: false, error: 'invalid token' });
      try {
        const raw = await readBody(req);
        const payload = JSON.parse(raw || '{}');
        const record = {
          source: payload.source || 'unknown',
          pluginVersion: payload.pluginVersion || '',
          protocol: Number(payload.protocol || 0),
          question: String(payload.question || ''),
          items: Array.isArray(payload.items) ? payload.items : [],
          receivedAt: new Date().toISOString(),
        };
        await fs.writeFile(state.contextPath, JSON.stringify(record, null, 2), 'utf8');
        return json(res, 200, { ok: true, count: record.items.length, savedAt: record.receivedAt });
      }
      catch (e) {
        return json(res, 400, { ok: false, error: e.message || 'invalid payload' });
      }
    }

    if (pathname === '/workbench' || pathname.startsWith('/workbench/')) {
      return proxyRequest(req, res, cfg, state);
    }

    return json(res, 404, { ok: false, error: 'not found', path: pathname });
  });

  const listen = (port, attempt = 0) => new Promise((resolve, reject) => {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE' && attempt < 10) {
        listen(port + 1, attempt + 1).then(resolve, reject);
      }
      else reject(err);
    });
    server.listen(port, cfg.host, () => {
      state.port = server.address().port;
      resolve();
    });
  });

  await listen(cfg.port);

  if (cfg.writeState) {
    await fs.writeFile(state.statePath, JSON.stringify({
      version: PLUGIN_VERSION,
      protocol: PROTOCOL,
      port: state.port,
      url: `http://${cfg.host}:${state.port}`,
      token: cfg.token,
      workbenchURL: cfg.workbenchURL,
      startedAt: state.startedAt,
      pid: process.pid,
    }, null, 2), 'utf8');
  }

  // Probe in the background so startup never waits on a down workbench.
  probeWorkbench(cfg).then((online) => { state.workbenchOnline = online; }).catch(() => {});

  const shutdown = async () => {
    // Remove the state file first: a stale token must never survive a stop,
    // even if a keep-alive connection delays server.close().
    if (cfg.writeState) {
      try { await fs.unlink(state.statePath); } catch (e) { /* ignore */ }
    }
    await new Promise((resolve) => {
      server.close(resolve);
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    });
  };

  return {
    server,
    config: cfg,
    state,
    token: cfg.token,
    port: state.port,
    url: `http://${cfg.host}:${state.port}`,
    shutdown,
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  createEngineServer().then((engine) => {
    console.log('');
    console.log('  LitMag 引擎已启动');
    console.log(`  地址：     ${engine.url}`);
    console.log(`  工作台：   ${engine.config.workbenchURL} (${engine.state.workbenchOnline ? '在线' : '未启动'})`);
    console.log(`  状态文件： ${engine.state.statePath}`);
    console.log('  按 Ctrl+C 停止');
    console.log('');
    const stop = async () => {
      await engine.shutdown();
      process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }).catch((e) => {
    console.error('  LitMag 引擎启动失败：', e.message);
    process.exit(1);
  });
}
