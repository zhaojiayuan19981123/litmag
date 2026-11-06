/* Shared harness for the LitMag unit tests: a minimal Zotero/DOM sandbox that
 * loads the real bootstrap.js and the real content modules with node:vm. */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MODULES = [
  'core.js', 'http.js', 'ai.js', 'context.js',
  'prompts.js', 'session.js', 'ui.js', 'menus.js',
];

export const PREF_IDS = [
  'litmag-provider', 'litmag-base-url', 'litmag-full-url', 'litmag-api-key',
  'litmag-model', 'litmag-temperature', 'litmag-max-tokens', 'litmag-stream',
  'litmag-system-prompt', 'litmag-context-chars', 'litmag-history-turns',
  'litmag-include-fulltext', 'litmag-include-annotations', 'litmag-include-notes',
  'litmag-status', 'litmag-profiles', 'litmag-save', 'litmag-test',
  'litmag-fetch-models', 'litmag-profile-save', 'litmag-profile-apply',
  'litmag-profile-delete',
];

export class FakeNode {
  constructor(tag, doc) {
    this.tag = tag;
    this.doc = doc;
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.style = {};
    this.parentNode = null;
    this._text = '';
    this._html = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.scrollTop = 0;
    this.scrollHeight = 1000;
    this.profileItems = [];
  }
  get firstChild() { return this.children[0] || null; }
  get textContent() {
    return this._text || this.children.map((c) => c.textContent).join('');
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); }
  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.children.push(node);
    return node;
  }
  removeChild(node) {
    const i = this.children.indexOf(node);
    if (i >= 0) this.children.splice(i, 1);
    node.parentNode = null;
    return node;
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  dispatch(type, event = {}) {
    for (const fn of this.listeners[type] || []) fn(event);
  }
  querySelector(sel) {
    if (sel === 'menupopup') return this.children.find((c) => c.tag === 'menupopup') || null;
    return null;
  }
  focus() { /* no-op */ }
  removeAllItems() { this.profileItems = []; this.value = ''; }
  appendItem(label, value) {
    this.profileItems.push({ label, value });
    if (!this.value) this.value = value;
  }
}

export function fakeItem(overrides = {}) {
  const fields = {
    title: 'Attention Is All You Need', date: '2017',
    DOI: '10.48550/arXiv.1706.03762', publicationTitle: 'NeurIPS',
    abstractNote: 'The dominant sequence transduction models.', extra: '',
  };
  return {
    id: 1, key: 'ABCD1234', libraryID: 1, parentItem: null,
    isRegularItem: () => true,
    isAttachment: () => false,
    isAnnotation: () => false,
    isPDFAttachment: () => false,
    getField: (name) => fields[name] || '',
    getCreators: () => [{ firstName: 'Ashish', lastName: 'Vaswani' }],
    getTags: () => [{ tag: 'transformer' }],
    getAttachments: () => [],
    getNotes: () => [],
    getBestAttachment: async () => null,
    ...overrides,
  };
}

export function fakeAttachment(overrides = {}) {
  return fakeItem({
    id: 2, key: 'PDF00001',
    isRegularItem: () => false,
    isAttachment: () => true,
    isPDFAttachment: () => true,
    attachmentText: 'Full text page one.',
    getAnnotations: () => [],
    ...overrides,
  });
}

function makeDoc(reg, options = {}) {
  const doc = {
    readyState: 'complete',
    firstChild: null,
    nodes: new Map(),
    createElementNS: (_ns, tag) => new FakeNode(tag, doc),
    createElement: (tag) => new FakeNode(tag, doc),
    createXULElement: (tag) => new FakeNode(tag, doc),
    createProcessingInstruction: (target, data) => {
      const n = new FakeNode('#pi', doc);
      n.attrs = { target, data };
      return n;
    },
    insertBefore: (node) => { node.parentNode = doc; reg.injected.push(node); return node; },
    removeChild: (node) => { node.parentNode = null; reg.nodesRemoved++; },
    getElementById: (id) => doc.nodes.get(id) || null,
    addEventListener: () => {},
  };
  doc.body = new FakeNode('body', doc);
  doc.documentElement = new FakeNode('window', doc);
  for (const id of PREF_IDS) {
    const node = new FakeNode('input', doc);
    node.attrs.id = id;
    doc.nodes.set(id, node);
  }
  if (!options.noMenuPopups) {
    for (const id of ['menu_ToolsPopup', 'zotero-itemmenu']) {
      const popup = new FakeNode('menupopup', doc);
      popup.attrs.id = id;
      doc.nodes.set(id, popup);
    }
  }
  reg.doc = doc;
  return doc;
}

class FakeZoteroItem {
  constructor(type) {
    this.type = type;
    this.note = '';
    this.tags = [];
    this.id = 900 + Math.floor(Math.random() * 100);
  }
  setNote(html) { this.note = html; }
  getNote() { return this.note; }
  addTag(tag) { this.tags.push(tag); }
  async saveTx() { return this; }
}

