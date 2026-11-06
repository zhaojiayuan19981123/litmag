/* LitMag HTTP layer.
 *
 * All traffic uses Zotero.HTTP.request, which runs with chrome privileges:
 * no CORS wall, honours Zotero's proxy settings, and works in every Zotero 10
 * build. Streaming is implemented with XMLHttpRequest.onprogress.
 */

(function () {
  'use strict';

  function AbortLike() {
    this._aborted = false;
    this._handlers = [];
  }
  AbortLike.prototype.abort = function () {
    if (this._aborted) return;
    this._aborted = true;
    var handlers = this._handlers.splice(0);
    for (var i = 0; i < handlers.length; i++) {
      try { handlers[i](); } catch (e) { /* ignore */ }
    }
  };
  Object.defineProperty(AbortLike.prototype, 'aborted', {
    get: function () { return this._aborted; },
  });
  AbortLike.prototype.onAbort = function (handler) {
    if (this._aborted) handler();
    else this._handlers.push(handler);
  };

  function hostOf(url) {
    try { return new URL(url).host; } catch (e) { return String(url).slice(0, 60); }
  }

  function bodyDetail(body) {
    try {
      var parsed = JSON.parse(body);
      var detail = (parsed && parsed.error && parsed.error.message) ||
        (typeof parsed.error === 'string' ? parsed.error : '') ||
        parsed.message || parsed.msg || parsed.detail || parsed.error_msg;
      if (detail) return String(detail).slice(0, 300);
    }
    catch (e) { /* not JSON */ }
    if (/^\s*</.test(body)) return '';
    return String(body || '').trim().slice(0, 300);
  }

  function classifyHTTP(status, body) {
    var text = bodyDetail(body) + ' ' + String(body || '').slice(0, 600);
    if (status === 402 || /insufficient.{0,12}(quota|balance|credit|fund)|余额|欠费|quota.{0,10}exceeded|billing|payment required/i.test(text)) return 'quota';
    if (/context.{0,10}(length|window)|maximum context|too many tokens|prompt is too long|input is too long|上下文|过长/i.test(text)) return 'context';
    if (/model/i.test(text) && /not.{0,12}(exist|found|support|available)|does not exist|invalid|unknown|no such|不存在|无效|不支持|未开通/i.test(text)) return 'model';
    if (status === 401 || status === 403 || /invalid.{0,12}(api.?key|token|auth)|incorrect api key|unauthori[sz]ed|鉴权|密钥/i.test(text)) return 'auth';
    if (status === 429) return 'rate';
    if (status === 404 || status === 405) return 'address';
    if (status >= 500) return 'server';
    if (status >= 400) return 'rejected';
    return 'other';
  }

  var FAILURES = {
    unreachable: '无法连接服务器。请检查接口地址、网络与代理设置；使用本地模型时请确认服务已启动。',
    timeout: '服务器响应超时，可能网络较慢或服务繁忙，请稍后重试。',
    certificate: '无法建立安全连接，请检查地址应使用 http 还是 https。',
    auth: '密钥验证失败：密钥可能有误、已过期，或无权使用该模型。',
    quota: '账户余额或额度不足，请充值或更换密钥。',
    rate: '请求被限流，请稍后重试。',
    model: '模型不存在或当前密钥无权使用，请在设置中检查模型名称。',
    context: '输入超出模型上下文长度，请换用长上下文模型或减小上下文预算。',
    address: '该地址下未找到接口，路径可能多写或漏写了 /v1。',
    rejected: '请求被服务拒绝。',
    server: '服务端内部错误，请稍后重试。',
    other: '请求失败。',
  };

  function HTTPError(status, body, url) {
    this.name = 'HTTPError';
    this.status = status;
    this.body = body;
    this.kind = classifyHTTP(status, body);
    var detail = bodyDetail(body).replace(/\s+/g, ' ').slice(0, 200);
    this.message = hostOf(url) + '：' + (FAILURES[this.kind] || FAILURES.other) +
      '（HTTP ' + status + (detail ? '，服务返回：' + detail : '') + '）';
  }
  HTTPError.prototype = Object.create(Error.prototype);
  HTTPError.prototype.constructor = HTTPError;

  function NetworkError(kind, url, cause) {
    this.name = 'NetworkError';
    this.kind = kind;
    var detail = String((cause && cause.message) || cause || '').slice(0, 160);
    this.message = hostOf(url) + '：' + (FAILURES[kind] || FAILURES.other) +
      (detail ? '（' + detail + '）' : '');
  }
  NetworkError.prototype = Object.create(Error.prototype);
  NetworkError.prototype.constructor = NetworkError;

  function explainRequestFailure(e, url) {
    if (e instanceof HTTPError || e instanceof NetworkError) return e;
    var name = String((e && e.name) || '') + ' ' + String((e && e.message) || e || '');
    if (/timed?\s*out|timeout/i.test(name)) return new NetworkError('timeout', url, e);
    if (/security|certificate|ssl|tls|SEC_ERROR|SSL_ERROR/i.test(name)) {
      return new NetworkError('certificate', url, e);
    }
    var xhr = e && (e.xmlhttp || e.target);
    var status = Number((xhr && xhr.status) || (e && e.status) || 0);
    if (status > 0) {
      var body = '';
      try { body = String((xhr && (xhr.responseText || xhr.response)) || ''); } catch (e2) { /* binary */ }
      return new HTTPError(status, body, url);
    }
    if (xhr || /offline|NS_ERROR|connect|network|refused|resolve|status 0/i.test(name)) {
      return new NetworkError('unreachable', url, e);
    }
    return (e instanceof Error) ? e : new Error(String(e));
  }

  function transport() {
    if (typeof Zotero === 'undefined' || !Zotero.HTTP || !Zotero.HTTP.request) {
      throw new Error('Zotero.HTTP.request 不可用（此插件必须在 Zotero 内运行）');
    }
    return Zotero.HTTP.request.bind(Zotero.HTTP);
  }

  async function request(method, url, options) {
    options = options || {};
    var xhrRef;
    try {
      var xhr = await transport()(method, url, {
        headers: options.headers || {},
        body: options.body,
        responseType: 'text',
        timeout: options.timeout || 900000,
        requestObserver: function (x) {
          xhrRef = x;
          if (options.signal) {
            options.signal.onAbort(function () { try { x.abort(); } catch (e) { /* ignore */ } });
          }
        },
      });
      var text = typeof xhr === 'string' ? xhr :
        (typeof xhr.response === 'string' ? xhr.response : (xhr.responseText || ''));
      return { status: xhr.status || 200, text: text || '' };
    }
    catch (e) {
      if (options.signal && options.signal.aborted) throw new Error('aborted');
      void xhrRef;
      throw explainRequestFailure(e, url);
    }
  }

  async function streamPost(url, options) {
    options = options || {};
    var consumed = 0;
    var whole = '';
    try {
      var xhr = await transport()('POST', url, {
        headers: options.headers || {},
        body: options.body,
        responseType: 'text',
        timeout: options.timeout || 900000,
        requestObserver: function (x) {
          if (options.signal) {
            options.signal.onAbort(function () { try { x.abort(); } catch (e) { /* ignore */ } });
          }
          x.onprogress = function (event) {
            var current = '';
            try { current = String((event && event.target && event.target.response) || ''); }
            catch (e) { return; }
            if (current.length <= consumed) return;
            var delta = current.slice(consumed);
            consumed = current.length;
            whole = current;
            try { options.onChunk(delta, whole); } catch (err) { LitMag.debug('stream consumer: ' + err); }
          };
        },
      });
      var finalText = (typeof xhr === 'string') ? xhr : String((xhr && xhr.response) || '');
      if (finalText.length > consumed) {
        options.onChunk(finalText.slice(consumed), finalText);
      }
      return finalText || whole;
    }
    catch (e) {
      if (options.signal && options.signal.aborted) return whole;
      throw explainRequestFailure(e, url);
    }
  }

  function parseSSE(chunk) {
    var out = [];
    var lines = String(chunk || '').split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var trimmed = lines[i].trim();
      if (trimmed.indexOf('data:') !== 0) continue;
      var payload = trimmed.slice(5).trim();
      if (payload) out.push(payload);
    }
    return out;
  }

  function errorText(e) {
    if (!e) return 'unknown error';
    return String(e.message || e).slice(0, 500);
  }

  LitMag.http = {
    AbortLike: AbortLike,
    HTTPError: HTTPError,
    NetworkError: NetworkError,
    classifyHTTP: classifyHTTP,
    bodyDetail: bodyDetail,
    explainRequestFailure: explainRequestFailure,
    request: request,
    streamPost: streamPost,
    parseSSE: parseSSE,
    errorText: errorText,
  };
})();
