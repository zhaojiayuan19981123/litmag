import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugin, loadPrefPane } from '../scripts/support.mjs';

const DATA = { id: 'litmag@zhaojiayuan19981123.github.io', version: '2.0.1', rootURI: 'file:///litmag/' };
const PREFS = {
  apiKey: 'sk-unit-test', model: 'gpt-4o-mini', stream: false,
  temperature: '0.3', maxTokens: 4096, contextChars: 24000, historyTurns: 8,
  baseURL: 'https://api.openai.com/v1', provider: 'openai', fullURL: false,
  systemPrompt: '用中文回答', profiles: '[]',
};

function chatRequest(method) {
  if (method === 'GET') {
    return { status: 200, response: JSON.stringify({ data: [{ id: 'z-model' }, { id: 'a-model' }] }) };
  }
  return { status: 200, response: JSON.stringify({ choices: [{ message: { content: 'ready' } }] }) };
}

test('preference pane loads the user settings from Zotero.Prefs', async () => {
  const env = await loadPlugin({ prefs: PREFS, httpRequest: chatRequest });
  loadPrefPane(env);
  const doc = env.doc;
  assert.equal(doc.nodes.get('litmag-provider').value, 'openai');
  assert.equal(doc.nodes.get('litmag-api-key').value, 'sk-unit-test');
  assert.equal(doc.nodes.get('litmag-model').value, 'gpt-4o-mini');
  assert.equal(doc.nodes.get('litmag-base-url').value, 'https://api.openai.com/v1');
  assert.equal(doc.nodes.get('litmag-temperature').value, '0.3');
  assert.equal(doc.nodes.get('litmag-max-tokens').value, '4096');
  assert.equal(doc.nodes.get('litmag-stream').checked, false);
  assert.equal(doc.nodes.get('litmag-system-prompt').value, '用中文回答');
  assert.match(doc.nodes.get('litmag-status').textContent, /已配置/);
  env.context.shutdown(DATA, 1);
});

test('editing fields persists directly into Zotero.Prefs', async () => {
  const env = await loadPlugin({ prefs: PREFS, httpRequest: chatRequest });
  loadPrefPane(env);
  const doc = env.doc;
  doc.nodes.get('litmag-api-key').value = 'sk-new-key';
  doc.nodes.get('litmag-api-key').dispatch('change');
  doc.nodes.get('litmag-model').value = 'deepseek-chat';
  doc.nodes.get('litmag-model').dispatch('change');
  doc.nodes.get('litmag-max-tokens').value = '8192';
  doc.nodes.get('litmag-max-tokens').dispatch('change');
  doc.nodes.get('litmag-stream').checked = true;
  doc.nodes.get('litmag-stream').dispatch('change');
  assert.equal(env.prefs.get('extensions.litmag.apiKey'), 'sk-new-key');
  assert.equal(env.prefs.get('extensions.litmag.model'), 'deepseek-chat');
  assert.equal(env.prefs.get('extensions.litmag.maxTokens'), 8192);
  assert.equal(env.prefs.get('extensions.litmag.stream'), true);
  doc.nodes.get('litmag-save').dispatch('click');
  assert.match(doc.nodes.get('litmag-status').textContent, /已保存/);
  env.context.shutdown(DATA, 1);
});

test('switching provider adjusts the endpoint only when it is still a default', async () => {
  const env = await loadPlugin({ prefs: PREFS, httpRequest: chatRequest });
  loadPrefPane(env);
  const doc = env.doc;
  doc.nodes.get('litmag-provider').value = 'anthropic';
  doc.nodes.get('litmag-provider').dispatch('command');
  assert.equal(doc.nodes.get('litmag-base-url').value, 'https://api.anthropic.com');
  assert.equal(env.prefs.get('extensions.litmag.provider'), 'anthropic');

  doc.nodes.get('litmag-base-url').value = 'https://relay.example/custom/v1';
  doc.nodes.get('litmag-provider').value = 'custom';
  doc.nodes.get('litmag-provider').dispatch('command');
  assert.equal(doc.nodes.get('litmag-base-url').value, 'https://relay.example/custom/v1',
    'a user-typed URL must never be overwritten');
  assert.equal(doc.nodes.get('litmag-full-url').checked, true);
  env.context.shutdown(DATA, 1);
});

test('test connection uses the configured endpoint and reports the outcome', async () => {
  const calls = [];
  const env = await loadPlugin({
    prefs: PREFS,
    httpRequest: (method, url, opts) => {
      calls.push({ method, url });
      return chatRequest(method, url, opts);
    },
  });
  loadPrefPane(env);
  env.doc.nodes.get('litmag-test').dispatch('click');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.match(env.doc.nodes.get('litmag-status').textContent, /✓ 连接成功/);
  assert.ok(calls.some((c) => c.method === 'POST' && c.url.endsWith('/chat/completions')));
  env.context.shutdown(DATA, 1);
});

test('fetching the model list writes the selected model back', async () => {
  const env = await loadPlugin({ prefs: PREFS, httpRequest: chatRequest });
  loadPrefPane(env);
  env.doc.nodes.get('litmag-fetch-models').dispatch('click');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(env.doc.nodes.get('litmag-model').value, 'a-model');
  assert.equal(env.prefs.get('extensions.litmag.model'), 'a-model');
  assert.match(env.doc.nodes.get('litmag-status').textContent, /已选择模型/);
  env.context.shutdown(DATA, 1);
});

test('named profiles can be saved, applied and deleted from the pane', async () => {
  const env = await loadPlugin({ prefs: PREFS, httpRequest: chatRequest });
  loadPrefPane(env);
  const doc = env.doc;
  doc.nodes.get('litmag-profile-save').dispatch('click');
  assert.equal(env.context.LitMag.ai.listProfiles().length, 1);
  assert.equal(env.context.LitMag.ai.listProfiles()[0].name, '测试配置');
  assert.deepEqual(doc.nodes.get('litmag-profiles').profileItems.map((p) => p.label), ['测试配置']);

  doc.nodes.get('litmag-model').value = 'changed-model';
  doc.nodes.get('litmag-model').dispatch('change');
  doc.nodes.get('litmag-profile-apply').dispatch('click');
  assert.equal(env.prefs.get('extensions.litmag.model'), 'gpt-4o-mini');

  doc.nodes.get('litmag-profile-delete').dispatch('click');
  assert.equal(env.context.LitMag.ai.listProfiles().length, 0);
  env.context.shutdown(DATA, 1);
});
