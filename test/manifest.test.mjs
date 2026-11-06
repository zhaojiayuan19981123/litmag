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

test('manifest targets Zotero 10 only and matches package version', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const pkg = JSON.parse(read('package.json'));
  assert.equal(manifest.manifest_version, 2);
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.applications.zotero.strict_min_version, '10.0.6');
  assert.equal(manifest.applications.zotero.strict_max_version, '10.*');
  assert.equal(manifest.browser_specific_settings.gecko.id, manifest.applications.zotero.id);
  assert.match(manifest.applications.zotero.update_url, /^https:\/\/raw\.githubusercontent\.com\//);
});

test('all plugin sources parse as JavaScript', () => {
  const files = [
    'bootstrap.js', 'prefs.js',
    'content/litmag.js', 'content/preferences.js', 'content/workbench.js',
    'engine/server.mjs', 'scripts/zip.mjs', 'scripts/build-xpi.mjs',
  ];
  for (const file of files) {
    // `node --check` handles both classic scripts and ESM .mjs files.
    const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${file} has a syntax error: ${result.stderr}`);
  }
});

test('XUL fragments, locales and icons are present', () => {
  assert.match(read('content/preferences.xhtml'), /litmag-prefpane/);
  assert.match(read('content/workbench.xhtml'), /<browser/);
  assert.match(read('locale/zh-CN/litmag.ftl'), /litmag-menu-open/);
  assert.match(read('locale/en-US/litmag.ftl'), /litmag-menu-open/);
  assert.match(read('content/icon.svg'), /context-fill/);
  assert.ok(fs.existsSync(path.join(root, 'content/icon16.svg')));
  assert.ok(fs.existsSync(path.join(root, 'content/icon20.svg')));
});

test('built XPI is a valid ZIP with the required plugin files', () => {
  const pkg = JSON.parse(read('package.json'));
  const xpi = path.join(root, 'dist', `litmag-${pkg.version}.xpi`);
  if (!fs.existsSync(xpi)) return; // build has not run in this checkout
  const files = listZip(readBuf(path.join('dist', `litmag-${pkg.version}.xpi`)));
  const names = files.map((f) => f.name);
  for (const required of [
    'manifest.json', 'bootstrap.js', 'prefs.js',
    'content/litmag.js', 'content/preferences.xhtml', 'content/workbench.xhtml',
    'locale/zh-CN/litmag.ftl', 'locale/en-US/litmag.ftl',
  ]) {
    assert.ok(names.includes(required), `XPI is missing ${required}`);
  }
  assert.ok(files.every((f) => (f.flags & 0x800) !== 0), 'all filenames must be flagged UTF-8');
  assert.ok(files.every((f) => !f.name.includes('\\')), 'ZIP paths must use forward slashes');
  assert.ok(names.every((n) => !n.startsWith('engine/') && !n.startsWith('test/')),
    'engine and tests must not be shipped inside the XPI');
});

test('update.json hash matches the built XPI', () => {
  const pkg = JSON.parse(read('package.json'));
  const xpiRel = path.join('dist', `litmag-${pkg.version}.xpi`);
  if (!fs.existsSync(path.join(root, xpiRel))) return;
  const update = JSON.parse(read('update.json'));
  const entry = update.addons[Object.keys(update.addons)[0]].updates[0];
  const actual = 'sha256:' + crypto.createHash('sha256').update(readBuf(xpiRel)).digest('hex');
  assert.equal(entry.version, pkg.version);
  assert.equal(entry.update_hash, actual);
  assert.match(entry.update_link, new RegExp(`litmag-${pkg.version.replace('.', '\\.')}\\.xpi$`));
});
