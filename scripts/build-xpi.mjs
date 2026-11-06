/* Build the XPI, the engine package, update.json and checksums.
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
const ENGINE_FILES = [
  'engine/README.txt',
  'engine/server.mjs',
  'engine/config.example.json',
  'engine/start.cmd',
  'engine/start.sh',
];

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
  for (const d of XPI_DIRS) {
    files.push(...(await walk(path.join(root, d), d)));
  }
  return files.filter((f) => fss.existsSync(path.join(root, f)))
    .sort((a, b) => a.localeCompare(b));
}

async function makeZip(files, outFile) {
  const entries = [];
  for (const rel of files) {
    entries.push({
      name: rel,
      data: await fs.readFile(path.join(root, rel)),
      unixMode: rel.endsWith('.sh') ? 0o755 : 0o644,
    });
  }
  const buf = createZip(entries);
  await fs.writeFile(outFile, buf);
  return buf;
}

async function main() {
  await fs.mkdir(dist, { recursive: true });

  const xpiFiles = await collect();
  for (const required of ['manifest.json', 'bootstrap.js', 'content/litmag.js', 'locale/zh-CN/litmag.ftl']) {
    if (!xpiFiles.includes(required)) throw new Error(`missing required XPI file: ${required}`);
  }
  const xpiName = `litmag-${version}.xpi`;
  const xpiPath = path.join(dist, xpiName);
  const xpiBuf = await makeZip(xpiFiles, xpiPath);
  const xpiHash = sha256(xpiBuf);

  const engineName = `litmag-engine-${version}.zip`;
  const enginePath = path.join(dist, engineName);
  const engineBuf = await makeZip(ENGINE_FILES, enginePath);
  const engineHash = sha256(engineBuf);

  const update = {
    addons: {
      [pluginID]: {
        updates: [{
          version,
          update_link: `${REPO}/releases/download/v${version}/${xpiName}`,
          update_hash: `sha256:${xpiHash}`,
          applications: {
            zotero: { strict_min_version: '10.0.6' },
          },
        }],
      },
    },
  };
  await fs.writeFile(path.join(root, 'update.json'), JSON.stringify(update, null, 2) + '\n', 'utf8');

  const sums = `${xpiHash}  ${xpiName}\n${engineHash}  ${engineName}\n`;
  await fs.writeFile(path.join(dist, 'SHA256SUMS.txt'), sums, 'utf8');

  const info = {
    version,
    tag: `v${version}`,
    pluginID,
    xpi: { name: xpiName, path: xpiPath, bytes: xpiBuf.length, sha256: xpiHash },
    engine: { name: engineName, path: enginePath, bytes: engineBuf.length, sha256: engineHash },
    files: xpiFiles,
  };
  await fs.writeFile(path.join(dist, 'build-info.json'), JSON.stringify(info, null, 2) + '\n', 'utf8');

  console.log(`XPI     ${xpiName}  ${xpiBuf.length} bytes  ${xpiFiles.length} files`);
  console.log(`Engine  ${engineName}  ${engineBuf.length} bytes`);
  console.log(`sha256  ${xpiHash}`);
}

main().catch((e) => {
  console.error('build failed:', e.message);
  process.exit(1);
});
