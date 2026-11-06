/* LitMag conversation sessions.
 *
 * A session belongs to one panel (the item pane section or a floating window).
 * The literature context is injected once, on the first turn; later turns ride
 * on the conversation history so a long chat does not resend the whole PDF.
 */

(function () {
  'use strict';

  var P = LitMag;

  function Session(id) {
    this.id = id;
    this.turns = [];
    this.busy = false;
    this.controller = null;
    this.items = [];
    this.mode = 'full';
    this.contextText = '';
    this.contextMeta = null;
    this.contextDirty = true;
    this.lastSources = [];
  }

  Session.prototype.setItems = function (items) {
    var next = (items || []).map(P.context.toRegularItem).filter(Boolean);
    var changed = next.length !== this.items.length ||
      next.some(function (item, i) { return !this.items[i] || item.id !== this.items[i].id; }, this);
    this.items = next;
    if (changed) this.contextDirty = true;
    return changed;
  };

  Session.prototype.setMode = function (mode) {
    if (this.mode === mode) return false;
    this.mode = mode;
    this.contextDirty = true;
    return true;
  };

  Session.prototype.reset = function () {
    this.stop();
    this.turns = [];
    this.contextText = '';
    this.contextMeta = null;
    this.contextDirty = true;
  };

  Session.prototype.stop = function () {
    if (this.controller) {
      try { this.controller.abort(); } catch (e) { /* ignore */ }
    }
    this.controller = null;
    this.busy = false;
  };

  function historyMessages(session, system) {
    var messages = [{ role: 'system', content: system }];
    var maxTurns = Number(P.pref('historyTurns', 8)) * 2 || 16;
    var source = session.turns.slice(0, -1); /* last turn is the new placeholder */
    var picked = source.slice(-maxTurns);
    var budget = 90000;
    var used = 0;
    var kept = [];
    for (var i = picked.length - 1; i >= 0; i--) {
      var turn = picked[i];
      var content = turn.expanded || turn.content || '';
      if (!content.trim()) continue;
      if (used + content.length > budget && kept.length) break;
      used += content.length;
      kept.unshift({ role: turn.role, content: content });
    }
    return messages.concat(kept);
  }

  Session.prototype.send = async function (input, options) {
    options = options || {};
    var session = this;
    if (this.busy) this.stop();
    var started = Date.now();
    var controller = new P.http.AbortLike();
    this.controller = controller;
    this.busy = true;

    var action = options.action ? P.prompts.get(options.action) : null;
    var typed = String(input || '').trim();
    var question = action ? P.prompts.render(action, { question: typed, itemCount: session.items.length }) : typed;
    if (!question) {
      this.busy = false;
      this.controller = null;
      return null;
    }

    var userTurn = {
      role: 'user',
      content: typed || (action ? action.label : ''),
      ts: started,
    };
    this.turns.push(userTurn);

    var answerTurn = {
      role: 'assistant',
      content: '',
      error: false,
      ts: Date.now(),
      model: P.ai.profile().model,
      question: question,
      itemCount: session.items.length,
      busy: true,
    };
    this.turns.push(answerTurn);

    var notify = function () {
      try { if (options.onUpdate) options.onUpdate(answerTurn, session); }
      catch (e) { P.debug('onUpdate: ' + e); }
    };
    notify();

    try {
      var expanded = question;
      if (this.turns.length <= 2 || this.contextDirty) {
        answerTurn.content = '正在读取 Zotero 文献资料…';
        notify();
        var built = await P.context.buildContext(this.items, { mode: action ? action.mode : this.mode });
        this.contextText = built.text;
        this.contextMeta = built;
        this.contextDirty = false;
        this.lastSources = built.items.map(function (item) { return P.context.field(item, 'title'); }).filter(Boolean);
      }
      if (controller.aborted) throw new Error('aborted');
      if (this.turns.length <= 2 && this.contextText) {
        expanded = '【文献资料】\n' + this.contextText + '\n\n【问题】\n' + question;
      }
      userTurn.expanded = expanded;
      answerTurn.content = '';
      answerTurn.meta = {
        title: typed || (action ? action.label : 'AI 问答'),
        model: P.ai.profile().model,
        itemCount: this.contextMeta ? this.contextMeta.itemCount : this.items.length,
        sources: this.lastSources,
        question: question,
      };
      notify();

      var messages = historyMessages(this, P.prompts.systemPrompt());
      messages.push({ role: 'user', content: expanded });
      var text = await P.ai.chat(messages, {
        signal: controller,
        onToken: function (_piece, whole) {
          answerTurn.content = whole;
          notify();
        },
      });
      answerTurn.content = text;
      answerTurn.ms = Date.now() - started;
    }
    catch (e) {
      if (!controller.aborted) {
        answerTurn.error = true;
        var message = P.http.errorText(e);
        if (e && e.code === 'LITMAG_NO_KEY') {
          message = '尚未配置 AI 模型。请打开「设置 → LitMag」，填写接口地址、API 密钥与模型名称；' +
            '支持 OpenAI / DeepSeek / 硅基流动 / 智谱 / Moonshot / Ollama / LM Studio / Anthropic 等。';
        }
        answerTurn.content = '**请求失败**\n\n' + message;
        answerTurn.ms = Date.now() - started;
      }
      else if (!answerTurn.content) {
        answerTurn.content = '（已停止）';
      }
    }
    finally {
      answerTurn.busy = false;
      this.busy = false;
      this.controller = null;
      notify();
    }
    return answerTurn;
  };

  function sessionFor(key) {
    var sessions = P.state.sessions;
    if (!sessions[key]) sessions[key] = new Session(key);
    return sessions[key];
  }

  function dropSession(key) {
    var session = P.state.sessions[key];
    if (session) session.stop();
    delete P.state.sessions[key];
  }

  function resetAll() {
    Object.keys(P.state.sessions).forEach(function (key) { dropSession(key); });
  }

  P.session = {
    Session: Session,
    historyMessages: historyMessages,
    sessionFor: sessionFor,
    dropSession: dropSession,
    resetAll: resetAll,
  };
})();
