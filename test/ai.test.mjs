import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModulesOnly } from '../scripts/support.mjs';

const BASE_PREFS = {
  provider: 'openai',
  baseURL: 'https://api.openai.com/v1',
  apiKey: 'sk-unit-test-key',
  model: 'gpt-4o-mini',
  temperature: '0.3',
  maxTokens: 4096,
  stream: false,
  fullURL: false,
  systemPrompt: '用中文回答',
};

function makeEnv(overrides = {}) {
  const response = overrides.response === undefined
    ? JSON.stringify({ choices: [{ message: { content: '模型答案' } }] })
    : overrides.response;
  const httpRequest = overrides.httpRequest || (async (method, url, opts) => ({
    status: 200,
    response,
    opts,
  }));
  return loadModulesOnly({
    prefs: { ...BASE_PREFS, ...(overrides.prefs || {}) },
    httpRequest,
  });
}

function sseRequest(events, split) {
  return async (_method, _url, opts) => {
    const xhr = { status: 200, response: '', onprogress: null, abort() {} };
    if (opts.requestObserver) opts.requestObserver(xhr);
    const chunks = [events.slice(0, split), events.slice(split)];
    for (const chunk of chunks) {
      xhr.response += chunk;
      if (xhr.onprogress) xhr.onprogress({ target: xhr });
    }
    return xhr;
  };
}

test('profile reads the values the user typed into Zotero preferences', () => {
  const env = makeEnv();
  const p = env.context.LitMag.ai.profile();
  assert.equal(p.provider, 'openai');
  assert.equal(p.apiKey, 'sk-unit-test-key');
  assert.equal(p.model, 'gpt-4o-mini');
  assert.equal(p.temperature, 0.3);
  assert.equal(p.maxTokens, 4096);
  assert.equal(p.stream, false);
  assert.equal(env.context.LitMag.ai.isConfigured(), true);
});

test('no key means not configured, unless a local endpoint is used', () => {
  const env = makeEnv({ prefs: { apiKey: '' } });
  assert.equal(env.context.LitMag.ai.isConfigured(), false);
  const local = makeEnv({ prefs: { apiKey: '', baseURL: 'http://127.0.0.1:11434/v1' } });
  assert.equal(local.context.LitMag.ai.isConfigured(), true, 'Ollama / LM Studio need no key');
});

test('endpoint joining handles /v1, plain hosts, Anthropic and full endpoints', () => {
  const P = makeEnv().context.LitMag;
  assert.equal(P.ai.chatEndpoint(), 'https://api.openai.com/v1/chat/completions');
  P.setPref('baseURL', 'https://api.deepseek.com');
  assert.equal(P.ai.chatEndpoint(), 'https://api.deepseek.com/v1/chat/completions');
  P.setPref('provider', 'anthropic');
  P.setPref('baseURL', 'https://api.anthropic.com');
  assert.equal(P.ai.chatEndpoint(), 'https://api.anthropic.com/v1/messages');
  assert.equal(P.ai.headers()['x-api-key'], 'sk-unit-test-key');
  assert.equal(P.ai.headers()['anthropic-version'], '2023-06-01');
  P.setPref('provider', 'openai');
  P.setPref('fullURL', true);
  P.setPref('baseURL', 'https://relay.example/v1/chat/completions');
  assert.equal(P.ai.chatEndpoint(), 'https://relay.example/v1/chat/completions');
  assert.equal(P.ai.headers().Authorization, 'Bearer sk-unit-test-key');
});

test('request bodies use the right protocol and never leak extra fields', () => {
  const P = makeEnv().context.LitMag;
  const messages = [{ role: 'system', content: '规则' }, { role: 'user', content: '问题' }];
  const openai = JSON.parse(P.ai.buildBody(messages, P.ai.profile(), { stream: false }));
  assert.equal(openai.model, 'gpt-4o-mini');
  assert.equal(openai.stream, false);
  assert.deepEqual(openai.messages, messages);
  P.setPref('provider', 'anthropic');
  const anthropic = JSON.parse(P.ai.buildBody(messages, P.ai.profile(), { stream: true }));
  assert.equal(anthropic.system, '规则');
  assert.deepEqual(anthropic.messages, [{ role: 'user', content: '问题' }]);
  assert.equal(anthropic.stream, true);
});

