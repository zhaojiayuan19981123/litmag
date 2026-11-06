/* Build the self-contained XPI, update.json and checksums.
 * No build tooling and no dependencies: `node scripts/build-xpi.mjs`.
 */

import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createZip } from './zip.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const version = JSON.parse(fss.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const pluginID = JSON.parse(fss.readFileSync(path.join(root, 'manifest.json'), 'utf8')).applications.zotero.id;
const REPO = 'https://github.com/zhaojiayuan19981123/litmag';
const XPI_FILES = ['manifest.json', 'bootstrap.js', 'prefs.js'];
const XPI_DIRS = ['content', 'locale', 'skin'];
const FORBIDDEN = [/23127/, /127\.0\.0\.1:3000/, /litmag-engine/, /\/workbench\?/];

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function walk(dir, prefix = '') {
  const out = [];
  let names = [];
  try { names = await fs.readdir(dir, { withFileTypes: true }); }
  catch (e) { return out; }
  for (const entry of names) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(abs, rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

async function collect() {
  const files = [...XPI_FILES];
  for (const d of XPI_DIRS) files.push(...(await walk(path.join(root, d), d)));
  return files.filter((f) => fss.existsSync(path.join(root, f)))
    .sort((a, b) => a.localeCompare(b));
}

async function main() {
  await fs.mkdir(dist, { recursive: true });

  const xpiFiles = await collect();
  for (const required of [
    'manifest.json', 'bootstrap.js', 'prefs.js',
    'content/core.js', 'content/http.js', 'content/ai.js', 'content/context.js',
    'content/prompts.js', 'content/session.js', 'content/ui.js', 'content/menus.js',
    'content/preferences.xhtml', 'content/preferences.js',
    'locale/zh-CN/litmag.ftl', 'locale/en-US/litmag.ftl', 'skin/litmag.css',
  ]) {
    if (!xpiFiles.includes(required)) throw new Error(`missing required XPI file: ${required}`);
  }

  const entries = [];
  for (const rel of xpiFiles) {
    const data = await fs.readFile(path.join(root, rel));
    const text = data.toString('utf8');
    for (const pattern of FORBIDDEN) {
      if (pattern.test(text)) throw new Error(`${rel} still depends on a sidecar (${pattern})`);
    }
    entries.push({ name: rel, data, unixMode: rel.endsWith('.sh') ? 0o755 : 0o644 });
  }
  const xpiName = `litmag-${version}.xpi`;
  const xpiPath = path.join(dist, xpiName);
  const xpiBuf = createZip(entries);
  await fs.writeFile(xpiPath, xpiBuf);
  const xpiHash = sha256(xpiBuf);

  const update = {
    addons: {
      [pluginID]: {
        updates: [{
          version,
          update_link: `${REPO}/releases/download/v${version}/${xpiName}`,
          update_hash: `sha256:${xpiHash}`,
          applications: { zotero: { strict_min_version: '10.0.6' } },
        }],
      },
    },
  };
  await fs.writeFile(path.join(root, 'update.json'), JSON.stringify(update, null, 2) + '\n', 'utf8');
  await fs.writeFile(path.join(dist, 'SHA256SUMS.txt'), `${xpiHash}  ${xpiName}\n`, 'utf8');

  const info = {
    version,
    tag: `v${version}`,
    pluginID,
    selfContained: true,
    xpi: { name: xpiName, path: xpiPath, bytes: xpiBuf.length, sha256: xpiHash },
    files: xpiFiles,
  };
  await fs.writeFile(path.join(dist, 'build-info.json'), JSON.stringify(info, null, 2) + '\n', 'utf8');

  console.log(`XPI     ${xpiName}  ${xpiBuf.length} bytes  ${xpiFiles.length} files`);
  console.log(`sha256  ${xpiHash}`);
  console.log('engine  none (all AI calls run inside Zotero)');
}

main().catch((e) => {
  console.error('build failed:', e.message);
  process.exit(1);
});
