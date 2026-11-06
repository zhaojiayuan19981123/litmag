/* LitMag preference pane.
 *
 * Runs in the pane's own window scope, so it reaches the plugin through the
 * shared Zotero.LitMag singleton rather than a bootstrap global. Every field
 * reads/writes Zotero.Prefs directly: no hidden state, no companion service.
 */

(function () {
  'use strict';

  var FIELDS = [
    { id: 'litmag-provider', key: 'provider', type: 'string' },
    { id: 'litmag-base-url', key: 'baseURL', type: 'string' },
    { id: 'litmag-full-url', key: 'fullURL', type: 'bool' },
    { id: 'litmag-api-key', key: 'apiKey', type: 'string' },
    { id: 'litmag-model', key: 'model', type: 'string' },
    { id: 'litmag-temperature', key: 'temperature', type: 'string' },
    { id: 'litmag-max-tokens', key: 'maxTokens', type: 'number' },
    { id: 'litmag-stream', key: 'stream', type: 'bool' },
    { id: 'litmag-system-prompt', key: 'systemPrompt', type: 'string' },
    { id: 'litmag-context-chars', key: 'contextChars', type: 'number' },
    { id: 'litmag-history-turns', key: 'historyTurns', type: 'number' },
    { id: 'litmag-include-fulltext', key: 'includeFulltext', type: 'bool' },
    { id: 'litmag-include-annotations', key: 'includeAnnotations', type: 'bool' },
    { id: 'litmag-include-notes', key: 'includeNotes', type: 'bool' },
  ];

  var DEFAULT_URLS = {
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com',
    custom: '',
  };

  function core() {
    try { return (typeof Zotero !== 'undefined' && Zotero.LitMag) ? Zotero.LitMag : null; }
    catch (e) { return null; }
  }

  function byId(id) {
    try { return document.getElementById(id); } catch (e) { return null; }
  }

  function getPref(key, fallback) {
    try {
      var v = Zotero.Prefs.get('extensions.litmag.' + key, true);
      return (v === undefined || v === null) ? fallback : v;
    }
    catch (e) { return fallback; }
  }

  function setPref(key, value) {
    try { return Zotero.Prefs.set('extensions.litmag.' + key, value, true); }
    catch (e) { return undefined; }
  }

  function status(text) {
    var el = byId('litmag-status');
    if (!el) return;
    try { el.setAttribute('value', text); } catch (e) { /* ignore */ }
    try { el.textContent = text; } catch (e2) { /* ignore */ }
  }

  function load() {
    FIELDS.forEach(function (f) {
      var el = byId(f.id);
      if (!el) return;
      var value = getPref(f.key, '');
      if (f.type === 'bool') {
        el.checked = (value === true || value === 'true');
      }
      else {
        el.value = String(value === undefined || value === null ? '' : value);
      }
    });
    refreshProfiles();
    var c = core();
    status(c ? c.ai.statusText() : '插件尚未完成初始化，请重启 Zotero 后重试。');
  }

  function save() {
    FIELDS.forEach(function (f) {
      var el = byId(f.id);
      if (!el) return;
      if (f.type === 'bool') setPref(f.key, !!el.checked);
      else if (f.type === 'number') setPref(f.key, Number(el.value) || 0);
      else setPref(f.key, String(el.value || '').trim());
    });
    var c = core();
    status(c ? ('已保存 · ' + c.ai.statusText()) : '已保存');
  }

  function syncProviderDefaults() {
    var provider = byId('litmag-provider');
    var base = byId('litmag-base-url');
    var full = byId('litmag-full-url');
    if (!provider || !base) return;
    var current = String(base.value || '').trim();
    var isKnownDefault = Object.keys(DEFAULT_URLS).some(function (key) {
      return DEFAULT_URLS[key] && current === DEFAULT_URLS[key];
    }) || current === '';
    if (isKnownDefault) base.value = DEFAULT_URLS[provider.value] || DEFAULT_URLS.openai;
    if (full) full.checked = provider.value === 'custom';
  }

  async function testConnection() {
    var c = core();
    if (!c) { status('插件未初始化，请重启 Zotero。'); return; }
    save();
    status('正在测试连接…');
    var outcome = await c.ai.testConnection();
    status(outcome.ok ? '✓ 连接成功：' + outcome.message + '（' + outcome.ms + ' ms）'
      : '✗ ' + outcome.message);
  }

  async function fetchModels() {
    var c = core();
    if (!c) { status('插件未初始化，请重启 Zotero。'); return; }
    save();
    status('正在获取模型列表…');
    var models = await c.ai.listModels();
    if (!models.length) {
      status('接口未返回模型列表。部分服务商不提供 /models，可直接手动填写模型名称。');
      return;
    }
    var index = { value: 0 };
    var ok = false;
    try {
      ok = Services.prompt.select(window, 'LitMag', '选择模型：', models, index);
    }
    catch (e) { /* fall through */ }
    if (ok) {
      var el = byId('litmag-model');
      if (el) el.value = models[index.value] || models[0];
      save();
      status('已选择模型：' + (models[index.value] || models[0]));
    }
    else status('已获取 ' + models.length + ' 个模型');
  }

  function refreshProfiles() {
    var list = byId('litmag-profiles');
    if (!list) return;
    var c = core();
    var profiles = c ? c.ai.listProfiles() : [];
    try {
      if (typeof list.removeAllItems === 'function') list.removeAllItems();
      else {
        var popup = list.querySelector ? list.querySelector('menupopup') : null;
        if (popup) while (popup.firstChild) popup.removeChild(popup.firstChild);
      }
      profiles.forEach(function (p) {
        if (typeof list.appendItem === 'function') list.appendItem(p.name, p.name);
      });
    }
    catch (e) { /* optional UI */ }
  }

  function promptName() {
    var value = { value: '' };
    var ok = false;
    try {
      ok = Services.prompt.prompt(window, 'LitMag', '配置档名称：', value, '', { value: false });
    }
    catch (e) { return ''; }
    return ok ? String(value.value || '').trim() : '';
  }

  function bind() {
    if (window.__litmagPrefsBound) return;
    /* The preference pane is loaded as an XHTML fragment, so its script can
     * run before the controls are inserted. Wait for the first field instead
     * of binding to a document that has no inputs yet. */
    if (!byId('litmag-provider') && typeof window.setTimeout === 'function') {
      window.__litmagPrefsRetries = (window.__litmagPrefsRetries || 0) + 1;
      if (window.__litmagPrefsRetries < 30) {
        window.setTimeout(bind, 100);
        return;
      }
    }
    window.__litmagPrefsBound = true;
    try {
      if (window.MozXULElement && window.MozXULElement.insertFTLIfNeeded) {
        window.MozXULElement.insertFTLIfNeeded('litmag.ftl');
      }
    }
    catch (e) { /* ignore */ }

    load();
    var bindClick = function (id, handler) {
      var el = byId(id);
      if (el) el.addEventListener('click', handler);
    };
    bindClick('litmag-save', save);
    bindClick('litmag-test', function () { testConnection().catch(function (e) { status('测试失败：' + e); }); });
    bindClick('litmag-fetch-models', function () { fetchModels().catch(function (e) { status('获取失败：' + e); }); });

    var provider = byId('litmag-provider');
    if (provider) provider.addEventListener('command', function () { syncProviderDefaults(); save(); });

    FIELDS.forEach(function (f) {
      var el = byId(f.id);
      if (el) el.addEventListener('change', save);
    });

    bindClick('litmag-profile-save', function () {
      var c = core();
      if (!c) return;
      save();
      var name = promptName();
      if (name && c.ai.saveProfile(name)) {
        refreshProfiles();
        status('已保存配置档：' + name);
      }
    });
    bindClick('litmag-profile-apply', function () {
      var c = core();
      var list = byId('litmag-profiles');
      if (!c || !list) return;
      var name = String(list.value || '');
      if (name && c.ai.applyProfile(name)) {
        load();
        status('已应用配置档：' + name);
      }
    });
    bindClick('litmag-profile-delete', function () {
      var c = core();
      var list = byId('litmag-profiles');
      if (!c || !list) return;
      var name = String(list.value || '');
      if (name && c.ai.deleteProfile(name)) {
        refreshProfiles();
        status('已删除配置档：' + name);
      }
    });
  }

  window.LitMagPrefs = { bind: bind };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  }
  else bind();
})();
