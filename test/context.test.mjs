import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModulesOnly, fakeItem, fakeAttachment } from '../scripts/support.mjs';

function itemWithAttachment(overrides = {}, attachmentOverrides = {}) {
  const attachment = fakeAttachment(attachmentOverrides);
  const item = fakeItem({ getBestAttachment: async () => attachment, ...overrides });
  attachment.parentItem = item;
  return { item, attachment };
}

test('metadata block uses Zotero fields and strips HTML from abstracts', () => {
  const { context } = loadModulesOnly();
  const C = context.LitMag.context;
  const meta = C.metaBlock(fakeItem({
    getField: (name) => ({
      title: 'A <b>Study</b>', date: '2024-06-01', DOI: '10.1/x',
      publicationTitle: 'Journal of Tests',
      abstractNote: '<p>We find <i>effects</i>.</p>', extra: 'replication',
    })[name] || '',
  }));
  assert.match(meta, /标题: A <b>Study<\/b>/);
  assert.match(meta, /作者: Ashish Vaswani/);
  assert.match(meta, /年份: 2024/);
  assert.match(meta, /摘要: We find effects\./);
  assert.match(meta, /标签: transformer/);
  assert.equal(C.stripHTML('<p>a &amp; b</p>'), 'a & b');
});

test('selection is deduplicated and attachments resolve to their parent item', () => {
  const first = fakeItem();
  const second = fakeItem({ id: 3, key: 'SECOND' });
  const att = fakeAttachment({ parentItem: first });
  const { context } = loadModulesOnly({ selected: [first, att, second] });
  const items = context.LitMag.context.selectedItems();
  assert.equal(items.length, 2);
  assert.equal(items[0].id, 1);
  assert.equal(items[1].id, 3);
});

test('full text uses PDFWorker, caches it, and falls back to the Zotero index', async () => {
  let calls = 0;
  const { item, attachment } = itemWithAttachment({}, {
    attachmentText: 'indexed fallback text',
  });
  const env = loadModulesOnly({
    fullText: async () => { calls++; return 'extracted PDF text'; },
  });
  const C = env.context.LitMag.context;
  assert.equal(await C.fullText(item), 'extracted PDF text');
  assert.equal(await C.fullText(item), 'extracted PDF text');
  assert.equal(calls, 1, 'second read must be served from cache');
  C.clearCache();

  const fallbackEnv = loadModulesOnly({ fullText: '' });
  const text = await fallbackEnv.context.LitMag.context.fullText(item);
  assert.equal(text, 'indexed fallback text');
  assert.ok(attachment.id, 'attachment fixture is valid');
});

test('annotations are formatted with page labels and comments', async () => {
  const { item } = itemWithAttachment({}, {
    getAnnotations: () => [
      fakeItem({
        getField: (name) => ({
          annotationText: 'The key estimate', annotationComment: 'check robustness',
          annotationPageLabel: '12', annotationType: 'highlight',
        })[name] || '',
      }),
    ],
  });
  const { context } = loadModulesOnly();
  const text = await context.LitMag.context.annotations(item);
  assert.match(text, /\[p\.12 · highlight\]/);
  assert.match(text, /原文：The key estimate/);
  assert.match(text, /批注：check robustness/);
});

test('context respects the mode and the user-defined character budget', async () => {
  const a = itemWithAttachment({}, { attachmentText: 'AAA full text '.repeat(200) });
  const b = itemWithAttachment({ id: 3, key: 'SECOND', getField: () => 'Second paper' },
    { id: 4, key: 'PDF2', attachmentText: 'BBB full text '.repeat(200) });
  const env = loadModulesOnly({
    prefs: { contextChars: 24000, includeFulltext: true, includeAnnotations: false, includeNotes: false },
    fullText: async () => 'PDF body '.repeat(2000),
  });
  const C = env.context.LitMag.context;
  const full = await C.buildContext([a.item, b.item], { mode: 'full' });
  assert.equal(full.itemCount, 2);
  assert.match(full.text, /=== 文献 1 \/ 2 ===/);
  assert.match(full.text, /\[PDF 全文\]/);
  assert.equal(full.chars <= 24000, true);
  assert.equal(full.truncated, true);
  assert.ok(full.parts.some((p) => p.label === '[PDF 全文]'));

  const meta = await C.buildContext([a.item], { mode: 'meta' });
  assert.doesNotMatch(meta.text, /\[PDF 全文\]/);
  assert.match(meta.text, /Attention Is All You Need/);
});

test('answers are written back as Zotero child notes with safe HTML', async () => {
  const env = loadModulesOnly();
  const { context, Zotero } = env;
  const P = context.LitMag;
  const html = P.context.noteHTML('第一行\n**加粗** <script>alert(1)</script>', {
    title: '总结', model: 'gpt-4o-mini', itemCount: 1,
    sources: ['Attention Is All You Need'], question: '请总结',
  });
  assert.match(html, /<h2>LitMag · 总结<\/h2>/);
  assert.match(html, /<strong>加粗<\/strong>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Attention Is All You Need/);

  const note = await P.context.createChildNote(fakeItem(), html, 'LitMag');
  assert.equal(note.libraryID, 1);
  assert.equal(note.parentID, 1);
  assert.equal(note.getNote(), html);
  assert.deepEqual(note.tags, ['LitMag']);
  assert.ok(Zotero.Item, 'Zotero.Item constructor is used');
});
