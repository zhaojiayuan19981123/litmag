/* LitMag core: shared state, preferences and small DOM/string helpers.
 * Loaded first by bootstrap.js; every other module extends `LitMag`.
 */

var LitMag = (function () {
  'use strict';

  var PLUGIN_ID = 'litmag@zhaojiayuan19981123.github.io';
  var PREFIX = 'extensions.litmag.';

  /* Mirrors prefs.js; used only if the defaults file was not picked up. */
  var DEFAULTS = {
    provider: 'openai',
    baseURL: 'https://api.openai.com/v1',
    fullURL: false,
    apiKey: '',
    model: 'gpt-4o-mini',
    temperature: '0.3',
    maxTokens: 4096,
    stream: true,
    systemPrompt: '你是嵌入在 Zotero 中的科研助手。基于提供的文献资料严谨作答，用简体中文；资料没有依据时明确说明，不要编造。',
    profiles: '[]',
    contextChars: 24000,
    includeFulltext: true,
    includeAnnotations: true,
    includeNotes: false,
    historyTurns: 8,
    enableSection: true,
    enableReader: true,
    enableMenus: true,
  };

  var state = {
    id: PLUGIN_ID,
    version: '2.0',
    rootURI: '',
    menus: [],
    sectionID: null,
    sectionPaneID: 'litmag-ai-section',
    prefsPaneID: null,
    readerHandlers: [],
    domNodes: [],
    chatWindows: [],
    sessions: {},
    shuttingDown: false,
  };

  function pref(key, fallback) {
    try {
      if (typeof Zotero !== 'undefined' && Zotero.Prefs && Zotero.Prefs.get) {
        var v = Zotero.Prefs.get(PREFIX + key, true);
        if (v !== undefined && v !== null && v !== '') return v;
      }
    }
    catch (e) { /* preference branch may not exist yet */ }
    return fallback === undefined ? DEFAULTS[key] : fallback;
  }

  function setPref(key, value) {
    try {
      if (typeof Zotero !== 'undefined' && Zotero.Prefs && Zotero.Prefs.set) {
        return Zotero.Prefs.set(PREFIX + key, value, true);
      }
    }
    catch (e) { /* ignore */ }
    return undefined;
  }

  function jsonPref(key, fallback) {
    var raw = String(pref(key, '') || '');
    if (!raw) return fallback;
    try {
      var parsed = JSON.parse(raw);
      return (parsed === null || parsed === undefined) ? fallback : parsed;
    }
    catch (e) { return fallback; }
  }

  function setJSONPref(key, value) {
    return setPref(key, JSON.stringify(value));
  }

  function ensureDefaults() {
    Object.keys(DEFAULTS).forEach(function (key) {
      var current;
      try { current = Zotero.Prefs.get(PREFIX + key, true); }
      catch (e) { current = undefined; }
      if (current === undefined || current === null) setPref(key, DEFAULTS[key]);
    });
  }

  function debug(message) {
    try {
      if (typeof Zotero !== 'undefined' && Zotero.debug) Zotero.debug('[LitMag] ' + message);
    }
    catch (e) { /* ignore */ }
  }

  function notify(message) {
    try {
      if (typeof Services !== 'undefined' && Services.prompt && Services.prompt.alert) {
        Services.prompt.alert(null, 'LitMag', message);
        return;
      }
    }
    catch (e) { /* fall through */ }
    try {
      if (typeof Zotero !== 'undefined' && typeof Zotero.alert === 'function') {
        Zotero.alert(message);
        return;
      }
    }
    catch (e2) { /* fall through */ }
    debug(message);
  }

  function escapeHTML(text) {
    return String(text === undefined || text === null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* A deliberately small Markdown renderer: headings, bold, inline code,
   * fenced code blocks and line breaks. No third-party dependency inside XPI. */
  function renderText(text) {
    var lines = String(text || '').split('\n');
    var out = [];
    var inCode = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^\s*```/.test(line)) {
        inCode = !inCode;
        out.push(inCode ? '<pre><code>' : '</code></pre>');
        continue;
      }
      var safe = escapeHTML(line);
      if (inCode) { out.push(safe + '\n'); continue; }
      safe = safe.replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/^#{1,6}\s+(.*)$/, '<strong>$1</strong>')
        .replace(/^[-*]\s+/, '• ');
      out.push(safe + '<br>');
    }
    if (inCode) out.push('</code></pre>');
    return out.join('');
  }

  function el(doc, tag, className, text) {
    var node;
    try { node = doc.createElementNS('http://www.w3.org/1999/xhtml', tag); }
    catch (e) { node = doc.createElement(tag); }
    if (className) node.setAttribute('class', className);
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function button(doc, label, className, handler) {
    var node = el(doc, 'button', className || 'litmag-btn', label);
    node.setAttribute('type', 'button');
    if (typeof handler === 'function') node.addEventListener('click', handler);
    return node;
  }

  function copyText(text) {
    try {
      var util = Zotero.Utilities && Zotero.Utilities.Internal;
      if (util && typeof util.copyTextToClipboard === 'function') {
        util.copyTextToClipboard(String(text));
        return true;
      }
    }
    catch (e) { /* fall through */ }
    try {
      var helper = Components.classes['@mozilla.org/widget/clipboardhelper;1']
        .getService(Components.interfaces.nsIClipboardHelper);
      helper.copyString(String(text));
      return true;
    }
    catch (e2) { /* fall through */ }
    return false;
  }

  function openPreferences() {
    try {
      var panes = Zotero.PreferencePanes;
      if (panes && typeof panes.open === 'function') {
        panes.open(state.prefsPaneID || 'litmag-prefpane');
        return true;
      }
    }
    catch (e) { /* fall through */ }
    try {
      var win = Zotero.getMainWindow && Zotero.getMainWindow();
      if (win && win.ZoteroPane && typeof win.ZoteroPane.openPreferences === 'function') {
        win.ZoteroPane.openPreferences();
        return true;
      }
    }
    catch (e2) { /* fall through */ }
    notify('请在 Zotero 设置中打开「LitMag」页面填写模型信息。');
    return false;
  }

  return {
    PLUGIN_ID: PLUGIN_ID,
    PREFIX: PREFIX,
    DEFAULTS: DEFAULTS,
    state: state,
    pref: pref,
    setPref: setPref,
    jsonPref: jsonPref,
    setJSONPref: setJSONPref,
    ensureDefaults: ensureDefaults,
    debug: debug,
    notify: notify,
    escapeHTML: escapeHTML,
    renderText: renderText,
    el: el,
    button: button,
    copyText: copyText,
    openPreferences: openPreferences,
  };
})();

/* The preference pane runs in its own window scope. Publishing on the shared
 * Zotero singleton is the only reliable way to reach core/ai from there. */
try {
  if (typeof Zotero !== 'undefined' && Zotero) Zotero.LitMag = LitMag;
}
catch (e) { /* ignore */ }
