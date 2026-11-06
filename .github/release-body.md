# LitMag v2.0 · 纯 Zotero 插件版

**这一版把 v1.0 的「插件 + 本机桥接服务」架构彻底删掉了。** 现在只有一个 `.xpi`：安装到 Zotero 10 后即可使用，不需要打开任何外部程序，不需要 Node.js、不需要本地服务、不需要原工作台。大模型由用户自己在「设置 → LitMag」中填写，插件通过 Zotero 自带的特权网络能力直接向该接口发起请求。

参考了 [zotero-prism](https://github.com/mxlapan/zotero-prism) 的做法：`Zotero.Prefs` 保存用户配置、`Zotero.HTTP` 直连模型（含 SSE 流式）、`Zotero.PDFWorker` / 全文索引读取附件、`Zotero.Item('note')` 写回子笔记。

## 主要变化

- 删除 `engine/` 桥接服务、启动脚本、握手探活、令牌文件与工作台内嵌窗口；XPI 内不再有任何本地端口监听或外部进程依赖。
- 新增模型设置页：服务商（OpenAI 兼容 / Anthropic / 自定义完整端点）、Base URL、完整端点开关、API Key、模型名称、温度、最大 tokens、流式输出、系统提示词、上下文预算、附带全文/标注/笔记、保留轮数、配置档、**测试连接**与**获取模型列表**。
- 新增 AI 内核：OpenAI 兼容 `/chat/completions` 与 Anthropic `/v1/messages` 双协议、SSE 流式输出、链式思考字段过滤、空回答与网页误填检测、按状态码/响应体分类的可操作中文报错（密钥、余额、限流、模型、上下文、地址）。
- 新增 Zotero 原生上下文：条目元数据、摘要、PDF 全文、标注批注、已有子笔记；按预算截断，仅在会话首轮注入。
- 新增条目面板「LitMag AI」分区、主窗口内浮层助手、工具/右键菜单、阅读器划词三动作、9 个科研快捷指令；回答可保存为条目的子笔记或复制。
- 全部数据以 Zotero 库为真源；Zotero 10 原生 Reading Mode、FTS5 检索、批注与同步保持不变。

## 安装与配置

1. 下载 `litmag-2.0.xpi` → Zotero 10 → 工具 → 插件 → ⚙ → Install Add-on From File → 重启。
2. 设置 → LitMag：填 Base URL、API Key、模型名称 → 「测试连接」。
3. 选中一条文献，在右侧「LitMag AI」分区提问；或用工具菜单打开浮窗、右键生成多篇综述、阅读器里划词提问。

支持 OpenAI、DeepSeek、硅基流动、Moonshot、智谱、通义千问、Gemini 的 OpenAI 兼容端点、Anthropic、Ollama / LM Studio / vLLM / 任意中转。

## 验证

- `node --test`：覆盖 manifest、启动/关闭与菜单回退、条目面板、阅读器、模型协议与 SSE、错误分类、上下文与笔记写回、偏好面板，并在本地真实 HTTP 服务上完成 SSE 流式端到端测试。
- 构建脚本为零依赖纯 Node，产出 `litmag-2.0.xpi`、`update.json`、`SHA256SUMS.txt`；`update.json` 的 `update_hash` 与 XPI 字节一致。
- CI 在 Node 20 / 22 × Ubuntu / Windows 四个组合上构建并测试。

## 说明

- 仅适配 Zotero 10（`10.0.6` ~ `10.*`）。本机未安装 Zotero 10，XPI 未做真机安装验证；首次试装建议使用独立测试配置 `-p`。
- 密钥保存在本机 Zotero 偏好中，插件不内置任何密钥，也不把配置上传到别处。
- 扫描版 PDF 需先由 Zotero 建立全文索引，否则只能读到元数据与摘要。
