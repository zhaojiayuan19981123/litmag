/* LitMag workbench window.
 *
 * The <browser> loads the local engine's /workbench endpoint. The engine
 * reverse-proxies the existing workbench, so the page is same-origin HTTP and
 * does not need CORS or a chrome:// to http:// fetch from privileged code.
 */

(function () {
  'use strict';

  var args = {};

  function byId(id) {
    return document.getElementById(id);
  }

  function setStatus(text) {
    var el = byId('litmag-status');
    if (el) el.setAttribute('value', text);
  }

  function fallbackURL() {
    var html = '<!doctype html><meta charset="utf-8">' +
      '<div style="font:14px/1.7 system-ui,sans-serif;padding:40px;max-width:720px;margin:auto">' +
      '<h2>LitMag 引擎未启动</h2>' +
      '<p>请在终端运行 <code>node engine/server.mjs</code>（或使用 Release 中的启动脚本），再点击「刷新」。</p>' +
      '<p>插件本身的条目面板、右键菜单仍然可用；工作台相关功能需要引擎在线。</p>' +
      '<p style="opacity:.7">工作台地址可在 Zotero → 设置 → LitMag 中修改。</p>' +
      '</div>';
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  }

  function load() {
    var browser = byId('litmag-browser');
    if (!browser) return;
    var count = Number(args.itemCount || 0);
    var status = (args.engineOnline ? '引擎已连接' : '引擎未启动') +
      (count ? ' · 已传递 ' + count + ' 条文献' : '');
    setStatus(status);
    browser.src = args.engineOnline && args.url ? args.url : fallbackURL();
  }

  function onLoad() {
    try {
      args = (window.arguments && window.arguments[0]) || {};
    }
    catch (e) { args = {}; }
    load();

    var reload = byId('litmag-reload');
    if (reload) {
      reload.addEventListener('command', function () {
        var browser = byId('litmag-browser');
        if (browser) {
          try { browser.reload(); }
          catch (e) { load(); }
        }
      });
    }

    var external = byId('litmag-external');
    if (external) {
      external.addEventListener('command', function () {
        var url = args.workbenchURL || 'http://127.0.0.1:3000';
        try {
          if (typeof args.openExternal === 'function') {
            args.openExternal(url);
            return;
          }
          if (typeof Zotero !== 'undefined' && Zotero.Utilities &&
              Zotero.Utilities.Internal && Zotero.Utilities.Internal.openURL) {
            Zotero.Utilities.Internal.openURL(url);
            return;
          }
        }
        catch (e) { /* fall through */ }
        window.open(url, '_blank');
      });
    }
  }

  window.addEventListener('load', onLoad, { once: true });
})();
