/* LitMag - plugin core.
 *
 * Loaded by bootstrap.js with Services.scriptloader.loadSubScript(), so it runs
 * in the plugin's privileged sandbox: Zotero, Services, Cc, Ci, IOUtils and
 * PathUtils are globals here, but Node APIs are NOT available.
 *
 * Design for v1.0 (Zotero 10 only):
 *   - Zotero stays the single source of truth for items / attachments / notes.
 *   - A thin, zero-dependency Node "engine" process exposes a stable local URL
 *     and proxies the existing workbench. The plugin never bundles Express,
 *     ONNX or any native binary.
 *   - If the engine is not running, the plugin still installs, still shows its
 *     item pane and menus, and degrades to opening the workbench externally.
 */

var LitMag = (function () {
  'use strict';

  var PLUGIN_ID = 'litmag@zhaojiayuan19981123.github.io';
  var PROTOCOL = 1;
  var DEFAULT_ENGINE_URL = 'http://127.0.0.1:23127';
  var DEFAULT_WORKBENCH_URL = 'http://127.0.0.1:3000';
  var PREF_ENGINE_URL = 'extensions.litmag.engineURL';
  var PREF_WORKBENCH_URL = 'extensions.litmag.workbenchURL';
  var PREF_TOKEN = 'extensions.litmag.engineToken';
  var PREF_AUTO_PROBE = 'extensions.litmag.autoProbe';
  var PREF_EMBEDDED = 'extensions.litmag.embeddedWindow';

  var state = {
    id: PLUGIN_ID,
    version: '',
    rootURI: '',
    token: '',
    menus: [],
    sectionID: null,
    sectionPaneID: 'litmag-section',
    readerHandlers: [],
    domNodes: [],
    timer: null,
    lastStatus: null,
    shuttingDown: false,
  };

  /* ---------- preferences ---------- */

  function pref(key, fallback) {
    try {
      if (typeof Zotero !== 'undefined' && Zotero.Prefs && Zotero.Prefs.get) {
        var v = Zotero.Prefs.get(key, true);
        if (v !== undefined && v !== null && v !== '') return v;
      }
    }
    catch (e) { /* preference branch may not exist yet */ }
    return fallback;
  }

  function setPref(key, value) {
    try {
      if (typeof Zotero !== 'undefined' && Zotero.Prefs && Zotero.Prefs.set) {
        Zotero.Prefs.set(key, value, true);
      }
    }
    catch (e) { /* ignore */ }
  }

  function engineURL() {
    return String(pref(PREF_ENGINE_URL, DEFAULT_ENGINE_URL)).replace(/\/+$/, '');
  }

  function workbenchURL() {
    return String(pref(PREF_WORKBENCH_URL, DEFAULT_WORKBENCH_URL)).replace(/\/+$/, '');
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

  /* ---------- engine token discovery ---------- */

  function homeTokenPath() {
    try {
      var home = Services.dirsvc.get('Home', Ci.nsIFile).path;
      if (typeof PathUtils !== 'undefined' && PathUtils.join) {
        return PathUtils.join(home, '.litmag', 'engine.json');
      }
      var sep = home.indexOf('\\') >= 0 ? '\\' : '/';
      return home + sep + '.litmag' + sep + 'engine.json';
    }
    catch (e) { return ''; }
  }

  async function loadToken() {
    var manual = String(pref(PREF_TOKEN, '') || '').trim();
    if (manual) return manual;
    var p = homeTokenPath();
    if (!p) return '';
    try {
      var text;
      if (typeof IOUtils !== 'undefined' && IOUtils.readUTF8) {
        text = await IOUtils.readUTF8(p);
      }
      else if (typeof Zotero !== 'undefined' && Zotero.File && Zotero.File.getContentsAsync) {
        text = await Zotero.File.getContentsAsync(p);
      }
      if (!text) return '';
      var info = JSON.parse(text);
      return info && info.token ? String(info.token) : '';
    }
    catch (e) {
      debug('token auto-detection unavailable: ' + (e && e.message ? e.message : e));
      return '';
    }
  }

  /* ---------- HTTP (privileged scope: no CORS) ---------- */

  function authHeaders(extra) {
    var headers = { 'X-LitMag-Token': state.token || '' };
    if (extra) {
      for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) headers[k] = extra[k];
    }
    return headers;
  }

  async function request(method, url, options) {
    options = options || {};
    var opts = {
      headers: authHeaders(options.headers),
      timeout: options.timeout || 4000,
    };
    if (options.body !== undefined) opts.body = options.body;

    if (typeof Zotero !== 'undefined' && Zotero.HTTP && Zotero.HTTP.request) {
      var res = await Zotero.HTTP.request(method, url, opts);
      var text = typeof res === 'string' ? res : (res && res.responseText) || '';
      return text ? JSON.parse(text) : {};
    }
    if (typeof fetch === 'function') {
      var init = { method: method, headers: opts.headers };
      if (options.body !== undefined) init.body = opts.body;
      var r = await fetch(url, init);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    }
    throw new Error('no HTTP transport available');
  }

  async function probe() {
    var url = engineURL() + '/api/litmag/handshake';
    try {
      var data = await request('GET', url, { timeout: 2500 });
      var ok = !!data && data.ok === true && Number(data.protocol) === PROTOCOL;
      state.lastStatus = { ok: ok, data: data || null, checkedAt: Date.now() };
      return state.lastStatus;
    }
    catch (e) {
      state.lastStatus = { ok: false, error: e && e.message ? e.message : String(e), checkedAt: Date.now() };
      return state.lastStatus;
    }
  }

  async function pushContext(items, extra) {
    var payload = {
      source: 'zotero-plugin',
      pluginVersion: state.version,
      protocol: PROTOCOL,
      sentAt: new Date().toISOString(),
      items: serializeItems(items),
    };
    if (extra) {
      for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) payload[k] = extra[k];
    }
    try {
      await request('POST', engineURL() + '/api/litmag/context', {
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
        timeout: 4000,
      });
      return true;
    }
    catch (e) {
      debug('pushContext failed: ' + (e && e.message ? e.message : e));
      return false;
    }
  }

  /* ---------- Zotero items ---------- */

  function selectedItems() {
    try {
      var pane = Zotero.getActiveZoteroPane();
      var items = pane && pane.getSelectedItems ? pane.getSelectedItems() : [];
      return (items || []).filter(function (it) {
        try { return it && it.isRegularItem(); } catch (e) { return false; }
      });
    }
    catch (e) { return []; }
  }

  function field(item, name) {
    try { return String(item.getField(name) || ''); } catch (e) { return ''; }
  }

  function serializeItems(items) {
    return (items || []).map(function (item) {
      var out = {
        key: '', libraryID: null, title: '', creators: '', date: '',
        DOI: '', publicationTitle: '', abstractNote: '', extra: '', attachments: [],
      };
      try { out.key = String(item.key || item.id || ''); } catch (e) { /* ignore */ }
      try { out.libraryID = item.libraryID; } catch (e) { /* ignore */ }
      out.title = field(item, 'title');
      out.date = field(item, 'date');
      out.DOI = field(item, 'DOI');
      out.publicationTitle = field(item, 'publicationTitle');
      out.abstractNote = field(item, 'abstractNote');
      out.extra = field(item, 'extra');
      try {
        var creators = item.getCreators() || [];
        out.creators = creators.map(function (c) {
          return [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
        }).filter(Boolean).join('; ');
      }
      catch (e) { /* ignore */ }
      try {
        var ids = item.getAttachments() || [];
        out.attachments = ids.map(function (id) {
          var att = Zotero.Items.get(id);
          if (!att) return null;
          var a = { key: '', title: '', path: '', contentType: '' };
          try { a.key = String(att.key || att.id || ''); } catch (e2) { /* ignore */ }
          try { a.title = String(att.getField('title') || ''); } catch (e2) { /* ignore */ }
          try { a.contentType = String(att.attachmentContentType || ''); } catch (e2) { /* ignore */ }
          try { a.path = String(att.getFilePath ? att.getFilePath() : ''); } catch (e2) { /* ignore */ }
          return a;
        }).filter(Boolean);
      }
      catch (e) { /* ignore */ }
      return out;
    });
  }

  /* ---------- menus ---------- */

  function registerMenus() {
    var mm = typeof Zotero !== 'undefined' ? Zotero.MenuManager : null;
    if (!mm || typeof mm.registerMenu !== 'function') return false;
    var ok = false;
    var defs = [
      {
        menuID: 'litmag-tools-open', pluginID: PLUGIN_ID, target: 'main/menubar/tools',
        menuType: 'menuitem', l10nID: 'litmag-menu-open',
        onCommand: function () { openWorkbench().catch(function (e) { debug('open failed: ' + e); }); },
      },
      {
        menuID: 'litmag-item-analyze', pluginID: PLUGIN_ID, target: 'main/library/item',
        menuType: 'menuitem', l10nID: 'litmag-menu-analyze',
        onCommand: function () { openWorkbench({ items: selectedItems() }).catch(function (e) { debug('analyze failed: ' + e); }); },
      },
      {
        menuID: 'litmag-tools-status', pluginID: PLUGIN_ID, target: 'main/menubar/tools',
        menuType: 'menuitem', l10nID: 'litmag-menu-status',
        onCommand: function () { checkStatus(); },
      },
    ];
    for (var i = 0; i < defs.length; i++) {
      try {
        var id = mm.registerMenu(defs[i]);
        if (id) state.menus.push(id);
        ok = true;
      }
      catch (e) {
        debug('MenuManager.registerMenu failed for ' + defs[i].menuID + ': ' + (e && e.message ? e.message : e));
      }
    }
    return ok;
  }

  function unregisterMenus() {
    var mm = typeof Zotero !== 'undefined' ? Zotero.MenuManager : null;
    if (!mm || typeof mm.unregisterMenu !== 'function') return;
    state.menus.forEach(function (id) {
      try { mm.unregisterMenu(id); } catch (e) { /* ignore */ }
    });
    state.menus = [];
  }

  /* DOM fallback: Zotero 10 recommends MenuManager, but keep a working menu
   * if the API shape differs in a future 10.x build. */
  function injectMenusIntoWindow(win) {
    if (state.menus.length) return;
    var doc = win.document;
    if (!doc) return;
    addMenuItem(doc, win, 'menu_ToolsPopup', '打开 LitMag 工作台', function () {
      openWorkbench().catch(function (e) { debug('open failed: ' + e); });
    });
    addMenuItem(doc, win, 'zotero-itemmenu', '用 LitMag 分析选中条目', function () {
      openWorkbench({ items: selectedItems() }).catch(function (e) { debug('analyze failed: ' + e); });
    });
  }

  function addMenuItem(doc, win, popupID, label, handler) {
    try {
      var popup = doc.getElementById(popupID);
      if (!popup) return;
      var node = doc.createXULElement ? doc.createXULElement('menuitem') : doc.createElement('menuitem');
      node.setAttribute('label', label);
      node.setAttribute('data-litmag', '1');
      node.addEventListener('command', handler);
      popup.appendChild(node);
      state.domNodes.push({ win: win, node: node });
    }
    catch (e) { debug('inject menu failed: ' + (e && e.message ? e.message : e)); }
  }

  /* ---------- item pane section ---------- */

  function htmlEl(doc, tag, className, text) {
    var el;
    try {
      el = doc.createElementNS('http://www.w3.org/1999/xhtml', tag);
    }
    catch (e) {
      el = doc.createElement(tag);
    }
    if (className) el.setAttribute('class', className);
    if (text !== undefined && text !== null) el.textContent = String(text);
    return el;
  }

  function renderSection(doc, body, item) {
    try {
      while (body.firstChild) body.removeChild(body.firstChild);
    }
    catch (e) { /* ignore */ }

    var wrap = htmlEl(doc, 'div', 'litmag-section');
    if (!item) {
      wrap.appendChild(htmlEl(doc, 'div', 'litmag-section-meta', '选中一条文献以查看 LitMag 信息'));
      body.appendChild(wrap);
      return;
    }

    var title = field(item, 'title') || '(无标题)';
    wrap.appendChild(htmlEl(doc, 'div', 'litmag-section-title', title));

    var creators = '';
    try {
      creators = (item.getCreators() || []).map(function (c) { return c.lastName || ''; })
        .filter(Boolean).slice(0, 3).join(', ');
    }
    catch (e) { /* ignore */ }
    var meta = [creators, field(item, 'date'), field(item, 'publicationTitle')]
      .filter(Boolean).join(' · ');
    if (meta) wrap.appendChild(htmlEl(doc, 'div', 'litmag-section-meta', meta));

    var status = state.lastStatus && state.lastStatus.ok;
    wrap.appendChild(htmlEl(doc, 'div',
      status ? 'litmag-section-meta litmag-section-status-ok' : 'litmag-section-meta litmag-section-status-off',
      status ? '引擎已连接' : '引擎未启动（功能受限）'));

    var actions = htmlEl(doc, 'div', 'litmag-section-actions');
    var openBtn = htmlEl(doc, 'button', '', '在 LitMag 中打开');
    openBtn.addEventListener('click', function () {
      openWorkbench({ items: [item] }).catch(function (e) { debug('open failed: ' + e); });
    });
    var analyzeBtn = htmlEl(doc, 'button', '', '分析此条目');
    analyzeBtn.addEventListener('click', function () {
      openWorkbench({ items: [item], question: '请解析并总结这条文献' })
        .catch(function (e) { debug('analyze failed: ' + e); });
    });
    actions.appendChild(openBtn);
    actions.appendChild(analyzeBtn);
    wrap.appendChild(actions);
    body.appendChild(wrap);
  }

  function registerSection() {
    var ipm = typeof Zotero !== 'undefined' ? Zotero.ItemPaneManager : null;
    if (!ipm || typeof ipm.registerSection !== 'function') return;
    try {
      state.sectionID = ipm.registerSection({
        paneID: state.sectionPaneID,
        pluginID: PLUGIN_ID,
        header: {
          l10nID: 'litmag-section-header',
          icon: state.rootURI + 'content/icon16.svg',
        },
        sidenav: {
          l10nID: 'litmag-section-header',
          icon: state.rootURI + 'content/icon20.svg',
        },
        onItemChange: function (args) {
          try {
            var enabled = !!(args && args.item && args.item.isRegularItem && args.item.isRegularItem());
            if (args && typeof args.setEnabled === 'function') args.setEnabled(enabled);
          }
          catch (e) { /* ignore */ }
        },
        onRender: function (args) {
          renderSection(args.doc, args.body, args.item);
        },
      });
    }
    catch (e) {
      debug('registerSection failed: ' + (e && e.message ? e.message : e));
    }
  }

  function unregisterSection() {
    var ipm = typeof Zotero !== 'undefined' ? Zotero.ItemPaneManager : null;
    if (!ipm || typeof ipm.unregisterSection !== 'function') return;
    var candidates = [state.sectionID, state.sectionPaneID].filter(Boolean);
    candidates.forEach(function (id) {
      try { ipm.unregisterSection(id); } catch (e) { /* ignore */ }
    });
    state.sectionID = null;
  }

  /* ---------- preference pane ---------- */

  function registerPreferencePane() {
    var pp = typeof Zotero !== 'undefined' ? Zotero.PreferencePanes : null;
    if (!pp || typeof pp.register !== 'function') return;
    try {
      pp.register({
        pluginID: PLUGIN_ID,
        label: 'LitMag',
        src: state.rootURI + 'content/preferences.xhtml',
        scripts: [state.rootURI + 'content/preferences.js'],
        stylesheets: [state.rootURI + 'skin/litmag.css'],
        helpURL: 'https://github.com/zhaojiayuan19981123/litmag',
      });
    }
    catch (e) {
      debug('PreferencePanes.register failed: ' + (e && e.message ? e.message : e));
    }
  }

  /* ---------- reader integration ---------- */

  function registerReader() {
    var reader = typeof Zotero !== 'undefined' ? Zotero.Reader : null;
    if (!reader || typeof reader.registerEventListener !== 'function') return;
    var handler = function (event) {
      try {
        var doc = event.doc;
        var params = event.params || {};
        var append = event.append;
        if (!doc || typeof append !== 'function') return;
        var btn = doc.createElement('button');
        btn.textContent = '用 LitMag 提问';
        btn.setAttribute('class', 'litmag-reader-btn');
        btn.addEventListener('click', function () {
          var text = params.annotation && params.annotation.text ? params.annotation.text : '';
          openWorkbench({ question: text }).catch(function (e) { debug('reader ask failed: ' + e); });
        });
        append(btn);
      }
      catch (e) { debug('reader popup failed: ' + (e && e.message ? e.message : e)); }
    };
    try {
      reader.registerEventListener('renderTextSelectionPopup', handler, PLUGIN_ID);
      state.readerHandlers.push({ type: 'renderTextSelectionPopup', handler: handler });
    }
    catch (e) {
      debug('registerEventListener failed: ' + (e && e.message ? e.message : e));
    }
  }

  function unregisterReader() {
    var reader = typeof Zotero !== 'undefined' ? Zotero.Reader : null;
    if (!reader || typeof reader.unregisterEventListener !== 'function') return;
    state.readerHandlers.forEach(function (entry) {
      try { reader.unregisterEventListener(entry.type, entry.handler); } catch (e) { /* ignore */ }
    });
    state.readerHandlers = [];
  }

  /* ---------- windows ---------- */

  function injectResources(win) {
    try {
      var doc = win.document;
      if (!doc) return;
      if (win.MozXULElement && win.MozXULElement.insertFTLIfNeeded) {
        win.MozXULElement.insertFTLIfNeeded('litmag.ftl');
      }
      var pi = doc.createProcessingInstruction('xml-stylesheet',
        'href="' + state.rootURI + 'skin/litmag.css" type="text/css"');
      doc.insertBefore(pi, doc.firstChild);
      state.domNodes.push({ win: win, node: pi });
    }
    catch (e) { debug('injectResources failed: ' + (e && e.message ? e.message : e)); }
  }

  function onMainWindowLoad(win) {
    if (!win || state.shuttingDown) return;
    injectResources(win);
    injectMenusIntoWindow(win);
  }

  function onMainWindowUnload(win) {
    for (var i = state.domNodes.length - 1; i >= 0; i--) {
      var entry = state.domNodes[i];
      if (entry.win === win || !entry.win) {
        try { if (entry.node && entry.node.parentNode) entry.node.parentNode.removeChild(entry.node); }
        catch (e) { /* ignore */ }
        state.domNodes.splice(i, 1);
      }
    }
  }

  function addToAllWindows() {
    try {
      var wins = typeof Zotero !== 'undefined' && Zotero.getMainWindows ? Zotero.getMainWindows() : [];
      (wins || []).forEach(onMainWindowLoad);
    }
    catch (e) { debug('addToAllWindows failed: ' + (e && e.message ? e.message : e)); }
  }

  function removeFromAllWindows() {
    for (var i = state.domNodes.length - 1; i >= 0; i--) {
      var entry = state.domNodes[i];
      try { if (entry.node && entry.node.parentNode) entry.node.parentNode.removeChild(entry.node); }
      catch (e) { /* ignore */ }
    }
    state.domNodes = [];
  }

  /* ---------- actions ---------- */

  function openExternal(url) {
    try {
      if (typeof Zotero !== 'undefined') {
        if (Zotero.Utilities && Zotero.Utilities.Internal && Zotero.Utilities.Internal.openURL) {
          Zotero.Utilities.Internal.openURL(url);
          return;
        }
        if (typeof Zotero.launchURL === 'function') {
          Zotero.launchURL(url);
          return;
        }
      }
    }
    catch (e) { debug('openExternal failed: ' + (e && e.message ? e.message : e)); }
    notify('请手动打开工作台地址：' + url);
  }

  async function openWorkbench(options) {
    options = options || {};
    var items = options.items || selectedItems();
    var status = await probe();
    if (items.length) await pushContext(items, options.question ? { question: options.question } : null);

    var args = {
      url: engineURL() + '/workbench?litmag=1&token=' + encodeURIComponent(state.token || ''),
      engineURL: engineURL(),
      workbenchURL: workbenchURL(),
      engineOnline: !!(status && status.ok),
      itemCount: items.length,
      rootURI: state.rootURI,
      openExternal: openExternal,
    };

    var embedded = pref(PREF_EMBEDDED, true) === true || pref(PREF_EMBEDDED, true) === 'true';
    var win = null;
    try { win = typeof Zotero !== 'undefined' && Zotero.getMainWindow ? Zotero.getMainWindow() : null; }
    catch (e) { /* ignore */ }

    if (embedded && win && typeof win.openDialog === 'function') {
      try {
        win.openDialog(state.rootURI + 'content/workbench.xhtml', 'litmag-workbench',
          'chrome,centerscreen,resizable,dialog=no,width=1280,height=840', args);
        return;
      }
      catch (e) {
        debug('openDialog failed, falling back to browser: ' + (e && e.message ? e.message : e));
      }
    }
    openExternal(args.workbenchURL);
  }

  async function checkStatus() {
    var s = await probe();
    if (s.ok) {
      var d = s.data || {};
      notify('LitMag 引擎已连接\n版本：' + (d.version || '?') +
        '\n工作台：' + (d.workbench && d.workbench.online ? '在线' : '未启动（仅插件功能可用）'));
    }
    else {
      notify('LitMag 引擎未启动。\n请运行 litmag-engine 后再试；插件本身的条目面板仍可使用。');
    }
    return s;
  }

  /* ---------- lifecycle ---------- */

  async function init(opts) {
    state.id = (opts && opts.id) || PLUGIN_ID;
    state.version = (opts && opts.version) || '';
    state.rootURI = (opts && opts.rootURI) || '';
    state.shuttingDown = false;

    // Defensive defaults in case prefs.js was not picked up.
    if (!pref(PREF_ENGINE_URL, '')) setPref(PREF_ENGINE_URL, DEFAULT_ENGINE_URL);
    if (!pref(PREF_WORKBENCH_URL, '')) setPref(PREF_WORKBENCH_URL, DEFAULT_WORKBENCH_URL);

    state.token = await loadToken();
    registerMenus();
    registerSection();
    registerPreferencePane();
    registerReader();
    await probe();

    if (pref(PREF_AUTO_PROBE, true) !== false && typeof setInterval === 'function') {
      try {
        state.timer = setInterval(function () { probe(); }, 60000);
        if (state.timer && state.timer.unref) state.timer.unref();
      }
      catch (e) { /* ignore */ }
    }
    debug('initialized v' + state.version + ' for Zotero 10');
    return state;
  }

  function shutdown() {
    state.shuttingDown = true;
    if (state.timer) {
      try { clearInterval(state.timer); } catch (e) { /* ignore */ }
      state.timer = null;
    }
    unregisterMenus();
    unregisterSection();
    unregisterReader();
    state.lastStatus = null;
    debug('shutdown complete');
  }

  return {
    init: init,
    shutdown: shutdown,
    addToAllWindows: addToAllWindows,
    removeFromAllWindows: removeFromAllWindows,
    onMainWindowLoad: onMainWindowLoad,
    onMainWindowUnload: onMainWindowUnload,
    openWorkbench: openWorkbench,
    checkStatus: checkStatus,
    probe: probe,
    pushContext: pushContext,
    serializeItems: serializeItems,
    selectedItems: selectedItems,
    engineURL: engineURL,
    workbenchURL: workbenchURL,
    state: state,
    PLUGIN_ID: PLUGIN_ID,
    PROTOCOL: PROTOCOL,
  };
})();