function makeZotero(reg, prefs, options) {
  const win = {
    document: makeDoc(reg, options),
    MozXULElement: { insertFTLIfNeeded: (file) => reg.ftl.push(file) },
    openDialog: (...args) => reg.dialogs.push(args),
  };
  const httpRequest = options.httpRequest || (async (method, url, opts = {}) => {
    reg.httpCalls.push({ method, url, opts });
    if (options.httpThrows) throw new Error('unreachable');
    return { status: 200, response: JSON.stringify(options.httpResponse || { ok: true }) };
  });

  const Zotero = {
    debug: (msg) => reg.debug.push(String(msg)),
    alert: (msg) => reg.alerts.push(msg),
    Prefs: {
      get: (key) => prefs.get(key),
      set: (key, value) => { prefs.set(key, value); return value; },
    },
    HTTP: { request: httpRequest },
    PDFWorker: {
      getFullText: options.fullText === undefined
        ? async () => 'PDF p.1 method section. PDF p.2 results.'
        : (typeof options.fullText === 'function' ? options.fullText : async () => options.fullText),
    },
    MenuManager: options.noMenuManager ? undefined : {
      registerMenu: (def) => { reg.menus.push(def); return 'menu-' + reg.menus.length; },
      unregisterMenu: (id) => reg.unregisteredMenus.push(id),
    },
    ItemPaneManager: {
      registerSection: (def) => { reg.sections.push(def); return 'section-1'; },
      unregisterSection: (id) => reg.unregisteredSections.push(id),
    },
    PreferencePanes: {
      register: (def) => { reg.prefPanes.push(def); return 'litmag-pane'; },
      open: (id) => reg.prefOpens.push(id),
    },
    Reader: {
      registerEventListener: (...args) => reg.readers.push(args),
      unregisterEventListener: (...args) => reg.unregisteredReaders.push(args),
    },
    getMainWindow: () => win,
    getMainWindows: () => [win],
    getActiveZoteroPane: () => ({
      getSelectedItems: () => (options.selected === undefined ? [fakeItem()] : options.selected),
    }),
    Items: { get: (id) => (options.itemsById && options.itemsById[id]) || null },
    Item: class extends FakeZoteroItem {
      async saveTx() { reg.notes.push(this); return await super.saveTx(); }
    },
    Utilities: { Internal: { copyTextToClipboard: (t) => { reg.clipboard = t; } } },
  };
  return { Zotero, win };
}

export function makeEnv(options = {}) {
  const reg = {
    menus: [], sections: [], prefPanes: [], prefOpens: [], readers: [],
    unregisteredMenus: [], unregisteredSections: [], unregisteredReaders: [],
    httpCalls: [], dialogs: [], alerts: [], ftl: [], injected: [], debug: [],
    nodesRemoved: 0, notes: [], clipboard: '', chromeDestructed: 0,
  };
  const prefs = new Map();
  if (options.prefs) {
    for (const [k, v] of Object.entries(options.prefs)) {
      prefs.set(k.startsWith('extensions.') ? k : 'extensions.litmag.' + k, v);
    }
  }
  const { Zotero, win } = makeZotero(reg, prefs, options);
  const codes = {};
  for (const name of MODULES) codes[name] = fs.readFileSync(path.join(root, 'content', name), 'utf8');

  const Components = {
    classes: {
      '@mozilla.org/addons/addon-manager-startup;1': {
        getService: () => ({ registerChrome: () => ({ destruct: () => { reg.chromeDestructed++; } }) }),
      },
      '@mozilla.org/widget/clipboardhelper;1': {
        getService: () => ({ copyString: (t) => { reg.clipboard = t; } }),
      },
    },
    interfaces: { amIAddonManagerStartup: {}, nsIClipboardHelper: {} },
  };
  const Services = {
    io: { newURI: (uri) => ({ spec: uri }) },
    scriptloader: {
      loadSubScript: (uri) => {
        const name = String(uri).split('/').pop();
        if (!codes[name]) throw new Error('unexpected module: ' + uri);
        vm.runInContext(codes[name], context, { filename: 'content/' + name });
      },
    },
    prompt: {
      alert: (_win, _title, msg) => reg.alerts.push(msg),
      select: (_win, _title, _text, list, index) => { index.value = 0; return !!list.length; },
      prompt: (_win, _title, _text, value) => { value.value = '测试配置'; return true; },
    },
  };

  const context = vm.createContext({
    Zotero, Services, Components,
    console, URL, Date, Math, JSON, RegExp, Error, Promise, Object, Array,
    String, Number, Boolean, Map, Set, WeakMap, WeakSet, Symbol,
    setTimeout, clearTimeout, setInterval, clearInterval,
    encodeURIComponent, decodeURIComponent,
    Ci: { nsIFile: {} },
    IOUtils: { readUTF8: async () => '' },
    PathUtils: { join: (...parts) => parts.join('/') },
  });
  context._reg = reg;
  return { context, reg, prefs, Zotero, win, doc: win.document, Services, codes };
}

export async function loadPlugin(options = {}) {
  const env = makeEnv(options);
  const bootstrap = fs.readFileSync(path.join(root, 'bootstrap.js'), 'utf8');
  vm.runInContext(bootstrap, env.context, { filename: 'bootstrap.js' });
  await env.context.startup(
    { id: 'litmag@zhaojiayuan19981123.github.io', version: '2.0', rootURI: 'file:///litmag/' }, 1);
  return env;
}

export function loadModulesOnly(options = {}) {
  const env = makeEnv(options);
  for (const name of MODULES) {
    vm.runInContext(env.codes[name], env.context, { filename: 'content/' + name });
  }
  return env;
}

export function loadPrefPane(env) {
  const code = fs.readFileSync(path.join(root, 'content/preferences.js'), 'utf8');
  const paneContext = vm.createContext({
    Zotero: env.Zotero, Services: env.Services,
    document: env.doc, window: env.win,
    console, Object, Array, String, Number, Boolean, Date, JSON, Promise, Error,
  });
  vm.runInContext(code, paneContext, { filename: 'content/preferences.js' });
  return paneContext;
}
