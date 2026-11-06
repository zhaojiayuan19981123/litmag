/* LitMag preference pane.
 * Zotero 8+ loads preference pane scripts in their own global scope, so all
 * state is read from / written to Zotero.Prefs instead of shared variables.
 */

(function () {
  'use strict';

  var PREF_ENGINE_URL = 'extensions.litmag.engineURL';
  var PREF_WORKBENCH_URL = 'extensions.litmag.workbenchURL';
  var PREF_TOKEN = 'extensions.litmag.engineToken';
  var PREF_EMBEDDED = 'extensions.litmag.embeddedWindow';

  function byId(id) {
    return document.getElementById(id);
  }

  function getPref(key, fallback) {
    try {
      var v = Zotero.Prefs.get(key, true);
      return (v === undefined || v === null || v === '') ? fallback : v;
    }
    catch (e) { return fallback; }
  }

  function setPref(key, value) {
    try { Zotero.Prefs.set(key, value, true); } catch (e) { /* ignore */ }
  }

  function setStatus(text) {
    var el = byId('litmag-pref-status');
    if (el) el.setAttribute('value', text);
  }

  function load() {
    var engine = byId('litmag-engine-url');
    var workbench = byId('litmag-workbench-url');
    var token = byId('litmag-token');
    var embedded = byId('litmag-embedded');
    if (engine) engine.value = String(getPref(PREF_ENGINE_URL, 'http://127.0.0.1:23127'));
    if (workbench) workbench.value = String(getPref(PREF_WORKBENCH_URL, 'http://127.0.0.1:3000'));
    if (token) token.value = String(getPref(PREF_TOKEN, ''));
    if (embedded) embedded.checked = getPref(PREF_EMBEDDED, true) !== false;
  }

  function save() {
    var engine = byId('litmag-engine-url');
    var workbench = byId('litmag-workbench-url');
    var token = byId('litmag-token');
    var embedded = byId('litmag-embedded');
    if (engine) setPref(PREF_ENGINE_URL, engine.value.trim().replace(/\/+$/, ''));
    if (workbench) setPref(PREF_WORKBENCH_URL, workbench.value.trim().replace(/\/+$/, ''));
    if (token) setPref(PREF_TOKEN, token.value.trim());
    if (embedded) setPref(PREF_EMBEDDED, !!embedded.checked);
    setStatus('已保存');
  }

  async function check() {
    save();
    var engine = byId('litmag-engine-url');
    var url = (engine ? engine.value.trim() : 'http://127.0.0.1:23127').replace(/\/+$/, '') +
      '/api/litmag/handshake';
    setStatus('检查中…');
    try {
      var token = byId('litmag-token');
      var headers = { 'X-LitMag-Token': token ? token.value.trim() : '' };
      var res = await Zotero.HTTP.request('GET', url, { headers: headers, timeout: 3000 });
      var text = typeof res === 'string' ? res : (res && res.responseText) || '';
      var data = text ? JSON.parse(text) : {};
      setStatus(data.ok ? '引擎已连接 · v' + (data.version || '?') : '引擎返回异常');
    }
    catch (e) {
      setStatus('无法连接引擎（请启动 litmag-engine）');
    }
  }

  function bind() {
    try {
      if (window.MozXULElement && window.MozXULElement.insertFTLIfNeeded) {
        window.MozXULElement.insertFTLIfNeeded('litmag.ftl');
      }
    }
    catch (e) { /* ignore */ }
    load();
    var saveBtn = byId('litmag-save');
    var checkBtn = byId('litmag-check');
    if (saveBtn) saveBtn.addEventListener('command', save);
    if (checkBtn) checkBtn.addEventListener('command', function () { check(); });
    ['litmag-engine-url', 'litmag-workbench-url', 'litmag-token', 'litmag-embedded'].forEach(function (id) {
      var el = byId(id);
      if (el) el.addEventListener('change', save);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  }
  else {
    bind();
  }
})();
