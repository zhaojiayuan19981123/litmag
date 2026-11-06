import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { loadPlugin, fakeItem, FakeNode } from '../scripts/support.mjs';
import { root } from '../scripts/support.mjs';

const DATA = { id: 'litmag@zhaojiayuan19981123.github.io', version: '2.0', rootURI: 'file:///litmag/' };

test('startup registers all Zotero surfaces without contacting any service', async () => {
  const env = await loadPlugin();
  const { context, reg, prefs, doc } = env;
  /* Hand-built XUL menus are the primary route; MenuManager must not also
   * register the same actions (that would duplicate every entry). */
  assert.equal(reg.menus.length, 0);
  assert.equal(doc.nodes.get('menu_ToolsPopup').children.length, 4);
  assert.equal(doc.nodes.get('zotero-itemmenu').children.length, 1);
  const labels = doc.nodes.get('menu_ToolsPopup').children
    .concat(doc.nodes.get('zotero-itemmenu').children)
    .map((n) => n.getAttribute('label'));
  assert.equal(labels.length, 5);
  assert.ok(labels.every((label) => typeof label === 'string' && label.length > 0),
    'menu labels must not depend on FTL registration');
  assert.equal(reg.sections.length, 1);
  assert.equal(reg.sections[0].paneID, 'litmag-ai-section');
  assert.equal(reg.sections[0].header.l10nID, 'litmag-section-header');
  assert.equal(reg.prefPanes.length, 1);
  assert.equal(reg.prefPanes[0].label, 'LitMag');
  assert.equal(reg.prefPanes[0].id, 'litmag-prefpane');
  assert.match(reg.prefPanes[0].scripts[0], /content\/preferences\.js$/);
  assert.equal(reg.readers.length, 1);
  assert.equal(reg.readers[0][0], 'renderTextSelectionPopup');
  assert.equal(context.LitMag.state.version, '2.0');
  assert.equal(reg.httpCalls.length, 0, 'no engine probe, no sidecar handshake at startup');
  assert.equal(reg.ftl.includes('litmag.ftl'), true);
  assert.equal(reg.injected.length, 1, 'one stylesheet processing instruction per window');
  assert.equal(prefs.get('extensions.litmag.provider'), 'openai');
  assert.equal(prefs.get('extensions.litmag.apiKey'), '');
  assert.equal(prefs.get('extensions.litmag.model'), 'gpt-4o-mini');
  assert.equal(prefs.get('extensions.litmag.engineURL'), undefined);
  assert.equal(context.Zotero.LitMag, context.LitMag, 'core must be reachable from the prefs pane');
  assert.ok(doc.nodes.size > 10);
  context.shutdown(DATA, 1);
});

test('shutdown removes every registration and injected DOM node', async () => {
  const env = await loadPlugin();
  const { context, reg } = env;
  context.onMainWindowLoad({ window: env.win });
  const injectedBefore = reg.injected.length;
  assert.equal(injectedBefore, 1, 'stylesheet injection is idempotent across window loads');
  context.shutdown(DATA, 1);
  assert.equal(reg.unregisteredMenus.length, 0, 'DOM menus were used, so MenuManager has nothing to undo');
  assert.ok(reg.unregisteredSections.length >= 1);
  assert.equal(reg.unregisteredReaders.length, 1);
  assert.equal(env.doc.nodes.get('menu_ToolsPopup').children.length, 0);
  assert.equal(env.doc.nodes.get('zotero-itemmenu').children.length, 0);
  assert.ok(reg.nodesRemoved >= 1);
  assert.equal(reg.chromeDestructed, 1);
  assert.equal(context.LitMag, undefined);
});

test('hand-built menus work even when MenuManager is missing', async () => {
  const env = await loadPlugin({ noMenuManager: true });
  const { reg, doc } = env;
  assert.equal(reg.menus.length, 0);
  assert.equal(doc.nodes.get('menu_ToolsPopup').children.length, 4);
  assert.equal(doc.nodes.get('zotero-itemmenu').children.length, 1);
  env.context.shutdown(DATA, 1);
});

