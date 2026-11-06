import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bootstrapCode = fs.readFileSync(path.join(root, 'bootstrap.js'), 'utf8');
const coreCode = fs.readFileSync(path.join(root, 'content/litmag.js'), 'utf8');

const HANDSHAKE = {
  ok: true, name: 'litmag-engine', version: '1.0', protocol: 1,
  workbench: { url: 'http://127.0.0.1:3000', online: true },
};

function fakeItem() {
  const fields = {
    title: 'Attention Is All You Need', date: '2017',
    DOI: '10.48550/arXiv.1706.03762', publicationTitle: 'NeurIPS',
    abstractNote: 'The dominant sequence transduction models.', extra: '',
  };
  return {
    key: 'ABCD1234', libraryID: 1,
    isRegularItem: () => true,
    getField: (name) => fields[name] || '',
    getCreators: () => [{ firstName: 'Ashish', lastName: 'Vaswani' }],
    getAttachments: () => [],
  };
}

function makeWindow(reg) {
  const popup = {
    children: [],
    appendChild(node) {
      node.parentNode = popup;
      popup.children.push(node);
      reg.menuNodes.push(node);
    },
    removeChild(node) { node.parentNode = null; reg.nodesRemoved++; },
  };
  const doc = {
    firstChild: null,
    createProcessingInstruction(target, data) {
      return { target, data, parentNode: null };
    },
    insertBefore(node) { node.parentNode = doc; reg.injected.push(node); return node; },
    removeChild(node) { node.parentNode = null; reg.nodesRemoved++; },
    getElementById(id) {
      return (id === 'menu_ToolsPopup' || id === 'zotero-itemmenu') ? popup : null;
    },
    createXULElement(tag) {
      return {
        tag, attrs: {}, parentNode: null,
        setAttribute(k, v) { this.attrs[k] = v; },
        addEventListener() {},
      };
    },
    createElement(tag) { return doc.createXULElement(tag); },
    createElementNS(ns, tag) { return doc.createXULElement(tag); },
  };
  return {
    document: doc,
    MozXULElement: { insertFTLIfNeeded: (file) => reg.ftl.push(file) },
    openDialog: (...args) => reg.dialogs.push(args),
  };
}

function makeContext(options = {}) {
  const reg = {
    menus: [], sections: [], prefPanes: [], readers: [],
    unregisteredMenus: [], unregisteredSections: [], unregisteredReaders: [],
    httpCalls: [], dialogs: [], alerts: [], ftl: [], injected: [], menuNodes: [],
    nodesRemoved: 0, timerCleared: 0,
  };
  const win = makeWindow(reg);
  const prefs = new Map();
  const Zotero = {
    debug: () => {},
    Prefs: {
      get: (key) => prefs.get(key),
      set: (key, value) => prefs.set(key, value),
    },
    HTTP: {
      request: async (method, url, opts) => {
        reg.httpCalls.push({ method, url, opts });
        if (options.httpThrows) throw new Error('engine offline');
        return { responseText: JSON.stringify(HANDSHAKE) };
      },
    },
    MenuManager: options.noMenuManager ? undefined : {
      registerMenu: (def) => { reg.menus.push(def); return 'menu-' + reg.menus.length; },
      unregisterMenu: (id) => reg.unregisteredMenus.push(id),
    },
    ItemPaneManager: {
      registerSection: (def) => { reg.sections.push(def); return 'section-1'; },
      unregisterSection: (id) => reg.unregisteredSections.push(id),
    },
    PreferencePanes: { register: (def) => reg.prefPanes.push(def) },
    Reader: {
      registerEventListener: (...args) => reg.readers.push(args),
      unregisterEventListener: (...args) => reg.unregisteredReaders.push(args),
    },
    getMainWindows: () => [win],
    getMainWindow: () => win,
    getActiveZoteroPane: () => ({ getSelectedItems: () => [fakeItem()] }),
    Items: { get: () => null },
    alert: (msg) => reg.alerts.push(msg),
    Utilities: { Internal: { openURL: (url) => reg.dialogs.push({ type: 'url', url }) } },
  };

  const context = vm.createContext({
    Zotero,
    console,
    Date, JSON, Promise, Object, Array, String, Number, Boolean, Error,
    encodeURIComponent,
    Ci: { nsIFile: {} },
    IOUtils: { readUTF8: async () => { throw new Error('no token file'); } },
    PathUtils: { join: (...parts) => parts.join('/') },
    setInterval: () => ({ unref() {} }),
    clearInterval: () => { reg.timerCleared++; },
  });
  context.Services = {
    scriptloader: {
      loadSubScript(uri) {
        assert.match(uri, /content\/litmag\.js$/);
        vm.runInContext(coreCode, context, { filename: 'content/litmag.js' });
      },
    },
    dirsvc: { get: () => ({ path: '/tmp/litmag-home' }) },
    prompt: { alert: (...args) => reg.alerts.push(args) },
  };
  return { context, reg, win, prefs };
}

