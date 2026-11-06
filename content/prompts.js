/* LitMag built-in research prompts. Users can override the system prompt and
 * append their own instructions in Settings -> LitMag. */

(function () {
  'use strict';

  var P = LitMag;

  var SYSTEM_RULE = [
    '回答规则：',
    '1. 只依据下方提供的文献资料作答；资料不足时明确写「资料未提供依据」，不要编造。',
    '2. 引用具体内容时尽量标注 (p. N) 页码；多篇文献时用「文献 N」区分。',
    '3. 用简体中文，结构化、简明、可核查；公式用 LaTeX，表格用 Markdown。',
    '4. 区分「作者观点」与「你的推断」。',
  ].join('\n');

  function systemPrompt() {
    return [String(P.pref('systemPrompt', '') || '').trim(), SYSTEM_RULE]
      .filter(Boolean).join('\n\n');
  }

  var QUICK_ACTIONS = [
    {
      id: 'summary', label: '总结全文', mode: 'full', multi: false,
      prompt: '请总结这篇文献：研究背景与问题、数据来源、方法、主要结论、作者自述的贡献。分点输出，附页码。',
    },
    {
      id: 'design', label: '研究设计', mode: 'full', multi: false,
      prompt: '请提取这篇文献的研究设计：研究假设、样本/数据来源与期间、变量定义（含被解释变量、核心解释变量、控制变量）、计量模型或识别策略、稳健性检验。用表格或分点列出，附页码。',
    },
    {
      id: 'contribution', label: '结论与贡献', mode: 'full', multi: false,
      prompt: '请归纳这篇文献的主要结论、理论贡献、实践/政策含义，并指出哪些结论有统计或实证支持。附页码。',
    },
    {
      id: 'limits', label: '局限与缺口', mode: 'full', multi: false,
      prompt: '请指出这篇文献的局限（数据、识别、外推性、测量等），并据此提出 3-5 个可继续推进的研究问题。区分作者自述局限与你的判断。',
    },
    {
      id: 'extract', label: '字段抽取', mode: 'full', multi: false,
      prompt: '请从资料中抽取结构化信息，只输出一个 JSON 对象，字段为：title, authors, year, journal, research_question, data_source, sample, method, dependent_variable, key_independent_variable, main_findings, limitations, keywords。找不到的字段填空字符串，不要添加解释文字。',
    },
    {
      id: 'outline', label: '综述提纲', mode: 'annotated', multi: false,
      prompt: '基于这篇文献，拟一份可用于写作的文献综述提纲（三级标题），并标注每一节可引用的观点与页码。',
    },
    {
      id: 'translate', label: '译校摘要', mode: 'meta', multi: false,
      prompt: '请把摘要翻译成通顺的简体中文，随后给出 3 条术语译法建议。不要改写原文含义。',
    },
    {
      id: 'review', label: '多篇综述', mode: 'full', multi: true,
      prompt: '请对以上多篇文献做一段可用于论文的综述：按主题/方法/结论归类，指出共识、分歧与演进脉络，并给出研究空白。每个判断标注「文献 N」。',
    },
    {
      id: 'compare', label: '对比矩阵', mode: 'annotated', multi: true,
      prompt: '请用 Markdown 表格对比以上文献：研究问题、数据/样本、方法、核心变量、主要结论、局限；每行一篇文献，最后一行写共性差异与可整合之处。',
    },
  ];

  function get(id) {
    for (var i = 0; i < QUICK_ACTIONS.length; i++) {
      if (QUICK_ACTIONS[i].id === id) return QUICK_ACTIONS[i];
    }
    return null;
  }

  function render(action, env) {
    env = env || {};
    var text = action.prompt;
    if (env.question) text += '\n\n补充要求：' + env.question;
    if (env.itemCount > 1) text += '\n\n共提供 ' + env.itemCount + ' 篇文献，请分别标识。';
    return text;
  }

  P.prompts = {
    SYSTEM_RULE: SYSTEM_RULE,
    QUICK_ACTIONS: QUICK_ACTIONS,
    systemPrompt: systemPrompt,
    get: get,
    render: render,
  };
})();
