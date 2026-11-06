import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const readBuf = (rel) => fs.readFileSync(path.join(root, rel));

function listZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054B50) { eocd = i; break; }
  }
  assert.ok(eocd >= 0, 'ZIP end-of-central-directory not found');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const files = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    assert.equal(buf.readUInt32LE(p), 0x02014B50, 'bad central directory header');
    const flags = buf.readUInt16LE(p + 8);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    files.push({ name, flags });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

test('manifest targets Zotero 10 only and matches the package version', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const pkg = JSON.parse(read('package.json'));
  assert.equal(manifest.manifest_version, 2);
  assert.equal(manifest.version, pkg.version);
  assert.equal(pkg.version, '2.0');
  assert.equal(manifest.applications.zotero.strict_min_version, '10.0.6');
  assert.equal(manifest.applications.zotero.strict_max_version, '10.*');
  assert.equal(manifest.browser_specific_settings.gecko.id, manifest.applications.zotero.id);
  assert.match(manifest.applications.zotero.update_url, /^https:\/\/raw\.githubusercontent\.com\//);
  assert.match(manifest.description, /no companion app/i);
});

test('every shipped script parses as JavaScript', () => {
  const files = [
    'bootstrap.js', 'prefs.js',
    'content/core.js', 'content/http.js', 'content/ai.js', 'content/context.js',
    'content/prompts.js', 'content/session.js', 'content/ui.js', 'content/menus.js',
    'content/preferences.js',
    'scripts/zip.mjs', 'scripts/build-xpi.mjs', 'scripts/support.mjs',
  ];
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${file} has a syntax error: ${result.stderr}`);
  }
});

test('defaults expose user-supplied model settings, not a sidecar', () => {
  const prefs = read('prefs.js');
  for (const key of ['provider', 'baseURL', 'fullURL', 'apiKey', 'model', 'temperature',
    'maxTokens', 'stream', 'systemPrompt', 'contextChars', 'includeFulltext', 'profiles']) {
    assert.match(prefs, new RegExp(`extensions\\.litmag\\.${key}`));
  }
  assert.doesNotMatch(prefs, /engineURL|workbenchURL|engineToken|23127|3000/);
  assert.equal(fs.existsSync(path.join(root, 'engine')), false, 'engine/ must be gone');
  assert.equal(fs.existsSync(path.join(root, 'content/workbench.xhtml')), false);
  assert.equal(fs.existsSync(path.join(root, 'content/litmag.js')), false);
});

test('no source file references a local engine or workbench server', () => {
  const dirs = ['content', 'scripts'];
  const files = ['bootstrap.js', 'prefs.js', 'manifest.json', 'package.json', 'README.md'];
  for (const dir of dirs) {
    for (const name of fs.readdirSync(path.join(root, dir))) {
      if (fs.statSync(path.join(root, dir, name)).isFile()) files.push(`${dir}/${name}`);
    }
  }
  for (const file of files) {
    /* build-xpi.mjs contains the forbidden patterns as its own guard list. */
    if (file === 'scripts/build-xpi.mjs') continue;
    const text = read(file);
    assert.doesNotMatch(text, /23127|127\.0\.0\.1:3000|litmag-engine|\/workbench\?/, `${file} still references the sidecar`);
  }
});

test('preferences pane, locales, icons and styles are present', () => {
  assert.match(read('content/preferences.xhtml'), /litmag-prefpane/);
  for (const id of ['litmag-provider', 'litmag-base-url', 'litmag-api-key', 'litmag-model',
    'litmag-test', 'litmag-fetch-models', 'litmag-system-prompt']) {
    assert.match(read('content/preferences.xhtml'), new RegExp(`id="${id}"`));
  }
  assert.match(read('locale/zh-CN/litmag.ftl'), /litmag-menu-prefs/);
  assert.match(read('locale/en-US/litmag.ftl'), /litmag-menu-prefs/);
  assert.match(read('skin/litmag.css'), /\.litmag-float/);
  assert.ok(fs.existsSync(path.join(root, 'content/icon16.svg')));
  assert.ok(fs.existsSync(path.join(root, 'content/icon20.svg')));
});

test('built XPI is a valid ZIP containing the full self-contained plugin', () => {
  const pkg = JSON.parse(read('package.json'));
  const rel = `dist/litmag-${pkg.version}.xpi`;
  if (!fs.existsSync(path.join(root, rel))) return; // build has not run yet
  const files = listZip(readBuf(rel));
  const names = files.map((f) => f.name);
  for (const required of [
    'manifest.json', 'bootstrap.js', 'prefs.js',
    'content/core.js', 'content/http.js', 'content/ai.js', 'content/context.js',
    'content/prompts.js', 'content/session.js', 'content/ui.js', 'content/menus.js',
    'content/preferences.xhtml', 'content/preferences.js',
    'locale/zh-CN/litmag.ftl', 'locale/en-US/litmag.ftl', 'skin/litmag.css',
  ]) {
    assert.ok(names.includes(required), `XPI is missing ${required}`);
  }
  assert.ok(files.every((f) => (f.flags & 0x800) !== 0), 'all filenames must be flagged UTF-8');
  assert.ok(files.every((f) => !f.name.includes('\\')), 'ZIP paths must use forward slashes');
  assert.ok(names.every((n) => !n.startsWith('engine/') && !n.startsWith('test/') && !n.startsWith('scripts/')),
    'engine, tests and build scripts must not be shipped inside the XPI');
});

test('update.json hash matches the built XPI and points at this version', () => {
  const pkg = JSON.parse(read('package.json'));
  const rel = `dist/litmag-${pkg.version}.xpi`;
  if (!fs.existsSync(path.join(root, rel))) return;
  const update = JSON.parse(read('update.json'));
  const entry = update.addons[Object.keys(update.addons)[0]].updates[0];
  const actual = 'sha256:' + crypto.createHash('sha256').update(readBuf(rel)).digest('hex');
  assert.equal(entry.version, pkg.version);
  assert.equal(entry.update_hash, actual);
  assert.equal(entry.applications.zotero.strict_min_version, '10.0.6');
  assert.match(entry.update_link, new RegExp(`litmag-${pkg.version.replace('.', '\\.')}\\.xpi$`));
  const sums = read('dist/SHA256SUMS.txt');
  assert.match(sums, new RegExp(`litmag-${pkg.version.replace('.', '\\.')}\\.xpi`));
});
