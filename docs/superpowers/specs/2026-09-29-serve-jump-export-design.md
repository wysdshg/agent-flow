# 设计规格：serve 实时刷新 / 代码定位跳转 / 导出 Mermaid·PNG

日期：2026-09-29
状态：已获用户批准（路线 A）
参考：gitdiagram（ahmedkhaleel2004/gitdiagram）的「点击跳代码 / 导出 / 实时网页体验」

## 1. 目标与背景

agent-flow 当前有三个体验短板：

1. agent 改完图后，用户必须手动重新打开 flow.html 才能看到新图；
2. 节点详情里的「代码定位」是纯文本 + 复制按钮，不能一键在 IDE 打开；
3. 流程图只能困在本地 HTML 里，进不了 README / GitHub 文档生态。

本设计新增两个 CLI 子命令（`serve`、`export`）并增强查看器，全部基于 Node stdlib，**不引入任何运行时依赖**（守住 README「零依赖」卖点）。

## 2. 已确认的决策

| 问题 | 决策 |
|---|---|
| 代码定位点击后跳哪 | 只做本地 IDE 跳转：`vscode://file/<绝对路径>:<行号>`（VS Code / Cursor / Trae 均响应） |
| serve 默认行为 | 全自动：端口 3457 + 自动拉起浏览器 + 监听 flow.json 自动重渲染并通知浏览器刷新；`--port N` / `--no-open` 可覆盖 |
| 导出范围 | CLI `agent-flow export` 生成 Mermaid；查看器顶栏加「PNG 下载」「复制 Mermaid」按钮（PNG/SVG 只能在浏览器端生成） |
| 实现路线 | A：纯 Node stdlib（node:http / fs.watch），serve 与 mermaid 导出各自独立模块，不塞进 mcp/server.ts，不引依赖 |

## 3. 总体结构

新增/改动文件：

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/serve/serve.ts` | 新增 | `startServe(store, opts)`：HTTP 服务 + 文件监听 + SSE 广播 + 自动开浏览器 |
| `src/render/mermaid.ts` | 新增 | `toMermaid(graph): string` 纯函数，Mermaid 文本生成 |
| `src/render/html.ts` | 修改 | 详情面板跳转链接；顶栏导出按钮；`DATA` 增加 `root`、`mermaid` 字段 |
| `src/index.ts` | 修改 | `serve` / `export` 子命令 + HELP 更新 |
| `test/smoke.ts` | 修改 | 新增 toMermaid 与 serve 的冒烟断言 |
| `README.md` / `README.zh-CN.md` | 修改 | CLI 命令表补 serve / export |

数据流不变：写操作 → `store.save()` → 布局 → `renderHtml()` → `store.saveHtml()`。serve 只是在这条链路的末端挂了「监听 → 重渲染 → 通知」。

## 4. `agent-flow serve`（实时刷新）

### 用法
```
agent-flow serve [--port 3457] [--no-open]
```

### 行为
- `GET /`：返回 `.flow/flow.html` 内容，**响应时注入**一段 `<script>`（`EventSource("/events")` 收到消息后 `location.reload()`）。注入只发生在内存中的响应里，**磁盘上的 flow.html 保持纯净**——不用 serve、双击打开照常可用。替换锚点用 `"</body>"`（flow.json 数据里的 `<` 已被转义为 `\u003c`，VIEWER_JS 无 `</body>` 字样，全文仅结尾一处，安全）。
- `GET /events`：SSE 流（`Content-Type: text/event-stream`，心跳注释每 25s 防代理断连）。
- 监听：`fs.watch(store.flowDir)`（监听目录而非单文件，规避部分平台单文件 watch 不触发的问题），收到事件且文件名为 `flow.json` 后防抖 300ms 执行 `load → layoutGraph → renderHtml → saveHtml`，然后向所有 SSE 连接广播 reload。
- 启动：打印 URL 与「agent 改图后浏览器会自动刷新」提示；自动拉起浏览器（linux `xdg-open` / darwin `open` / win `start`，`spawn` + `stdio: ignore` + `detached`，失败仅 console 提示，不影响服务）。
- 端口被占用：报错并提示 `--port` 换端口，退出码 1。
- 布局坐标的 localStorage 按 `DATA.hash` 隔离（既有机制），图一变 hash 变，刷新后自动用新自动布局，无脏坐标问题。

## 5. 代码定位跳转（本地 IDE）

### 解析规则（Node 侧，避开 VIEWER_JS 禁用反斜杠/正则转义的约束）
`buildViewData` 中新增纯函数 `parseLocation(location: string, root: string): { path: string; line?: number }[]`：
1. 按 `;` 拆段，逐段 trim；
2. 每段提取「带扩展名的路径 token」+ 可选行号，支持三种行号写法：`path.ts:12`、`path.ts 12`、`README.md 20-50行`（区间取起始行）；
3. 相对路径拼 `root`（`store.root` 绝对路径，新增进 `DATA.root`）成绝对路径；已是绝对路径直接用；
4. 提取不到路径的段丢弃（保持「位置」行原有纯文本兜底）。

### 节点数据
`VNode` 新增 `locLinks?: { path: string; line?: number }[]`（多文件 = 多元素）。

### 前端渲染（详情面板「位置」行）
- 每个 locLink 渲染为 `<a class="copy" data-loc="...">path:line ↗</a>`，点击拼 `vscode://file/` + `encodeURIComponent(absPath)` + (line ? ":" + line : "") 后 `window.open`；
- 事件走既有 `document.addEventListener("click")` 的 `#detail` 分支，新增 `data-loc` 处理；
- 原「复制」按钮与纯文本兜底保留。

