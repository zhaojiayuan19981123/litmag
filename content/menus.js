/* LitMag registrations and lifecycle.
 *
 * Zotero 10 notes: only plural selection APIs are used (getSelectedItems);
 * the removed singular getters (getSelectedCollection, collectionTreeRow,
 * itemsView.collectionTreeRow, fulltextWord) are never touched.
 * Menu labels are plain strings rather than FTL IDs so a missing locale file
 * can never produce an empty menu entry.
 */

(function () {
  'use strict';

  var P = LitMag;

  function openWithSelection(question, mode) {
    var items = P.context.selectedItems();
    P.ui.openFloat({ items: items, mode: mode || 'full', question: question });
  }

  var MENU_DEFS = [
    {
      menuID: 'litmag-tools-open', target: 'main/menubar/tools',
      label: 'LitMag：打开 AI 助手',
      run: function () { openWithSelection(''); },
    },
    {
      menuID: 'litmag-tools-review', target: 'main/menubar/tools',
      label: 'LitMag：生成选中文献综述',
      run: function () {
        openWithSelection('请对选中的多篇文献做一段可用于论文的综述：按主题与方法归类，指出共识、分歧与研究空白，每个判断标注「文献 N」。', 'full');
      },
    },
    {
      menuID: 'litmag-item-analyze', target: 'main/library/item',
      label: 'LitMag：分析选中条目',
      run: function () { openWithSelection('请总结这些文献的研究问题、方法、主要结论与局限，并标注页码。', 'full'); },
    },
    {
      menuID: 'litmag-tools-prefs', target: 'main/menubar/tools',
      label: 'LitMag：模型设置',
      run: function () { P.openPreferences(); },
    },
    {
      menuID: 'litmag-tools-status', target: 'main/menubar/tools',
      label: 'LitMag：状态',
      run: function () {
        P.notify('LitMag v' + P.state.version + '\n' + P.ai.statusText() +
          '\n密钥：' + P.ai.maskedKey() +
          '\n接口：' + P.ai.chatEndpoint() +
          '\n数据：仅使用 Zotero 库中的条目、附件与笔记；无外部进程。');
      },
    },
  ];

  function registerMenus() {
    var mm = (typeof Zotero !== 'undefined') ? Zotero.MenuManager : null;
    if (!mm || typeof mm.registerMenu !== 'function') return false;
    var ok = false;
    MENU_DEFS.forEach(function (def) {
      try {
        var id = mm.registerMenu({
          menuID: def.menuID,
          pluginID: P.PLUGIN_ID,
          target: def.target,
          menuType: 'menuitem',
          label: def.label,
          onCommand: function () { try { def.run(); } catch (e) { P.debug('menu: ' + e); } },
        });
        if (id) P.state.menus.push(id);
        ok = true;
      }
      catch (e) { P.debug('registerMenu ' + def.menuID + ': ' + e); }
    });
    return ok;
  }

  function unregisterMenus() {
    var mm = (typeof Zotero !== 'undefined') ? Zotero.MenuManager : null;
    if (!mm || typeof mm.unregisterMenu !== 'function') return;
    P.state.menus.forEach(function (id) {
      try { mm.unregisterMenu(id); } catch (e) { /* ignore */ }
    });
    P.state.menus = [];
  }

  function addMenuItem(doc, win, popupID, def) {
    try {
      var popup = doc.getElementById(popupID);
      if (!popup) return false;
      var children = popup.children || [];
      for (var i = 0; i < children.length; i++) {
        if (children[i] && children[i].getAttribute &&
            children[i].getAttribute('data-litmag') === def.menuID) {
          return true; /* idempotent across repeated window loads */
        }
      }
      var node = doc.createXULElement ? doc.createXULElement('menuitem') : doc.createElement('menuitem');
      node.setAttribute('label', def.label);
      node.setAttribute('data-litmag', def.menuID);
      node.addEventListener('command', function () {
        try { def.run(); } catch (e) { P.debug('menu: ' + e); }
      });
      popup.appendChild(node);
      P.state.domNodes.push({ win: win, node: node });
      return true;
    }
    catch (e) { P.debug('inject menu: ' + e); return false; }
  }

  /* Hand-built XUL menus are the primary route: Zotero 10's MenuManager can
   * register an entry whose submenu never opens (observed by Zotero Prism),
   * while these menuitems are ordinary XUL nodes with a command listener. */
  function injectMenusIntoWindow(win) {
    if (P.pref('enableMenus', true) === false || P.pref('enableMenus', true) === 'false') return 0;
    var doc = win.document;
    if (!doc) return 0;
    var injected = 0;
    MENU_DEFS.forEach(function (def) {
      var popupID = def.target === 'main/library/item' ? 'zotero-itemmenu' : 'menu_ToolsPopup';
      if (addMenuItem(doc, win, popupID, def)) injected++;
    });
    return injected;
  }

  function registerSection() {
    var ipm = (typeof Zotero !== 'undefined') ? Zotero.ItemPaneManager : null;
    if (!ipm || typeof ipm.registerSection !== 'function') return;
    try {
      P.state.sectionID = ipm.registerSection({
        paneID: P.state.sectionPaneID,
        pluginID: P.PLUGIN_ID,
        header: {
          l10nID: 'litmag-section-header',
          label: 'LitMag AI',
          icon: P.state.rootURI + 'content/icon16.svg',
        },
        sidenav: {
          l10nID: 'litmag-section-header',
          label: 'LitMag AI',
          icon: P.state.rootURI + 'content/icon20.svg',
        },
        onItemChange: function (args) {
          try {
            var enabled = !!(args && args.item && args.item.isRegularItem && args.item.isRegularItem());
            if (args && typeof args.setEnabled === 'function') args.setEnabled(enabled);
          }
          catch (e) { /* ignore */ }
        },
        onRender: function (args) { P.ui.renderSection(args); },
      });
    }
    catch (e) { P.debug('registerSection: ' + e); }
  }

  function unregisterSection() {
    var ipm = (typeof Zotero !== 'undefined') ? Zotero.ItemPaneManager : null;
    if (!ipm || typeof ipm.unregisterSection !== 'function') return;
    [P.state.sectionID, P.state.sectionPaneID].filter(Boolean).forEach(function (id) {
      try { ipm.unregisterSection(id); } catch (e) { /* ignore */ }
    });
    P.state.sectionID = null;
  }

  function registerPreferencePane() {
    var pp = (typeof Zotero !== 'undefined') ? Zotero.PreferencePanes : null;
    if (!pp || typeof pp.register !== 'function') return;
    try {
      P.state.prefsPaneID = 'litmag-prefpane';
      var result = pp.register({
        pluginID: P.PLUGIN_ID,
        id: P.state.prefsPaneID,
        label: 'LitMag',
        src: P.state.rootURI + 'content/preferences.xhtml',
        scripts: [P.state.rootURI + 'content/preferences.js'],
        stylesheets: [P.state.rootURI + 'skin/litmag.css'],
        helpURL: 'https://github.com/zhaojiayuan19981123/litmag',
      });
      if (result && typeof result.then === 'function') {
        result.then(function (id) { if (id) P.state.prefsPaneID = id; })
          .catch(function (e) { P.debug('prefs pane id: ' + e); });
      }
      else if (result) P.state.prefsPaneID = result;
    }
    catch (e) { P.debug('PreferencePanes.register: ' + e); }
  }

  function selectedTextFromReader(params) {
    params = params || {};
    var text = '';
    try {
      if (params.annotation && params.annotation.text) text = params.annotation.text;
      else if (params.text) text = params.text;
      else if (params.selection && params.selection.text) text = params.selection.text;
    }
    catch (e) { /* ignore */ }
    return String(text || '').trim().slice(0, 4000);
  }

  function registerReader() {
    var reader = (typeof Zotero !== 'undefined') ? Zotero.Reader : null;
    if (!reader || typeof reader.registerEventListener !== 'function') return;
    var handler = function (event) {
      try {
        var doc = event.doc;
        var append = event.append;
        if (!doc || typeof append !== 'function') return;
        var text = selectedTextFromReader(event.params);
        [
          { label: 'LitMag：解释这段', q: '请结合文献上下文解释这段文字，并指出它在论证中的作用：\n\n' },
          { label: 'LitMag：翻译这段', q: '请把这段文字翻译成通顺的简体中文，保留术语并给出术语表：\n\n' },
          { label: 'LitMag：就此提问', q: '针对这段文字，提出 3 个值得追问的研究问题：\n\n' },
        ].forEach(function (action) {
          var btn = doc.createElement('button');
          btn.textContent = action.label;
          btn.setAttribute('class', 'litmag-reader-btn');
          btn.addEventListener('click', function () {
            openWithSelection(action.q + text, 'annotated');
          });
          append(btn);
        });
      }
      catch (e) { P.debug('reader popup: ' + e); }
    };
    try {
      reader.registerEventListener('renderTextSelectionPopup', handler, P.PLUGIN_ID);
      P.state.readerHandlers.push({ type: 'renderTextSelectionPopup', handler: handler });
    }
    catch (e) { P.debug('registerEventListener: ' + e); }
  }

  function unregisterReader() {
    var reader = (typeof Zotero !== 'undefined') ? Zotero.Reader : null;
    if (!reader || typeof reader.unregisterEventListener !== 'function') return;
    P.state.readerHandlers.forEach(function (entry) {
      try { reader.unregisterEventListener(entry.type, entry.handler); } catch (e) { /* ignore */ }
    });
    P.state.readerHandlers = [];
  }

  function injectResources(win) {
    try {
      var doc = win.document;
      if (!doc || win.__litmagResourcesInjected) return;
      win.__litmagResourcesInjected = true;
      /* A <?xml-stylesheet?> processing instruction inserted after the XUL
       * document has been parsed is ignored by Gecko. That left every LitMag
       * panel completely unstyled in Zotero 10: the menus worked, but the
       * floating panel and item-pane section were bare, unlaid-out DOM.
       * Use a real XHTML <link> element, the approach Zotero Prism uses. */
      if (!doc.getElementById('litmag-stylesheet')) {
        var link = doc.createElementNS('http://www.w3.org/1999/xhtml', 'link');
        link.setAttribute('id', 'litmag-stylesheet');
        link.setAttribute('rel', 'stylesheet');
        link.setAttribute('type', 'text/css');
        link.setAttribute('href', P.state.rootURI + 'skin/litmag.css');
        (doc.head || doc.documentElement).appendChild(link);
        P.state.domNodes.push({ win: win, node: link });
      }
      if (win.MozXULElement && win.MozXULElement.insertFTLIfNeeded) {
        try { win.MozXULElement.insertFTLIfNeeded('litmag.ftl'); }
        catch (e) { /* locale file is optional; menus use plain labels */ }
      }
    }
    catch (e) { P.debug('injectResources: ' + e); }
  }

  function onMainWindowLoad(win) {
    if (!win || P.state.shuttingDown) return 0;
    injectResources(win);
    return injectMenusIntoWindow(win);
  }

  function onMainWindowUnload(win) {
    for (var i = P.state.domNodes.length - 1; i >= 0; i--) {
      var entry = P.state.domNodes[i];
      if (entry.win === win || !entry.win) {
        try { if (entry.node && entry.node.parentNode) entry.node.parentNode.removeChild(entry.node); }
        catch (e) { /* ignore */ }
        P.state.domNodes.splice(i, 1);
      }
    }
  }

  function menusEnabled() {
    return P.pref('enableMenus', true) !== false && P.pref('enableMenus', true) !== 'false';
  }

  function addToAllWindows() {
    var injected = 0;
    try {
      var wins = (typeof Zotero !== 'undefined' && Zotero.getMainWindows) ? Zotero.getMainWindows() : [];
      (wins || []).forEach(function (win) { injected += (onMainWindowLoad(win) || 0); });
    }
    catch (e) { P.debug('addToAllWindows: ' + e); }
    /* If the popup ids changed in a future 10.x build, MenuManager is the
     * only remaining way to expose the actions. Never register both. */
    if (!injected && menusEnabled() && !P.state.menus.length) registerMenus();
  }

  function removeFromAllWindows() {
    P.ui.closeFloat();
    P.state.domNodes.forEach(function (entry) {
      try { if (entry.node && entry.node.parentNode) entry.node.parentNode.removeChild(entry.node); }
      catch (e) { /* ignore */ }
    });
    P.state.domNodes = [];
  }

  async function init(opts) {
    opts = opts || {};
    P.state.id = opts.id || P.PLUGIN_ID;
    P.state.version = opts.version || P.state.version;
    P.state.rootURI = opts.rootURI || '';
    P.state.shuttingDown = false;
    P.ensureDefaults();
    if (P.pref('enableSection', true) !== false && P.pref('enableSection', true) !== 'false') registerSection();
    registerPreferencePane();
    if (P.pref('enableReader', true) !== false && P.pref('enableReader', true) !== 'false') registerReader();
    P.debug('initialized v' + P.state.version + ' (self-contained, no sidecar)');
    return P.state;
  }

  function shutdown() {
    P.state.shuttingDown = true;
    P.ui.closeFloat();
    P.session.resetAll();
    unregisterMenus();
    unregisterSection();
    unregisterReader();
    P.state.prefsPaneID = null;
    P.debug('shutdown complete');
  }

  P.init = init;
  P.shutdown = shutdown;
  P.addToAllWindows = addToAllWindows;
  P.removeFromAllWindows = removeFromAllWindows;
  P.onMainWindowLoad = onMainWindowLoad;
  P.onMainWindowUnload = onMainWindowUnload;
  P.MENU_DEFS = MENU_DEFS;
  P.registerMenus = registerMenus;
  P.registerSection = registerSection;
  P.registerPreferencePane = registerPreferencePane;
  P.registerReader = registerReader;
})();