test('MenuManager is the fallback when the XUL popups are missing', async () => {
  const env = await loadPlugin({ noMenuPopups: true });
  assert.equal(env.reg.menus.length, 5);
  assert.deepEqual(env.reg.menus.map((m) => m.target), [
    'main/menubar/tools', 'main/menubar/tools', 'main/library/item',
    'main/menubar/tools', 'main/menubar/tools',
  ]);
  assert.ok(env.reg.menus.every((m) => typeof m.label === 'string' && m.label.length > 0));
  env.context.shutdown(DATA, 1);
  assert.equal(env.reg.unregisteredMenus.length, 5);
});

test('item pane section renders a real conversation panel for a regular item', async () => {
  const env = await loadPlugin();
  const section = env.reg.sections[0];
  const body = new FakeNode('div', env.doc);
  const enabled = [];
  section.onItemChange({ item: fakeItem(), setEnabled: (v) => enabled.push(v) });
  assert.deepEqual(enabled, [true]);
  section.onRender({ doc: env.doc, body, item: fakeItem() });
  assert.equal(body.children.length, 1);
  assert.match(body.children[0].attrs.class, /litmag-panel/);
  env.context.shutdown(DATA, 1);
});

test('reader selection popup offers three LitMag actions', async () => {
  const env = await loadPlugin();
  const handler = env.reg.readers[0][1];
  const appended = [];
  handler({
    doc: env.doc,
    params: { annotation: { text: 'identification strategy' } },
    append: (node) => appended.push(node),
  });
  assert.equal(appended.length, 3);
  assert.deepEqual(appended.map((n) => n.textContent), [
    'LitMag：解释这段', 'LitMag：翻译这段', 'LitMag：就此提问',
  ]);
  env.context.shutdown(DATA, 1);
});

test('opening the assistant creates an in-window floating panel, not another process', async () => {
  const env = await loadPlugin();
  const open = env.doc.nodes.get('menu_ToolsPopup').children
    .find((n) => n.getAttribute('label') === 'LitMag：打开 AI 助手');
  assert.ok(open, 'the XUL menu item must be injected');
  open.dispatch('command');
  assert.equal(env.doc.body.children.length, 1);
  assert.match(env.doc.body.children[0].attrs.class, /litmag-float/);
  assert.equal(env.reg.httpCalls.length, 0);
  assert.equal(env.reg.dialogs.length, 0, 'no external window or browser is launched');
  env.context.shutdown(DATA, 1);
});

test('status menu reports the user-configured endpoint and never touches removed Zotero 10 getters', async () => {
  const env = await loadPlugin({ prefs: { apiKey: 'sk-test-key', model: 'deepseek-chat', baseURL: 'https://api.deepseek.com' } });
  env.Zotero.getSelectedCollection = () => { throw new Error('removed in Zotero 10'); };
  env.Zotero.getSelectedLibraryID = () => { throw new Error('removed in Zotero 10'); };
  const status = env.doc.nodes.get('menu_ToolsPopup').children
    .find((n) => n.getAttribute('label') === 'LitMag：状态');
  assert.ok(status);
  status.dispatch('command');
  const message = env.reg.alerts.at(-1);
  assert.match(message, /LitMag v2\.0/);
  assert.match(message, /deepseek-chat/);
  assert.match(message, /https:\/\/api\.deepseek\.com\/v1\/chat\/completions/);
  assert.match(message, /无外部进程/);
  assert.doesNotMatch(message, /removed in Zotero 10/);
  env.context.shutdown(DATA, 1);
});

test('bootstrap loads every content module in dependency order', async () => {
  const env = await loadPlugin();
  const bootstrap = fs.readFileSync(path.join(root, 'bootstrap.js'), 'utf8');
  assert.match(bootstrap, /LITMAG_MODULES/);
  for (const name of ['core', 'http', 'ai', 'context', 'prompts', 'session', 'ui', 'menus']) {
    assert.ok(bootstrap.indexOf(`'${name}.js'`) >= 0, `missing ${name}.js in load order`);
    const attached = name === 'core' ? 'pref' : (name === 'menus' ? 'init' : name);
    assert.ok(env.context.LitMag[attached], `${name} module did not attach`);
  }
  assert.equal(vm.runInContext('typeof LitMag.ai.chat', env.context), 'function');
  env.context.shutdown(DATA, 1);
});