### 连线详情
`e.location` 同样经 `parseLocation` 处理并渲染跳转链接（复用同一前端逻辑）。

## 6. 导出（Mermaid + PNG）

### `toMermaid(graph)`（src/render/mermaid.ts）
- 首行 `flowchart LR`；
- 7 个状态各一个 `classDef`，色值复用 `STATE_COLORS`；`deprecated` 用灰色系区分；
- 每个模块一个 `subgraph mod_<id>[<名称>]`，module 节点按 `target` 递归嵌套（与既有嵌套深度约束一致，validate 已限制深度）；
- Mermaid 节点 id 加模块前缀（`n<modID>_<nodeID>`）防跨模块冲突；id 中的非法字符替换为 `_`；
- 节点 label 用 `name`；边带 `text` 则 `-->|text|`；
- 输出末尾附 `class` 语句把节点归入对应状态 class。

### CLI：`agent-flow export`
- 读图 → `toMermaid` → 写 `.flow/flow.mmd` → 打印产物路径与「可粘贴进 README」提示；
- 支持 `--out <file>` 覆盖输出路径（默认 `.flow/flow.mmd`）。

### 查看器按钮（顶栏 rightbar）
- `renderHtml` 时调用 `toMermaid`，结果存 `DATA.mermaid`（前端直接用，**单一实现不重复造**；`<` 已被全局转义，不会破坏 script）；
- 「Mermaid」按钮：复制 `DATA.mermaid` 到剪贴板（复用既有 toast 提示）；
- 「PNG」按钮：克隆 `#cv` SVG → 去掉 `#selbox` 与 `selected/dragged` 痕迹 → 按当前 viewBox 设 width/height → `XMLSerializer` 序列化 → Blob → `Image` → 白底 canvas（先 fillRect `#f5f6f8`）→ `toBlob` 下载 `flow.png`。

## 7. 错误处理

- serve：`fs.watch` 已按目录监听规避单文件 watch 不稳定的问题；若 watch 本身抛错，捕获后打印警告并继续提供静态服务（用户可手动刷新，功能不劣化于现状）。
- `parseLocation`：任何一段解析失败都静默跳过，不影响整体渲染。
- PNG 导出在旧浏览器 `toBlob` 不可用时 toast 提示「请用现代浏览器」。
- export：图未初始化时 `store.load()` 既有行为自动建空图，导出结果只含主图空 subgraph，属正常。

## 8. 测试

`test/smoke.ts` 新增断言（沿用既有直调函数风格，不 spawn 进程）：
1. `toMermaid`：含 `flowchart LR`、每模块一个 `subgraph`、`classDef`、跨模块前缀无冲突、边 label 语法正确；
2. `parseLocation`：三种行号写法、多段 `;` 分隔、无路径段丢弃、相对路径拼接 root；
3. serve：`startServe` 支持注入随机端口（`--port 0` 语义 → 实际端口从 `server.address()` 回读），`fetch("/")` 断言 200、含 `var DATA=`、含注入的 `EventSource`；`fetch` 一个不存在的路径 404；随后关闭服务。

手工验收清单（发布前）：
- [ ] `agent-flow serve` 自动开浏览器；改 flow.json 后浏览器 1s 内自动刷新
- [ ] 点击节点「打开 ↗」在 IDE 中定位到文件与行
- [ ] 顶栏 PNG 下载白底图片、Mermaid 复制可粘贴进 README 渲染
- [ ] 双击 .flow/flow.html 直接打开（不经 serve）一切功能正常

## 9. 明确不做（YAGNI）

- 不做 GitHub 链接 / repoUrl 配置（用户已选只做本地 IDE）
- 不做 SVG 独立按钮（PNG 路径已覆盖，需要时复制 Mermaid 或后续加）
- 不做 serve 的鉴权、多项目、HTTPS
- 不做 Node 端 PNG/SVG 渲染（零依赖约束下不可行）
- 不动 MCP 工具集（14 个工具不变，`render_html` 产出自动获得跳转与导出能力）
