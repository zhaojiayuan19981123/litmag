/* LitMag v2.0 - Zotero 10 bootstrapped plugin.
 *
 * Everything lives inside the XPI: no sidecar process, no local server, no
 * npm dependencies. The modules below are loaded into this bootstrap scope in
 * order and share a single `LitMag` object, which is also published on the
 * Zotero singleton so the preference pane (a separate window scope) can use it.
 *
 * Every registration made in startup() is removed in shutdown(), which lets
 * the add-on be disabled/enabled without restarting Zotero.
 */

var chromeHandle;

/* Order matters: core defines LitMag, later files extend it. */
var LITMAG_MODULES = [
  'core.js',
  'http.js',
  'ai.js',
  'context.js',
  'prompts.js',
  'session.js',
  'ui.js',
  'menus.js',
];

function registerChrome(rootURI) {
  try {
    var aomStartup = Components.classes['@mozilla.org/addons/addon-manager-startup;1']
      .getService(Components.interfaces.amIAddonManagerStartup);
    var manifestURI = Services.io.newURI(rootURI + 'manifest.json');
    /* Zotero 10 rejects a "skin" entry here; only "content" is registered. */
    chromeHandle = aomStartup.registerChrome(manifestURI, [
      ['content', 'litmag', rootURI + 'content/'],
    ]);
  }
  catch (e) {
    /* Non-fatal: all resources are also referenced through rootURI. */
    try { Zotero.debug('[LitMag] registerChrome skipped: ' + e); } catch (_) { /* ignore */ }
  }
}

async function waitForZotero() {
  var waits = [];
  try {
    for (var i = 0; i < 3; i++) {
      var names = ['initializationPromise', 'unlockPromise', 'uiReadyPromise'];
      if (Zotero[names[i]]) waits.push(Zotero[names[i]]);
    }
  }
  catch (e) { /* older build */ }
  if (waits.length) {
    try { await Promise.all(waits); } catch (e) { /* keep going */ }
  }
}

function install(data, reason) {
  /* Defaults live in prefs.js and are applied defensively in LitMag.init(). */
}

async function startup({ id, version, rootURI }, reason) {
  try {
    registerChrome(rootURI);
    await waitForZotero();
    for (var i = 0; i < LITMAG_MODULES.length; i++) {
      Services.scriptloader.loadSubScript(rootURI + 'content/' + LITMAG_MODULES[i]);
    }
    await LitMag.init({ id, version, rootURI });
    LitMag.addToAllWindows();
  }
  catch (e) {
    try { Zotero.debug('[LitMag] startup failed: ' + (e && e.message ? e.message : e)); }
    catch (_) { /* Zotero may not be ready */ }
  }
}

function shutdown({ id, version, rootURI }, reason) {
  try {
    if (typeof LitMag !== 'undefined' && LitMag) {
      LitMag.removeFromAllWindows();
      LitMag.shutdown();
    }
  }
  catch (e) {
    try { Zotero.debug('[LitMag] shutdown failed: ' + (e && e.message ? e.message : e)); }
    catch (_) { /* ignore */ }
  }
  if (chromeHandle) {
    try { chromeHandle.destruct(); } catch (e) { /* ignore */ }
    chromeHandle = null;
  }
  LitMag = undefined;
}

function uninstall(data, reason) {
  /* User data (Zotero notes, preferences) is intentionally left untouched. */
}

function onMainWindowLoad({ window }) {
  if (typeof LitMag !== 'undefined' && LitMag) LitMag.onMainWindowLoad(window);
}

function onMainWindowUnload({ window }) {
  if (typeof LitMag !== 'undefined' && LitMag) LitMag.onMainWindowUnload(window);
}
