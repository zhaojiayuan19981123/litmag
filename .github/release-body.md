# LitMag v2.0.1 · 真机修复版

**v2.0 装进真实的 Zotero 10.0.7 后完全用不了，本版修复了四个致命问题。** 架构不变：仍然只有一个 `.xpi`，完全运行在 Zotero 内部，不需要打开任何外部程序、不需要 Node.js、不需要本地服务；模型由用户自己在「设置 → LitMag」填写，插件通过 Zotero 特权 HTTP 能力直连接口。

## 修复了什么

1. **样式表从未被加载（界面全是裸 DOM）**：v2.0 在窗口加载后动态插入 `<?xml-stylesheet?>` 处理指令，XUL 文档解析完成后 Firefox 不会处理它。改为注入 `<html:link rel="stylesheet">`（与 zotero-prism 一致），并给浮层补上内联兜底布局，即使 CSS 未就绪也不会塌成一团。
2. **设置页整个消失**：`preferences.xhtml` 带了 `<?xml?>` 声明、根节点 `xmlns` 与内联 `<script>`，而 Zotero 10 把它当作 XUL **fragment** 插入偏好窗口，解析器抛 `not well-formed XML`，面板被静默丢弃。现改为裸 `<vbox>` fragment，命名空间由宿主文档提供，脚本与样式统一由 `PreferencePanes.register({ scripts, stylesheets })` 加载。
3. **「模型设置」菜单打开的是通用设置页**：Zotero 10 没有 `Zotero.PreferencePanes.open()`。改用 `Zotero.Utilities.Internal.openPreferences('litmag-prefpane')`，直接定位到 LitMag 面板。
4. **偏好页脚本早于控件插入**：`bind()` 现在会等待首个字段出现再绑定，并在 `onload` 兜底重试，避免字段读到空值或事件没挂上。

## 真机验证（Zotero 10.0.7 / Windows）

不再是只跑 shim 的模拟测试，这一版在本机真实 Zotero 上逐项验证过：

- 插件启动：8 个模块全部加载，偏好页 `litmag-prefpane` 与条目面板分区注册成功，工具菜单 4 项、右键菜单 1 项注入成功。
- 样式：主窗口 `styleSheets` 中出现 `skin/litmag.css`；浮层实测 `position=fixed / display=flex / visibility=visible`，尺寸 `460×680`，16 个按钮 + 1 个输入框。
- 设置页：`#litmag-prefpane` 面板实测 `578×585`，服务商、Base URL、API Key、模型名、温度、流式、系统提示词、保存、测试连接等控件全部在 DOM 中；`LitMagPrefs` 绑定成功，偏好值正确回填；`not well-formed XML` 错误消失。
- AI 链路：在真实 Zotero 内向本机临时 OpenAI 兼容端点发请求，`Zotero.HTTP.request` 正确带出 `Authorization: Bearer …` 与 OpenAI 格式 body；`测试连接` 返回 `ok=true`（32 ms）、对话返回完整回答、`获取模型列表` 正常。验证后临时配置已还原。

## 安装与配置

1. 下载 `litmag-2.0.1.xpi` → Zotero 10 → 工具 → 插件 → ⚙ → Install Add-on From File → 重启。已安装 v2.0 的用户可直接覆盖安装，或通过 `update.json` 在 Zotero 内更新。
2. 设置 → LitMag：填 Base URL、API Key、模型名称 → 「测试连接」。
3. 选中一条文献，在右侧「LitMag AI」分区提问；或用工具菜单打开浮窗、右键生成多篇综述、阅读器里划词提问。

支持 OpenAI、DeepSeek、硅基流动、Moonshot、智谱、通义千问、Gemini 的 OpenAI 兼容端点、Anthropic、Ollama / LM Studio / vLLM / 任意中转。

## 验证

- `node --test`：Node 20.10 与 Node 22.22 各 **47/47** 通过；覆盖 manifest 与版本一致性、启动/关闭与菜单回退、条目面板、阅读器、模型协议与 SSE、错误分类、上下文与笔记写回、偏好面板，并在本地真实 HTTP 服务上完成 SSE 端到端测试。
- 新增回归测试：锁住「偏好页必须是裸 XUL fragment，不得出现 XML 声明 / 根节点命名空间 / 内联 script」。
- 构建脚本为零依赖纯 Node，产出 `litmag-2.0.1.xpi`、`update.json`、`SHA256SUMS.txt`；`update.json` 的 `update_hash` 与 XPI 字节一致。
- CI 在 Node 20 / 22 × Ubuntu / Windows 四个组合上构建并测试。

## 说明

- 仅适配 Zotero 10（`10.0.6` ~ `10.*`）。
- 密钥保存在本机 Zotero 偏好中，插件不内置任何密钥，也不把配置上传到别处。
- 扫描版 PDF 需先由 Zotero 建立全文索引或 OCR，否则只能读到元数据与摘要。