async function start(options) {
  const env = makeContext(options);
  vm.runInContext(bootstrapCode, env.context, { filename: 'bootstrap.js' });
  await env.context.startup(
    { id: 'litmag@zhaojiayuan19981123.github.io', version: '1.0', rootURI: 'file:///litmag/' }, 1);
  return env;
}

test('startup registers menus, item pane, preference pane, reader hook and probes the engine', async () => {
  const { context, reg, prefs } = await start();
  assert.equal(reg.menus.length, 3);
  assert.deepEqual(reg.menus.map((m) => m.target), [
    'main/menubar/tools', 'main/library/item', 'main/menubar/tools',
  ]);
  assert.equal(reg.sections.length, 1);
  assert.equal(reg.sections[0].paneID, 'litmag-section');
  assert.equal(reg.prefPanes.length, 1);
  assert.equal(reg.readers.length, 1);
  assert.equal(reg.readers[0][0], 'renderTextSelectionPopup');
  assert.ok(reg.httpCalls.some((c) => c.url.endsWith('/api/litmag/handshake')));
  assert.equal(context.LitMag.engineURL(), 'http://127.0.0.1:23127');
  assert.equal(context.LitMag.workbenchURL(), 'http://127.0.0.1:3000');
  assert.equal(prefs.get('extensions.litmag.engineURL'), 'http://127.0.0.1:23127');
  assert.equal(reg.ftl.includes('litmag.ftl'), true);
  assert.equal(reg.injected.length, 1, 'stylesheet processing instruction injected');
  context.shutdown({ id: 'x', version: '1.0', rootURI: 'file:///litmag/' }, 1);
});

test('openWorkbench pushes the selected item as context and opens an embedded window', async () => {
  const { context, reg } = await start();
  await context.LitMag.openWorkbench({ items: [fakeItem()] });

  const post = reg.httpCalls.find((c) => c.method === 'POST' && c.url.endsWith('/api/litmag/context'));
  assert.ok(post, 'context POST must be sent');
  assert.match(post.opts.body, /Attention Is All You Need/);
  assert.match(post.opts.headers['Content-Type'], /application\/json/);

  const dialog = reg.dialogs.find((d) => Array.isArray(d) && String(d[0]).endsWith('content/workbench.xhtml'));
  assert.ok(dialog, 'workbench window must be opened');
  const args = dialog[3];
  assert.match(args.url, /\/workbench\?litmag=1/);
  assert.equal(args.engineOnline, true);
  assert.equal(args.itemCount, 1);
  context.shutdown({ id: 'x', version: '1.0', rootURI: 'file:///litmag/' }, 1);
});

test('serializeItems maps Zotero fields without touching deprecated selection getters', async () => {
  const { context } = await start();
  const [item] = context.LitMag.serializeItems([fakeItem()]);
  assert.equal(item.key, 'ABCD1234');
  assert.equal(item.title, 'Attention Is All You Need');
  assert.equal(item.DOI, '10.48550/arXiv.1706.03762');
  assert.equal(item.creators, 'Ashish Vaswani');
  assert.deepEqual(item.attachments, []);
  context.shutdown({ id: 'x', version: '1.0', rootURI: 'file:///litmag/' }, 1);
});

test('shutdown unregisters everything and removes injected DOM nodes', async () => {
  const { context, reg, win } = await start();
  context.onMainWindowLoad({ window: win });
  const injectedBefore = reg.injected.length;
  assert.ok(injectedBefore >= 2);
  context.shutdown({ id: 'x', version: '1.0', rootURI: 'file:///litmag/' }, 1);
  assert.equal(reg.unregisteredMenus.length, 3);
  assert.ok(reg.unregisteredSections.length >= 1);
  assert.equal(reg.unregisteredReaders.length, 1);
  assert.equal(reg.timerCleared, 1);
  assert.equal(reg.nodesRemoved, injectedBefore);
  assert.equal(context.LitMag, undefined);
});

test('falls back to DOM menus when MenuManager is unavailable', async () => {
  const { context, reg } = await start({ noMenuManager: true });
  assert.equal(reg.menus.length, 0);
  // addToAllWindows() ran during startup and injected two fallback menu items.
  assert.equal(reg.menuNodes.length, 2);
  context.shutdown({ id: 'x', version: '1.0', rootURI: 'file:///litmag/' }, 1);
});

test('probe never throws when the engine is offline', async () => {
  const { context } = await start({ httpThrows: true });
  const status = await context.LitMag.probe();
  assert.equal(status.ok, false);
  assert.match(String(status.error), /engine offline/);
  const checked = await context.LitMag.checkStatus();
  assert.equal(checked.ok, false);
  context.shutdown({ id: 'x', version: '1.0', rootURI: 'file:///litmag/' }, 1);
});
