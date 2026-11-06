# LitMag · Zotero 10 插件

> 把「一站式科研终端」工作台接到 Zotero 10 里，**Zotero 库是唯一的数据真源**。
> 当前版本 `v1.0`，仅支持 **Zotero 10（10.0.6 及以上）**。

## 这一版解决什么

Zotero 10 已经原生提供了 PDF Reading Mode（表格、公式、图片按原版渲染）、FTS5 全文检索、条目/附件/批注/笔记体系。工作台里自研的阅读模式、版面分析、文献检索因此**不再移植**；LitMag 只做 Zotero 10 缺的那部分：把选中条目送进 AI 工作台，并为后续的结构化字段写回铺路。

Zotero 插件运行在 Gecko 特权 JS 环境，**不是 Node**：Express、`onnxruntime-node`、`worker_threads`、IMAP、原生二进制都无法放进 XPI。所以架构是两件套：

```
Zotero 10 进程
 ├─ 原生层：Reading Mode / FTS5 检索 / Items / 附件 / 批注   ← 直接复用，不移植
 └─ LitMag XPI（纯 JS）
      ├─ 菜单 / 条目面板 / Reader 选区 / 偏好设置
      ├─ 数据桥：UUID ↔ Zotero key、选中条目上下文
      └─ HTTP 127.0.0.1:23127 + token
                 ↕
独立 Node 进程：litmag-engine（零依赖）
      ├─ /api/litmag/*  握手、上下文
      └─ /workbench     反向代理到已有工作台（默认 3000）
```

**引擎完全不改动原工作台代码**，也不复制它的 65 MB 版面模型；它只是一个稳定的本机入口与反向代理。

## 安装

1. 从 [Releases](https://github.com/zhaojiayuan19981123/litmag/releases) 下载 `litmag-1.0.xpi` 与 `litmag-engine-1.0.zip`。
2. Zotero 10 → 工具 → 插件 → 齿轮图标 → Install Add-on From File → 选择 `.xpi`，重启 Zotero。
3. 解压 `litmag-engine-1.0.zip`，运行 `start.cmd`（Windows）或 `sh start.sh`（macOS / Linux），需要 Node.js 20+，**无需 `npm install`**。
4.（可选）启动原「一站式科研终端」的命令行版（`npm start`，默认 3000 端口）；只装插件、不开工作台也能使用条目面板与菜单。

引擎启动后会写 `~/.litmag/engine.json`（端口 + 会话令牌），插件自动读取。也可以在 Zotero → 设置 → LitMag 里手动填写引擎地址 / 工作台地址 / 令牌，并点「检查连接」。

## 使用

| 入口 | 作用 |
|---|---|
| 工具 → 打开 LitMag 工作台 | 打开内嵌窗口（`<browser>` 加载引擎 `/workbench`，同源 HTTP，避开跨域） |
| 工具 → 检查 LitMag 引擎状态 | 探活并显示版本与工作台在线状态 |
| 右键条目 → 用 LitMag 分析选中条目 | 把选中条目的元数据 / 附件路径 POST 到引擎并打开工作台 |
| 条目面板 → LitMag 分区 | 显示标题、作者、年份、期刊、引擎状态与两个操作按钮 |
| PDF 阅读器选区浮层 → 用 LitMag 提问 | 把选中文本作为问题带给工作台 |
| 设置 → LitMag | 引擎地址、工作台地址、令牌、是否内嵌窗口 |

引擎会把最近一次选中条目挂到工作台页面的 `window.__LITMAG_CONTEXT__`（通过代理 HTML 注入），供后续版本消费。

## 数据与边界

- **Zotero 库是唯一真源**：v1.0 只读 Zotero 条目，不写回字段、不改动 Zotero 数据库。
- 引擎只监听 `127.0.0.1`，写状态接口的请求需带 `X-LitMag-Token`；握手接口不需要令牌，便于探活。
- 原工作台的 `data/`、上传目录、API Key 一律不被插件读取或复制。
- `v1.0` 的上下文是「传递」而非「同步」：工作台页面已能拿到上下文，但尚未在 UI 中消费；字段写回属于下一版。
- `strict_min_version: 10.0.6`、`strict_max_version: 10.*`。Zotero 大版本迭代很快（8 → 9 → 10 都在 2026 年），请随大版本更新 `update.json`。

## Zotero 10 适配要点

插件代码按 Zotero 10 的 API 变更编写：

- 使用复数选择接口 `getSelectedItems()` / `getSelectedCollections()`；**不使用会抛错的单数 getter**，也不读 `MenuManager` 上下文里的 `collectionTreeRow`。
- 菜单优先走 `Zotero.MenuManager`，API 形态不符时回退到 DOM 注入，避免未来 10.x 构建里菜单整体消失。
- 条目分区使用官方 `Zotero.ItemPaneManager.registerSection`；偏好面板用 `Zotero.PreferencePanes.register`。
- 所有注册项都在 `shutdown()` 里注销，保证插件可免重启禁用。
- 全文检索、阅读模式、批注直接依赖 Zotero 10 原生能力（FTS5 `ftindex`、Reading Mode），不复制旧实现。

## 开发

```bash
npm test            # node --test，无参数（Node 20 与 22 均可）
npm run build       # 生成 dist/litmag-1.0.xpi、引擎包、SHA256SUMS、update.json
npm run engine      # 直接启动引擎
```

构建脚本零依赖，自己写 ZIP（store + UTF-8 标志），并把 XPI 的 `sha256` 写进 `update.json` 的 `update_hash`，供 Zotero 自动更新校验。

## 发布与更新

Release 资产：`litmag-1.0.xpi`、`litmag-engine-1.0.zip`、`SHA256SUMS.txt`、`update.json`。
`update.json` 同时放在 `main` 分支根目录，`manifest.json` 的 `update_url` 指向它；以后发新版只需替换 XPI、更新 hash 与版本号。

## 已知限制（v1.0）

- 开发机上没有安装 Zotero 10，因此 **XPI 未做真机安装验证**；已覆盖 manifest 结构、启动/关闭生命周期、菜单与面板注册、引擎 HTTP 接口的自动化测试。首次实装建议用独立的 Zotero 测试配置（`-p`），不要直接拿日常库试。
- 内嵌窗口用 XUL `<browser>` 加载本机 HTTP；若某个 10.x 构建阻止该加载，插件会自动降级为「在系统浏览器中打开」。
- 工作台独有模块（项目 / 任务 / 日历 / 灵感 / 成果 / 学位论文 / 顶刊 / 邮箱）仍在原应用中，不进入 XPI。
- 尚不支持把 AI 结构化字段写回 `extra` / 子笔记，也不支持跨文献对话面板——这两项是 v0.2 的内容。

## 路线

| 版本 | 内容 |
|---|---|
| **v1.0（本版）** | Zotero 10 only；菜单、条目面板、Reader 选区、偏好、引擎握手与上下文传递、工作台内嵌窗口 |
| v0.2 / 后续 | Zotero 库成为工作台唯一真源、AI 字段写回（含 `saveTx` 可撤销）、工作台消费上下文、原生阅读模式与检索全面替代自研实现 |
| 远期 | 引擎瘦身为纯重计算服务，插件只保留 AI 与工作台独有流程 |

## License

MIT
