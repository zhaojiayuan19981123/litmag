import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlugin, loadModulesOnly, fakeItem } from '../scripts/support.mjs';

const DATA = { id: 'litmag@zhaojiayuan19981123.github.io', version: '2.0', rootURI: 'file:///litmag/' };

const chatResponse = JSON.stringify({ choices: [{ message: { content: '回答内容' } }] });
const httpRequest = async () => ({ status: 200, response: chatResponse });
const PREFS = { apiKey: 'sk-unit-test', model: 'gpt-4o-mini', stream: false, contextChars: 8000 };

function find(node, predicate, out = []) {
  if (predicate(node)) out.push(node);
  for (const child of node.children || []) find(child, predicate, out);
  return out;
}

test('session injects Zotero context on the first turn only, then keeps history', async () => {
  let calls = 0;
  const env = await loadPlugin({
    prefs: PREFS,
    httpRequest: async () => { calls++; return { status: 200, response: chatResponse }; },
  });
  const P = env.context.LitMag;
  const session = P.session.sessionFor('unit-1');
  session.setItems([fakeItem()]);
  const first = await session.send('请总结');
  assert.equal(first.content, '回答内容');
  assert.equal(first.error, false);
  assert.equal(session.turns.length, 2);
  assert.match(session.turns[0].expanded, /【文献资料】/);
  assert.match(session.turns[0].expanded, /Attention Is All You Need/);
  assert.match(first.meta.sources[0], /Attention Is All You Need/);

  const second = await session.send('再问一个问题');
  assert.equal(second.content, '回答内容');
  assert.equal(session.turns.length, 4);
  assert.doesNotMatch(session.turns[2].expanded, /【文献资料】/);
  assert.equal(calls, 2);
  env.context.shutdown(DATA, 1);
});

test('a missing model configuration is shown in the panel, not thrown at the user', async () => {
  const env = await loadPlugin({ prefs: { ...PREFS, apiKey: '' }, httpRequest });
  const session = env.context.LitMag.session.sessionFor('unit-no-key');
  session.setItems([fakeItem()]);
  const updates = [];
  const turn = await session.send('问题', { onUpdate: (t) => updates.push(t.content) });
  assert.equal(turn.error, true);
  assert.match(turn.content, /尚未配置 AI 模型/);
  assert.ok(updates.length >= 1);
  env.context.shutdown(DATA, 1);
});

test('history is capped by the user preference', () => {
  const env = loadModulesOnly({ prefs: { ...PREFS, historyTurns: 2 } });
  const P = env.context.LitMag;
  const session = new P.session.Session('history');
  for (let i = 0; i < 20; i++) {
    session.turns.push({ role: i % 2 ? 'assistant' : 'user', content: 'turn ' + i });
  }
  session.turns.push({ role: 'assistant', content: '' });
  const messages = P.session.historyMessages(session, 'system');
  assert.equal(messages[0].role, 'system');
  assert.ok(messages.length <= 5, '2 turns of history = at most 4 messages + system');
  assert.ok(messages.some((m) => m.content.includes('turn 18')));
  assert.ok(!messages.some((m) => m.content.includes('turn 2 ')), 'old turns are dropped');
});

test('panel renders a conversation and can save/copy the answer inside Zotero', async () => {
  const env = await loadPlugin({ prefs: PREFS, httpRequest });
  const P = env.context.LitMag;
  const panel = P.ui.buildPanel(env.doc, {
    sessionKey: 'unit-panel', items: [fakeItem()], compact: true,
  });
  assert.match(panel.root.attrs.class, /litmag-panel/);
  const chips = find(panel.root, (n) => n.tag === 'button' && /litmag-chip/.test(n.attrs.class || ''));
  assert.ok(chips.length >= 6, 'quick actions are rendered');

  const textarea = find(panel.root, (n) => n.tag === 'textarea')[0];
  textarea.value = '请总结';
  const sendBtn = find(panel.root, (n) => n.tag === 'button' && n.textContent === '发送')[0];
  sendBtn.dispatch('click');
  await new Promise((resolve) => setTimeout(resolve, 40));

  const transcript = find(panel.root, (n) => /litmag-transcript/.test(n.attrs.class || ''))[0];
  assert.equal(transcript.children.length, 2);
  assert.match(find(panel.root, (n) => /litmag-turn-body/.test(n.attrs.class || ''))
    .map((n) => n.innerHTML).join(''), /回答内容/);

  const copyBtn = find(panel.root, (n) => n.tag === 'button' && n.textContent === '复制回答')[0];
  copyBtn.dispatch('click');
  assert.match(env.reg.clipboard, /回答内容/);

  const noteBtn = find(panel.root, (n) => n.tag === 'button' && n.textContent === '存为子笔记')[0];
  noteBtn.dispatch('click');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(env.reg.notes.length, 1);
  assert.match(env.reg.notes[0].getNote(), /回答内容/);
  assert.deepEqual(env.reg.notes[0].tags, ['LitMag']);
  env.context.shutdown(DATA, 1);
});

test('floating panel is a singleton inside the main window and closes cleanly', async () => {
  const env = await loadPlugin({ prefs: PREFS, httpRequest });
  const P = env.context.LitMag;
  const first = P.ui.openFloat({ items: [fakeItem()] });
  const second = P.ui.openFloat({ items: [fakeItem()] });
  assert.equal(first, second);
  assert.equal(env.doc.body.children.length, 1);
  assert.match(first.root.attrs.class, /litmag-float/);
  P.ui.closeFloat();
  assert.equal(env.doc.body.children.length, 0);
  assert.equal(P.ui.currentFloat(), null);
  env.context.shutdown(DATA, 1);
});

test('quick actions carry their own prompt and context mode', async () => {
  const env = await loadPlugin({ prefs: PREFS, httpRequest });
  const P = env.context.LitMag;
  const session = P.session.sessionFor('unit-action');
  session.setItems([fakeItem()]);
  await session.send('', { action: 'extract' });
  assert.match(session.turns[0].expanded, /只输出一个 JSON 对象/);
  assert.match(session.turns[0].expanded, /【文献资料】/);
  assert.equal(P.prompts.get('review').multi, true);
  assert.equal(P.prompts.get('summary').mode, 'full');
  env.context.shutdown(DATA, 1);
});
