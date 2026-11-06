/* LitMag - Zotero 10 bootstrapped plugin entry point.
 *
 * Zotero 7+ plugins are bootstrapped: no chrome.manifest, no XUL overlay.
 * Everything registered in startup() must be removed in shutdown(), otherwise
 * the plugin cannot be disabled without restarting Zotero.
 */

var LitMag;

function install(data, reason) {
  // Defaults live in prefs.js and are also applied defensively in LitMag.init().
}

async function startup({ id, version, rootURI }, reason) {
  try {
    Services.scriptloader.loadSubScript(rootURI + 'content/litmag.js');
    await LitMag.init({ id, version, rootURI });
    LitMag.addToAllWindows();
  }
  catch (e) {
    try {
      Zotero.debug('[LitMag] startup failed: ' + (e && e.message ? e.message : e));
    }
    catch (_) { /* Zotero may not be ready yet */ }
  }
}

function shutdown({ id, version, rootURI }, reason) {
  try {
    if (LitMag) {
      LitMag.removeFromAllWindows();
      LitMag.shutdown();
    }
  }
  catch (e) {
    try {
      Zotero.debug('[LitMag] shutdown failed: ' + (e && e.message ? e.message : e));
    }
    catch (_) { /* ignore */ }
  }
  LitMag = undefined;
}

function uninstall(data, reason) {
  // No user data is removed on uninstall: the engine keeps its own state.
}

function onMainWindowLoad({ window }) {
  if (LitMag) {
    LitMag.onMainWindowLoad(window);
  }
}

function onMainWindowUnload({ window }) {
  if (LitMag) {
    LitMag.onMainWindowUnload(window);
  }
}
