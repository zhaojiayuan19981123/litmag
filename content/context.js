/* LitMag context: Zotero is the single source of truth.
 *
 * Item metadata, PDF full text (Zotero.PDFWorker / the full-text index),
 * annotations and child notes are read straight from the library; AI answers
 * are written back as child notes. Nothing is stored outside Zotero.
 */

(function () {
  'use strict';

  var P = LitMag;
  var fullTextCache = {}; /* attachment id -> { at, text } */

  function field(item, name) {
    try { return String(item.getField(name) || ''); } catch (e) { return ''; }
  }

  function stripHTML(text) {
    return String(text || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
  }

  function creatorString(item) {
    try {
      return (item.getCreators() || []).map(function (c) {
        return [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
      }).filter(Boolean).join('; ');
    }
    catch (e) { return ''; }
  }

  function selectedItems() {
    try {
      var pane = Zotero.getActiveZoteroPane();
      var items = pane && pane.getSelectedItems ? pane.getSelectedItems() : [];
      return (items || []).map(toRegularItem).filter(Boolean)
        .filter(function (item, index, list) {
          return list.findIndex(function (x) { return x.id === item.id; }) === index;
        });
    }
    catch (e) { return []; }
  }

  function toRegularItem(item) {
    if (!item) return null;
    try {
      if (item.isAnnotation && item.isAnnotation()) {
        return item.parentItem ? toRegularItem(item.parentItem) : null;
      }
      if (item.isAttachment && item.isAttachment()) {
        return item.parentItem ? toRegularItem(item.parentItem) : null;
      }
      return (item.isRegularItem && item.isRegularItem()) ? item : null;
    }
    catch (e) { return null; }
  }

  function metaBlock(item) {
    var lines = [];
    function push(label, value) {
      if (value && String(value).trim()) lines.push(label + ': ' + String(value).trim());
    }
    push('标题', field(item, 'title'));
    push('作者', creatorString(item));
    push('年份', field(item, 'date').slice(0, 4));
    push('来源', field(item, 'publicationTitle') || field(item, 'proceedingsTitle') || field(item, 'publisher'));
    push('DOI', field(item, 'DOI'));
    push('摘要', stripHTML(field(item, 'abstractNote')));
    try {
      push('标签', (item.getTags() || []).map(function (t) { return t.tag; }).join(', '));
    }
    catch (e) { /* ignore */ }
    push('备注', field(item, 'extra').slice(0, 500));
    return lines.join('\n');
  }

  async function bestAttachment(item) {
    if (!item) return null;
    try {
      if (item.isAttachment && item.isAttachment()) return item;
    }
    catch (e) { /* ignore */ }
    try {
      var best = await item.getBestAttachment();
      if (best) return best;
    }
    catch (e) { /* fall through */ }
    try {
      var ids = item.getAttachments() || [];
      for (var i = 0; i < ids.length; i++) {
        var att = Zotero.Items.get(ids[i]);
        if (att && att.isPDFAttachment && att.isPDFAttachment()) return att;
      }
    }
    catch (e) { /* ignore */ }
    return null;
  }

  async function fullText(item) {
    var attachment = await bestAttachment(item);
    if (!attachment || !attachment.id) return '';
    var cached = fullTextCache[attachment.id];
    if (cached && Date.now() - cached.at < 300000) return cached.text;
    var text = '';
    try {
      if (typeof Zotero !== 'undefined' && Zotero.PDFWorker && Zotero.PDFWorker.getFullText) {
        var result = await Zotero.PDFWorker.getFullText(attachment.id, null, true);
        text = typeof result === 'string' ? result : ((result && result.text) || '');
      }
    }
    catch (e) { P.debug('PDFWorker extraction: ' + e); }
    if (!text || !text.trim()) {
      try { text = (await attachment.attachmentText) || ''; }
      catch (e2) { text = ''; }
    }
    fullTextCache[attachment.id] = { at: Date.now(), text: String(text || '') };
    return fullTextCache[attachment.id].text;
  }

  async function annotations(item) {
    var attachment = await bestAttachment(item);
    if (!attachment) return '';
    var lines = [];
    try {
      var list = attachment.getAnnotations() || [];
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        var text = stripHTML(field(a, 'annotationText'));
        var comment = stripHTML(field(a, 'annotationComment'));
        var page = field(a, 'annotationPageLabel');
        var type = field(a, 'annotationType');
        if (!text && !comment) continue;
        lines.push('[p.' + (page || '?') + ' · ' + (type || '标注') + '] ' +
          (text ? '原文：' + text : '') + (comment ? ' 批注：' + comment : ''));
      }
    }
    catch (e) { P.debug('annotations: ' + e); }
    return lines.join('\n');
  }

  async function childNotes(item) {
    var lines = [];
    try {
      var ids = item.getNotes() || [];
      for (var i = 0; i < ids.length; i++) {
        var note = Zotero.Items.get(ids[i]);
        if (!note || !note.getNote) continue;
        var text = stripHTML(note.getNote()).slice(0, 4000);
        if (text) lines.push('- ' + text);
      }
    }
    catch (e) { P.debug('childNotes: ' + e); }
    return lines.join('\n');
  }

  function clip(text, budget) {
    text = String(text || '');
    if (budget <= 0) return '';
    if (text.length <= budget) return text;
    return text.slice(0, budget) + '\n…[已截断，可在设置中调大「上下文预算」]';
  }

  /* Build the material handed to the model. `mode`:
   *   meta      - metadata + abstract only
   *   annotated - metadata + annotations (+ notes when enabled)
   *   full      - everything, including PDF full text (default)
   */
  async function buildContext(items, options) {
    options = options || {};
    var list = (items || []).map(toRegularItem).filter(Boolean);
    var mode = options.mode || 'full';
    var maxChars = Number(options.maxChars || P.pref('contextChars', 24000)) || 24000;
    var includeFulltext = mode === 'full' && P.pref('includeFulltext', true) !== false && P.pref('includeFulltext', true) !== 'false';
    var includeAnnotations = mode !== 'meta' && P.pref('includeAnnotations', true) !== false && P.pref('includeAnnotations', true) !== 'false';
    var includeNotes = options.includeNotes === true ||
      (P.pref('includeNotes', false) === true || P.pref('includeNotes', false) === 'true');

    var sections = [];
    var used = 0;
    var truncated = false;
    var parts = [];
    function add(label, text, share) {
      if (!text || !String(text).trim()) return;
      var remaining = Math.max(0, maxChars - used);
      var budget = Math.min(remaining, share || remaining);
      if (budget < 120) return;
      var piece = clip(text, budget);
      if (piece !== text) truncated = true;
      used += piece.length;
      sections.push(label + '\n' + piece);
      parts.push({ label: label, chars: piece.length, truncated: piece !== text });
    }

    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      var header = '=== 文献 ' + (i + 1) + (list.length > 1 ? ' / ' + list.length : '') + ' ===';
      add(header, metaBlock(item), Math.max(2000, Math.floor(maxChars / Math.max(1, list.length)) * 0.3));
      if (includeAnnotations) {
        var marks = await annotations(item);
        add('[标注与批注]', marks, Math.max(1000, Math.floor(maxChars / Math.max(1, list.length)) * 0.2));
      }
      if (includeNotes) {
        var notes = await childNotes(item);
        add('[已有笔记]', notes, Math.max(1000, Math.floor(maxChars / Math.max(1, list.length)) * 0.15));
      }
      if (includeFulltext) {
        var text = await fullText(item);
        add('[PDF 全文]', text, Math.max(2000, maxChars - used - 1000));
      }
    }

    if (!sections.length) {
      sections.push('（当前没有可用的文献资料。请选中文献条目，或改用不依赖资料的通用提问。）');
    }
    return {
      text: sections.join('\n\n'),
      chars: used,
      truncated: truncated,
      itemCount: list.length,
      parts: parts,
      items: list,
    };
  }

  function noteHTML(answer, meta) {
    meta = meta || {};
    var now = new Date().toLocaleString('zh-CN');
    var head = '<h2>LitMag · ' + P.escapeHTML(meta.title || 'AI 问答') + '</h2>' +
      '<p><small>' + now + ' · 模型：' + P.escapeHTML(meta.model || '未记录') +
      ' · 文献：' + Number(meta.itemCount || 0) + ' 篇</small></p>';
    var question = meta.question ? '<p><strong>问题</strong><br>' + P.renderText(meta.question) + '</p>' : '';
    var sources = (meta.sources || []).length
      ? '<p><small>资料来源：' + P.escapeHTML(meta.sources.join('；')) + '</small></p>' : '';
    return head + question + '<hr><div>' + P.renderText(answer) + '</div>' + sources;
  }

  async function createChildNote(parent, html, tag) {
    var note = new Zotero.Item('note');
    note.libraryID = parent.libraryID;
    note.parentID = parent.id;
    note.setNote(html);
    if (tag) note.addTag(tag, 1);
    await note.saveTx();
    return note;
  }

  P.context = {
    field: field,
    stripHTML: stripHTML,
    creatorString: creatorString,
    selectedItems: selectedItems,
    toRegularItem: toRegularItem,
    metaBlock: metaBlock,
    bestAttachment: bestAttachment,
    fullText: fullText,
    annotations: annotations,
    childNotes: childNotes,
    buildContext: buildContext,
    clip: clip,
    noteHTML: noteHTML,
    createChildNote: createChildNote,
    clearCache: function () { fullTextCache = {}; },
  };
})();
