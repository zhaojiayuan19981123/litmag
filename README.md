# LitMag · Zotero 10 AI 插件

**完全运行在 Zotero 内部的 AI 助手。** 安装一个 `.xpi` 即可，不需要启动任何外部程序、本地服务或工作台，也不需要 Node.js / npm。**模型由你自己配置**：在 Zotero 设置里填写接口地址、API Key 和模型名称，插件通过 Zotero 自带的特权 HTTP 能力直接向该接口发请求。

> 仅支持 Zotero 10（`strict_min_version 10.0.6` / `strict_max_version 10.*`）。
> 本页描述的是 **v2.0 纯插件版**；v1.0 的「插件 + 本机桥接服务」方案已废弃。

## 安装

1. 从 [Releases](https://github.com/zhaojiayuan19981123/litmag/releases) 下载 `litmag-2.0.xpi`。
2. Zotero → 工具 → 插件 → ⚙ → **Install Add-on From File** → 选择该 `.xpi` → 重启 Zotero。
3. 打开 **设置 → LitMag**，填写模型信息，点击「测试连接」。

插件自带 `update.json`，后续版本可在 Zotero 内直接更新。

## 配置自己的大模型

设置页所有字段都保存在本机 Zotero 配置中，插件不内置任何密钥，也不会把配置发到别处。

| 字段 | 说明 |
|---|---|
| 服务商 | OpenAI 兼容 / Anthropic / 自定义完整端点 |
| Base URL | 接口根地址；默认自动拼接 `/v1/chat/completions`（Anthropic 为 `/v1/messages`） |
| 完整端点 | 勾选后不再自动拼接，Base URL 原样使用 |
| API Key | 你的密钥；Ollama、LM Studio 等本机模型可留空 |
| 模型名称 | 如 `gpt-4o-mini`、`deepseek-chat`，也可点「获取模型列表」从接口拉取 |
| 温度 / 最大 tokens / 流式输出 | 常用生成参数；流式输出如遇到不兼容的中转可关闭 |
| 系统提示词 | 可完全覆盖，内置回答规则（不编造、标页码、简体中文）仍会追加 |
| 上下文预算 / 附带全文 / 标注 / 笔记 / 保留轮数 | 控制每次提问发送给模型的 Zotero 资料量 |
| 配置档 | 保存多套设置（如工作用与本地模型），一键切换 |

常用 Base URL 示例（模型名称以服务商当前文档为准）：

| 服务商 | Base URL | 协议 |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | OpenAI 兼容 |
| DeepSeek | `https://api.deepseek.com` 或 `/v1` | OpenAI 兼容 |
| 硅基流动 | `https://api.siliconflow.cn/v1` | OpenAI 兼容 |
| Moonshot / 智谱 / 通义千问 | 各自的 `/v1` 地址 | OpenAI 兼容 |
| Google Gemini | 其 OpenAI 兼容端点 | OpenAI 兼容 |
| Anthropic | `https://api.anthropic.com` | Anthropic |
| Ollama | `http://127.0.0.1:11434/v1` | OpenAI 兼容（无需密钥） |
| LM Studio / vLLM / 任意中转 | 服务自身的 `/v1` 地址 | OpenAI 兼容 |

## 能做什么

- **条目面板「LitMag AI」分区**：随选中条目切换，显示模型状态、上下文模式、快捷指令与对话记录。
- **主窗口浮层助手**（工具 → LitMag：打开 AI 助手）：与 Zotero Prism 一样嵌在主窗口内，可跨条目对话。
- **右键与工具菜单**：分析选中条目、生成多文献综述、打开设置、查看状态。
- **阅读器划词**：选中文字后可「解释这段 / 翻译这段 / 就此提问」。
- **快捷指令**：总结全文、研究设计、结论与贡献、局限与缺口、结构化字段抽取（JSON）、综述提纲、译校摘要、多篇综述、对比矩阵。
- **写回 Zotero**：一键把回答保存为当前条目的子笔记（带 `LitMag` 标签、模型名、时间与来源），也可复制到剪贴板。
- **上下文来自 Zotero 库**：元数据、摘要、PDF 全文（`Zotero.PDFWorker` / 全文索引）、标注与批注、已有子笔记。不额外建库、不双写。

上下文只在会话第一轮注入，之后依赖对话历史；每轮资料按「上下文预算」截断，可在设置里调大或调小。

## 架构

```
manifest.json / bootstrap.js / prefs.js
content/core.js     偏好、状态、DOM 与小工具
content/http.js     Zotero.HTTP 请求、SSE 流式、错误分类
content/ai.js       用户配置 → OpenAI 兼容 / Anthropic 请求
content/context.js  Zotero 条目 / 全文 / 标注 / 笔记读写
content/prompts.js  内置科研指令与系统规则
content/session.js  多轮会话与上下文注入
content/ui.js       条目面板 + 主窗口浮层
content/menus.js    菜单、分区、偏好页、阅读器、生命周期
```

所有网络请求由 Zotero 进程直接发出，没有 CORS 限制，也没有本地端口监听。Zotero 10 原生的 Reading Mode、FTS5 全文检索、批注与同步继续作为底座，插件不重复实现。

## 从源码构建与测试

```bash
node scripts/build-xpi.mjs   # 生成 dist/litmag-2.0.xpi、update.json、SHA256SUMS.txt
node --test                  # 单元测试 + 本地真实 HTTP/SSE 端到端测试
```

构建脚本零依赖（自带 ZIP 实现），测试覆盖启动/关闭、菜单回退、条目面板、阅读器、模型协议、SSE 解析、错误分类、上下文构建、笔记写回与偏好面板。

## 已知限制

- 目前**仅适配 Zotero 10**；未在本机真机安装验证（测试使用模拟 Zotero 生命周期 + 真实 HTTP 服务）。首次试装建议使用独立测试配置 `-p`，不要直接拿日常库试。
- 扫描版 PDF 需先由 Zotero 建立全文索引（或 OCR），否则插件只能读到元数据与摘要。
- 密钥保存在本机 Zotero 偏好中（与同类插件一致），请避免共享 Zotero 配置文件；需要更高安全性时可使用只限本机、可随时轮换的密钥。
- 插件不实现版面分析、译文 PDF 回写、邮件推送等依赖原生二进制或外部进程的功能。

## 许可

MIT · https://github.com/zhaojiayuan19981123/litmag