test('non-streaming chat returns the answer and reports an empty reply clearly', async () => {
  const env = makeEnv();
  const answer = await env.context.LitMag.ai.chat([{ role: 'user', content: 'hi' }]);
  assert.equal(answer, '模型答案');

  const empty = makeEnv({ response: JSON.stringify({ choices: [{ message: { content: '' } }] }) });
  await assert.rejects(
    () => empty.context.LitMag.ai.chat([{ role: 'user', content: 'hi' }]),
    /空回答/);

  const html = makeEnv({ response: '<html>not an API</html>' });
  await assert.rejects(
    () => html.context.LitMag.ai.chat([{ role: 'user', content: 'hi' }]),
    /网页而不是接口响应/);
});

test('streaming chat assembles SSE chunks across boundaries and ignores reasoning_content', async () => {
  const events = [
    'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"，LitMag"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":null,"reasoning_content":"内部思考"}}]}\n\n',
    'data: {"choices":[{"finish_reason":"stop"}]}\n\n',
    'data: [DONE]\n\n',
  ].join('');
  const env = makeEnv({ prefs: { stream: true }, httpRequest: sseRequest(events, 71) });
  const deltas = [];
  const answer = await env.context.LitMag.ai.chat(
    [{ role: 'user', content: 'hi' }],
    { onToken: (piece) => deltas.push(piece) });
  assert.equal(answer, '你好，LitMag');
  assert.deepEqual(deltas.slice(0, 2), ['你好', '，LitMag']);
  assert.ok(!answer.includes('内部思考'));
});

test('streaming falls back to a single JSON body when a relay ignores stream', async () => {
  const env = makeEnv({
    prefs: { stream: true },
    httpRequest: sseRequest(JSON.stringify({ choices: [{ message: { content: '非流式回退' } }] }), 20),
  });
  const answer = await env.context.LitMag.ai.chat([{ role: 'user', content: 'hi' }], { onToken: () => {} });
  assert.equal(answer, '非流式回退');
});

test('HTTP failures are translated into actionable Chinese messages', async () => {
  const env = makeEnv({
    httpRequest: async () => {
      const e = new Error('request failed');
      e.xmlhttp = { status: 401, responseText: '{"error":{"message":"invalid api key"}}' };
      throw e;
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
  assert.equal(env.context.LitMag.http.classifyHTTP(429, 'rate limit'), 'rate');
  assert.equal(env.context.LitMag.http.classifyHTTP(400, 'context length exceeded'), 'context');
  assert.equal(env.context.LitMag.http.classifyHTTP(402, 'insufficient balance'), 'quota');
});

test('missing credentials produce a distinguishable error code for the UI', async () => {
  const env = makeEnv({ prefs: { apiKey: '' } });
  await assert.rejects(
    () => env.context.LitMag.ai.chat([{ role: 'user', content: 'hi' }]),
    (e) => {
      assert.equal(e.code, 'LITMAG_NO_KEY');
      assert.match(e.message, /设置 → LitMag/);
      return true;
    });
});

test('model list, connection test and named profiles all work against user settings', async () => {
  const env = makeEnv({
    httpRequest: async (method, url) => {
      if (method === 'GET') return { status: 200, response: JSON.stringify({ data: [{ id: 'z-model' }, { id: 'a-model' }] }) };
      return { status: 200, response: JSON.stringify({ choices: [{ message: { content: 'ready' } }] }) };
    },
  });
  const P = env.context.LitMag;
  assert.deepEqual(await P.ai.listModels(), ['a-model', 'z-model']);
  const result = await P.ai.testConnection();
  assert.equal(result.ok, true);
  assert.equal(result.message, 'ready');

  assert.equal(P.ai.saveProfile('DeepSeek'), true);
  P.setPref('model', 'other-model');
  P.setPref('baseURL', 'https://api.openai.com/v1');
  assert.equal(P.ai.applyProfile('DeepSeek'), true);
  assert.equal(P.pref('model'), 'gpt-4o-mini');
  assert.equal(P.ai.listProfiles().length, 1);
  assert.equal(P.ai.deleteProfile('DeepSeek'), true);
  assert.equal(P.ai.listProfiles().length, 0);
  assert.match(P.ai.statusText(), /已配置/);
  assert.doesNotMatch(P.ai.maskedKey(), /sk-unit-test-key/);
});
