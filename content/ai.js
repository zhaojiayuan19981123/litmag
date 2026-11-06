/* LitMag model access.
 *
 * Two protocols cover essentially every provider a user may fill in:
 *   openai   - any /chat/completions compatible endpoint (OpenAI, DeepSeek,
 *              SiliconFlow, Moonshot, Zhipu, Qwen, vLLM, Ollama, LM Studio,
 *              Gemini's OpenAI-compatible endpoint, or a relay)
 *   anthropic - /v1/messages
 * `custom` is an alias of `openai` with "Base URL is the complete endpoint"
 * preselected, kept as a separate value so profiles stay readable.
 *
 * No key is bundled. The request goes directly from Zotero to the endpoint the
 * user typed in Settings -> LitMag.
 */

(function () {
  'use strict';

  var P = LitMag;

  function profile() {
    return {
      provider: String(P.pref('provider', 'openai')),
      baseURL: String(P.pref('baseURL', 'https://api.openai.com/v1')),
      fullURL: P.pref('fullURL', false) === true || P.pref('fullURL', false) === 'true',
      apiKey: String(P.pref('apiKey', '') || '').trim(),
      model: String(P.pref('model', '') || '').trim(),
      temperature: Number(P.pref('temperature', 0.3)),
      maxTokens: Number(P.pref('maxTokens', 4096)) || 4096,
      stream: P.pref('stream', true) !== false && P.pref('stream', true) !== 'false',
      systemPrompt: String(P.pref('systemPrompt', '') || ''),
    };
  }

  function isLocal(url) {
    return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?/i.test(url || '');
  }

  function isConfigured() {
    var p = profile();
    if (!p.model) return false;
    return !!p.apiKey || isLocal(p.baseURL);
  }

  function noKeyError() {
    var e = new Error('尚未配置 AI 模型。请打开「设置 → LitMag」，填写接口地址、API 密钥和模型名称。');
    e.code = 'LITMAG_NO_KEY';
    return e;
  }

  function joinURL(base, path) {
    var trimmed = String(base || '').replace(/\/+$/, '');
    if (!trimmed) return '';
    if (P.pref('fullURL', false) === true || P.pref('fullURL', false) === 'true') return trimmed;
    if (/\/(chat\/completions|messages|models|embeddings)$/.test(trimmed)) return trimmed;
    if (/\/v\d+[a-zA-Z0-9._-]*$/.test(trimmed)) return trimmed + path.replace(/^\/v\d+[^\/]*/, '');
    return trimmed + path;
  }

  function chatEndpoint() {
    var p = profile();
    if (p.provider === 'anthropic') {
      return joinURL(p.baseURL || 'https://api.anthropic.com', '/v1/messages');
    }
    return joinURL(p.baseURL, '/v1/chat/completions');
  }

  function modelsEndpoint() {
    var p = profile();
    if (p.fullURL) {
      return p.baseURL.replace(/\/(chat\/completions|messages)$/, '/models');
    }
    if (p.provider === 'anthropic') return joinURL(p.baseURL, '/v1/models');
    return joinURL(p.baseURL, '/v1/models');
  }

  function headers() {
    var p = profile();
    if (p.provider === 'anthropic') {
      return {
        'Content-Type': 'application/json',
        'x-api-key': p.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      };
    }
    return {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + p.apiKey,
    };
  }

  function toAnthropic(messages) {
    var system = [];
    var rest = [];
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (m.role === 'system') system.push(m.content);
      else rest.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
    }
    return { system: system.join('\n\n'), messages: rest };
  }

  function buildBody(messages, p, options) {
    var model = options.model || p.model;
    var temperature = options.temperature === undefined ? p.temperature : options.temperature;
    var maxTokens = options.maxTokens || p.maxTokens;
    if (p.provider === 'anthropic') {
      var conv = toAnthropic(messages);
      return JSON.stringify({
        model: model,
        system: conv.system || undefined,
        messages: conv.messages,
        max_tokens: maxTokens,
        temperature: temperature,
        stream: !!options.stream,
      });
    }
    return JSON.stringify({
      model: model,
      messages: messages.map(function (m) { return { role: m.role, content: m.content }; }),
      temperature: temperature,
      max_tokens: maxTokens,
      stream: !!options.stream,
    });
  }

  function extractDelta(payload, provider) {
    try {
      var data = JSON.parse(payload);
      if (provider === 'anthropic') {
        if (data.type === 'content_block_delta') return (data.delta && data.delta.text) || '';
        return '';
      }
      var choice = data.choices && data.choices[0];
      /* Reasoning models stream their chain of thought in reasoning_content
       * with content:null. That must never be mistaken for the answer. */
      if (choice && choice.delta && choice.delta.content == null) return '';
      return (choice && (choice.delta && choice.delta.content)) ||
        (choice && choice.message && choice.message.content) ||
        (choice && choice.text) || '';
    }
    catch (e) { return ''; }
  }

  function extractWhole(text, provider) {
    try {
      var data = JSON.parse(text);
      if (provider === 'anthropic') {
        return (data.content || []).filter(function (b) { return b && b.type === 'text'; })
          .map(function (b) { return b.text; }).join('');
      }
      var choice = data.choices && data.choices[0];
      return (choice && choice.message && choice.message.content) || (choice && choice.text) || '';
    }
    catch (e) { return ''; }
  }

  function stopReason(payload, provider) {
    try {
      var data = JSON.parse(payload);
      if (provider === 'anthropic') {
        var r = (data.delta && data.delta.stop_reason) || data.stop_reason;
        return r === 'max_tokens' ? 'length' : '';
      }
      return (data.choices && data.choices[0] && data.choices[0].finish_reason === 'length') ? 'length' : '';
    }
    catch (e) { return ''; }
  }

  function notAnAnswer(body, url) {
    var text = String(body || '').trim();
    if (/^</.test(text)) {
      return new Error(url + ' 返回了网页而不是接口响应。接口地址可能有误（例如漏写 /v1，或误填为官网地址）。');
    }
    var first = P.http.parseSSE(text)[0] || text;
    if (/"error"|"code"\s*:\s*[1-9]/.test(first)) {
      var status = Number(/"(?:status|code)"\s*:\s*(\d{3})/.exec(first)?.[1]) || 400;
      return new P.http.HTTPError(status, first, url);
    }
    return new Error('模型返回了空回答。请检查模型名称，以及接口是否支持流式输出（可在设置中关闭流式）。');
  }

  function maxTokensText() {
    return '模型在推理阶段已达到 max_tokens 上限，未生成回答。请在「设置 → LitMag」中调大最大 tokens。';
  }

  function truncationNote() {
    return '\n\n> 回答已达到 max_tokens 上限，内容可能不完整。可在设置中调高「最大 tokens」。';
  }

  async function chat(messages, options) {
    options = options || {};
    if (!isConfigured()) throw noKeyError();
    var p = profile();
    var stream = p.stream && typeof options.onToken === 'function';
    var url = chatEndpoint();
    if (!url) throw new Error('接口地址为空，请在「设置 → LitMag」中填写 Base URL。');
    var body = buildBody(messages, p, {
      model: options.model,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      stream: stream,
    });

    if (!stream) {
      var res = await P.http.request('POST', url, {
        headers: headers(), body: body, signal: options.signal,
        timeout: options.timeout || 900000,
      });
      var answer = extractWhole(res.text, p.provider);
      if (!answer.trim() && !(options.signal && options.signal.aborted)) {
        throw notAnAnswer(res.text, url);
      }
      if (options.onToken) options.onToken(answer, answer);
      return answer;
    }

    var whole = '';
    var carry = '';
    var truncated = false;
    var consume = function (chunk) {
      for (var i = 0; i < chunk.length; i++) {
        var payload = chunk[i];
        if (payload === '[DONE]') continue;
        if (stopReason(payload, p.provider)) truncated = true;
        var piece = extractDelta(payload, p.provider);
        if (piece) {
          whole += piece;
          try { options.onToken(piece, whole); } catch (e) { P.debug('onToken: ' + e); }
        }
      }
    };

    var raw = await P.http.streamPost(url, {
      headers: headers(), body: body, signal: options.signal,
      timeout: options.timeout || 900000,
      onChunk: function (delta) {
        carry += delta;
        var boundary = carry.lastIndexOf('\n');
        if (boundary < 0) return;
        var ready = carry.slice(0, boundary);
        carry = carry.slice(boundary + 1);
        consume(P.http.parseSSE(ready));
      },
    });
    if (carry.trim()) consume(P.http.parseSSE(carry));
    if (!whole.trim()) {
      if (options.signal && options.signal.aborted) return whole;
      /* Some relays ignore `stream` and answer with a single JSON body. */
      var fallback = extractWhole(raw, p.provider);
      if (fallback.trim()) {
        if (options.onToken) options.onToken(fallback, fallback);
        return fallback;
      }
      throw truncated ? new Error(maxTokensText()) : notAnAnswer(raw, url);
    }
    if (truncated) {
      whole += truncationNote();
      try { options.onToken('', whole); } catch (e) { /* ignore */ }
    }
    return whole;
  }

  async function listModels() {
    try {
      var url = modelsEndpoint();
      if (!url) return [];
      var res = await P.http.request('GET', url, { headers: headers(), timeout: 20000 });
      var data = JSON.parse(res.text);
      return (data.data || []).map(function (m) { return String(m.id || ''); })
        .filter(Boolean).sort(function (a, b) { return a.localeCompare(b); });
    }
    catch (e) {
      P.debug('listModels failed: ' + P.http.errorText(e));
      return [];
    }
  }

  async function testConnection() {
    var started = Date.now();
    try {
      var reply = await chat([{ role: 'user', content: 'Reply with the single word: ready' }], {
        maxTokens: 16, temperature: 0, timeout: 60000,
      });
      return { ok: true, message: reply.trim().slice(0, 120) || '(empty reply)', ms: Date.now() - started };
    }
    catch (e) {
      return { ok: false, message: P.http.errorText(e), ms: Date.now() - started };
    }
  }

  /* ---- named profiles: several endpoints a user switches between ---- */

  function listProfiles() {
    var list = P.jsonPref('profiles', []);
    return Array.isArray(list) ? list : [];
  }

  function saveProfile(name) {
    name = String(name || '').trim();
    if (!name) return false;
    var list = listProfiles().filter(function (p) { return p.name !== name; });
    var current = profile();
    current.name = name;
    list.push(current);
    P.setJSONPref('profiles', list);
    return true;
  }

  function applyProfile(name) {
    var p = listProfiles().filter(function (x) { return x.name === name; })[0];
    if (!p) return false;
    ['provider', 'baseURL', 'fullURL', 'apiKey', 'model', 'temperature', 'maxTokens', 'stream', 'systemPrompt']
      .forEach(function (key) {
        if (p[key] !== undefined) P.setPref(key, p[key]);
      });
    return true;
  }

  function deleteProfile(name) {
    P.setJSONPref('profiles', listProfiles().filter(function (p) { return p.name !== name; }));
    return true;
  }

  function maskedKey() {
    var key = profile().apiKey;
    if (!key) return '（未填写，仅本地模型可用）';
    return key.length <= 8 ? '••••' : key.slice(0, 3) + '••••' + key.slice(-4);
  }

  function statusText() {
    var p = profile();
    if (!isConfigured()) return '未配置模型 · 点击「设置」填写';
    return '已配置 · ' + (p.provider === 'anthropic' ? 'Anthropic' : 'OpenAI 兼容') + ' · ' + p.model;
  }

  P.ai = {
    profile: profile,
    isConfigured: isConfigured,
    noKeyError: noKeyError,
    joinURL: joinURL,
    chatEndpoint: chatEndpoint,
    modelsEndpoint: modelsEndpoint,
    headers: headers,
    buildBody: buildBody,
    extractDelta: extractDelta,
    extractWhole: extractWhole,
    stopReason: stopReason,
    chat: chat,
    listModels: listModels,
    testConnection: testConnection,
    listProfiles: listProfiles,
    saveProfile: saveProfile,
    applyProfile: applyProfile,
    deleteProfile: deleteProfile,
    maskedKey: maskedKey,
    statusText: statusText,
  };
})();
