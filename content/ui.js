/* LitMag UI: an item-pane section and a floating panel inside the Zotero main
 * window (the same approach Zotero Prism uses). Both share buildPanel(), so a
 * conversation started in the section can continue in the floating window.
 * No separate XUL window, no browser element, no HTTP server.
 */

(function () {
  'use strict';

  var P = LitMag;
  var floatPanel = null;

  function select(doc, className, options, current, onChange) {
    var node = P.el(doc, 'select', className);
    options.forEach(function (opt) {
      var item = P.el(doc, 'option', '', opt.label);
      item.setAttribute('value', opt.value);
      if (opt.value === current) item.setAttribute('selected', 'selected');
      node.appendChild(item);
    });
    node.value = current;
    if (onChange) node.addEventListener('change', function () { onChange(node.value); });
    return node;
  }

  function lastAssistant(session) {
    for (var i = session.turns.length - 1; i >= 0; i--) {
      if (session.turns[i].role === 'assistant') return session.turns[i];
    }
    return null;
  }

  function buildPanel(doc, options) {
    options = options || {};
    var sessionKey = options.sessionKey || ('panel-' + Date.now());
    var session = P.session.sessionFor(sessionKey);
    var compact = !!options.compact;
    session.setItems(options.items || []);
    if (options.mode) session.setMode(options.mode);

    var root = P.el(doc, 'div', 'litmag-panel' + (options.float ? ' litmag-float' : ''));
    var head = P.el(doc, 'div', 'litmag-head');
    head.appendChild(P.el(doc, 'div', 'litmag-brand', 'LitMag AI'));

    var status = P.el(doc, 'div', 'litmag-status', P.ai.statusText());
    head.appendChild(status);

    var headButtons = P.el(doc, 'div', 'litmag-head-actions');
    headButtons.appendChild(P.button(doc, '设置', 'litmag-btn litmag-btn-mini', function () {
      P.openPreferences();
      status.textContent = P.ai.statusText();
    }));
    if (options.float) {
      headButtons.appendChild(P.button(doc, '✕', 'litmag-btn litmag-btn-mini', function () {
        destroy();
      }));
    }
    else if (!compact) {
      headButtons.appendChild(P.button(doc, '浮窗', 'litmag-btn litmag-btn-mini', function () {
        openFloat({ items: session.items });
      }));
    }
    head.appendChild(headButtons);
    root.appendChild(head);

    var modeRow = P.el(doc, 'div', 'litmag-mode');
    modeRow.appendChild(P.el(doc, 'span', 'litmag-mode-label', '上下文'));
    var modeSelect = select(doc, 'litmag-select', [
      { value: 'meta', label: '元数据 + 摘要' },
      { value: 'annotated', label: '+ 标注 / 笔记' },
      { value: 'full', label: '+ PDF 全文' },
    ], session.mode, function (value) {
      session.setMode(value);
      setHint('上下文模式已切换，下一次提问生效');
    });
    modeRow.appendChild(modeSelect);
    var itemInfo = P.el(doc, 'span', 'litmag-mode-info', session.items.length + ' 篇文献');
    modeRow.appendChild(itemInfo);
    root.appendChild(modeRow);

    var quick = P.el(doc, 'div', 'litmag-quick');
    P.prompts.QUICK_ACTIONS.forEach(function (action) {
      if (action.multi && session.items.length < 2 && compact) return;
      quick.appendChild(P.button(doc, action.label, 'litmag-chip', function () {
        send('', { action: action.id });
      }));
    });
    root.appendChild(quick);

    var transcript = P.el(doc, 'div', 'litmag-transcript');
    root.appendChild(transcript);

    var hint = P.el(doc, 'div', 'litmag-hint', '');
    root.appendChild(hint);
    function setHint(text) {
      hint.textContent = text || '';
      if (text && typeof setTimeout === 'function') {
        try {
          setTimeout(function () { if (hint.textContent === text) hint.textContent = ''; }, 4000);
        }
        catch (e) { /* ignore */ }
      }
    }

    var inputRow = P.el(doc, 'div', 'litmag-input-row');
    var input = P.el(doc, 'textarea', 'litmag-input');
    input.setAttribute('rows', compact ? '2' : '3');
    input.setAttribute('placeholder', '问点什么…（Ctrl / Cmd + Enter 发送）');
    inputRow.appendChild(input);
    var sendButton = P.button(doc, '发送', 'litmag-btn litmag-btn-primary', function () {
      send(input.value);
      input.value = '';
    });
    var stopButton = P.button(doc, '停止', 'litmag-btn', function () {
      session.stop();
      render();
    });
    inputRow.appendChild(sendButton);
    inputRow.appendChild(stopButton);
    root.appendChild(inputRow);
    input.addEventListener('keydown', function (event) {
      if (event && (event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        send(input.value);
        input.value = '';
      }
    });

    var footer = P.el(doc, 'div', 'litmag-footer');
    footer.appendChild(P.button(doc, '存为子笔记', 'litmag-btn litmag-btn-mini', saveNote));
    footer.appendChild(P.button(doc, '复制回答', 'litmag-btn litmag-btn-mini', copyAnswer));
    footer.appendChild(P.button(doc, '新对话', 'litmag-btn litmag-btn-mini', function () {
      session.reset();
      render();
      setHint('已开始新对话');
    }));
    root.appendChild(footer);

    var renderTimer = null;
    function render() {
      while (transcript.firstChild) transcript.removeChild(transcript.firstChild);
      if (!session.turns.length) {
        transcript.appendChild(P.el(doc, 'div', 'litmag-empty',
          '选择文献后，用上方快捷指令或直接提问。回答基于 Zotero 库中的元数据、PDF 全文与标注。'));
      }
      session.turns.forEach(function (turn) {
        var bubble = P.el(doc, 'div', 'litmag-turn litmag-turn-' + turn.role + (turn.error ? ' litmag-turn-error' : ''));
        var meta = P.el(doc, 'div', 'litmag-turn-meta',
          (turn.role === 'user' ? '你' : 'LitMag') +
          (turn.ms ? ' · ' + (turn.ms / 1000).toFixed(1) + 's' : '') +
          (turn.busy ? ' · 生成中…' : ''));
        bubble.appendChild(meta);
        var body = P.el(doc, 'div', 'litmag-turn-body');
        body.innerHTML = P.renderText(turn.content || (turn.busy ? '…' : ''));
        bubble.appendChild(body);
        transcript.appendChild(bubble);
      });
      try { transcript.scrollTop = transcript.scrollHeight; } catch (e) { /* ignore */ }
      sendButton.disabled = !!session.busy;
      stopButton.disabled = !session.busy;
      status.textContent = P.ai.statusText();
      itemInfo.textContent = session.items.length + ' 篇文献';
    }

    function scheduleRender(force) {
      if (force) {
        if (renderTimer) { try { clearTimeout(renderTimer); } catch (e) { /* ignore */ } renderTimer = null; }
        render();
        return;
      }
      if (renderTimer) return;
      if (typeof setTimeout !== 'function') { render(); return; }
      renderTimer = setTimeout(function () { renderTimer = null; render(); }, 60);
    }

    function onUpdate(_turn, sess) {
      if (sess !== session) return;
      scheduleRender(false);
    }

    function send(text, extra) {
      var opts = { onUpdate: onUpdate };
      if (extra && extra.action) opts.action = extra.action;
      status.textContent = P.ai.statusText();
      scheduleRender(true);
      session.send(text, opts).then(function () { scheduleRender(true); })
        .catch(function (e) { P.debug('send: ' + e); scheduleRender(true); });
    }

    async function saveNote() {
      var turn = lastAssistant(session);
      if (!turn || turn.error || !String(turn.content || '').trim()) {
        P.notify('暂无可保存的回答。');
        return;
      }
      var parent = session.items[0];
      if (!parent) {
        P.notify('请先选中一条文献，回答会保存为它的子笔记。');
        return;
      }
      var meta = turn.meta || {};
      meta.title = String(turn.question || meta.title || 'AI 问答').slice(0, 80);
      meta.model = turn.model || P.ai.profile().model;
      meta.itemCount = session.items.length;
      meta.sources = session.lastSources || [];
      try {
        await P.context.createChildNote(parent, P.context.noteHTML(turn.content, meta), 'LitMag');
        setHint('已保存为该条目的子笔记');
      }
      catch (e) {
        P.notify('保存笔记失败：' + P.http.errorText(e));
      }
    }

    function copyAnswer() {
      var turn = lastAssistant(session);
      if (!turn || !turn.content) { P.notify('暂无可复制的回答。'); return; }
      setHint(P.copyText(turn.content) ? '已复制到剪贴板' : '复制失败，请手动选择文本');
    }

    function destroy() {
      if (renderTimer) { try { clearTimeout(renderTimer); } catch (e) { /* ignore */ } renderTimer = null; }
      if (root.parentNode) {
        try { root.parentNode.removeChild(root); } catch (e) { /* ignore */ }
      }
      if (floatPanel && floatPanel.root === root) floatPanel = null;
    }

    function updateItems(items, mode) {
      session.setItems(items || []);
      if (mode) session.setMode(mode);
      render();
    }

    function setQuestion(text) {
      if (!text) return;
      input.value = text;
      try { input.focus(); } catch (e) { /* ignore */ }
    }

    render();
    return {
      root: root,
      session: session,
      render: render,
      send: send,
      updateItems: updateItems,
      setQuestion: setQuestion,
      destroy: destroy,
      transcript: transcript,
    };
  }

  /* Floating panel lives inside the Zotero main window, so there is no second
   * process or window to manage. Falls back to an alert if the window is not
   * ready yet. */
  function openFloat(options) {
    options = options || {};
    var win;
    try { win = Zotero.getMainWindow && Zotero.getMainWindow(); } catch (e) { win = null; }
    if (!win || !win.document) {
      P.notify('无法打开 AI 助手：Zotero 主窗口尚未就绪。');
      return null;
    }
    var doc = win.document;
    if (floatPanel && floatPanel.root && floatPanel.root.parentNode) {
      floatPanel.updateItems(options.items || P.context.selectedItems(), options.mode);
      if (options.question) floatPanel.setQuestion(options.question);
      return floatPanel;
    }
    var panel = buildPanel(doc, {
      sessionKey: 'litmag-float',
      items: options.items || P.context.selectedItems(),
      mode: options.mode || 'full',
      float: true,
    });
    var parent = doc.body || doc.documentElement;
    parent.appendChild(panel.root);
    floatPanel = panel;
    if (options.question) panel.setQuestion(options.question);
    return panel;
  }

  function closeFloat() {
    if (floatPanel) floatPanel.destroy();
    floatPanel = null;
  }

  /* Item pane section: rebuilt on item change, conversation kept per item. */
  function renderSection(args) {
    var doc = args && args.doc;
    var body = args && args.body;
    var item = args && args.item;
    if (!doc || !body) return;
    try { while (body.firstChild) body.removeChild(body.firstChild); }
    catch (e) { /* ignore */ }
    var items = [];
    if (item) {
      try { items = [P.context.toRegularItem(item)].filter(Boolean); } catch (e) { items = []; }
    }
    var key = 'section-' + (items[0] ? items[0].id : 'none');
    var panel = buildPanel(doc, { sessionKey: key, items: items, compact: true });
    body.appendChild(panel.root);
    return panel;
  }

  P.ui = {
    buildPanel: buildPanel,
    openFloat: openFloat,
    closeFloat: closeFloat,
    renderSection: renderSection,
    lastAssistant: lastAssistant,
    currentFloat: function () { return floatPanel; },
  };
})();
