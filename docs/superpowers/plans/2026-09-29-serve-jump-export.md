# serve 实时刷新 / 代码定位跳转 / 导出 Mermaid·PNG 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 agent-flow 新增 `serve`（实时刷新预览）、代码定位 IDE 跳转、`export`（Mermaid）与查看器 PNG/复制 Mermaid，全部零依赖（Node stdlib only）。

**Architecture:** serve 独立模块（node:http + fs.watch + SSE），在「save → render → saveHtml」链路末端挂「监听 → 重渲染 → 广播」，注入脚本只发生在 HTTP 响应内存，磁盘 flow.html 保持纯净；跳转解析在 Node 侧 `parseLocation` 纯函数完成（避开 VIEWER_JS 禁反斜杠/正则约束），前端只拼 `vscode://file/` 链接；Mermaid 由 `toMermaid(graph)` 纯函数单一实现，CLI export 与查看器共用。

**Tech Stack:** TypeScript（tsc）、node:http / node:fs / node:child_process、冒烟测试沿用 test/smoke.ts 直调风格。

**规格依据：** docs/superpowers/specs/2026-09-29-serve-jump-export-design.md（已批准，实现中不得偏离其决策与 YAGNI 清单）。

**环境注意：**
- 非交互 shell 需先 `source ~/.config/nvm/nvm.sh` 才有 node/npm。
- 测试命令：`npm test`（tsx test/smoke.ts）；构建：`npm run build`（tsc）。
- git 提交信息用中文 conventional 风格。
- 沙箱可能拦 `npm link`，本计划不需要 link，直接 `node dist/index.js <cmd>` 验证 CLI。

---

### Task 1: toMermaid 纯函数（src/render/mermaid.ts）

**Files:**
- Create: `src/render/mermaid.ts`
- Modify: `test/smoke.ts`（imports + 新测试段）

- [x] **Step 1: 写失败测试**

在 `test/smoke.ts` 顶部 import 区（`import { renderHtml } ...` 之后）加：

```ts
import { toMermaid } from "../src/render/mermaid.js";
```

在 `// ---------- validate ----------` 测试段之后、`// ---------- layout + render ----------` 之前插入：

```ts
// ---------- mermaid 导出 ----------
step("toMermaid 生成合法 flowchart（subgraph 嵌套/classDef/边 label/id 前缀）", () => {
  const gm = newGraph("导出测试");
  createSubModule(gm, { name: "登录模块" });
  addNode(gm, { moduleID: 0, nodeID: "S1", type: "start", name: "开始", description: "", state: "completed" });
  addNode(gm, { moduleID: 0, nodeID: "M1", type: "module", name: "登录", description: "", target: 1 });
  addNode(gm, { moduleID: 0, nodeID: "A-1", type: "process", name: "非法id", description: "" });
  addNode(gm, { moduleID: 1, nodeID: "P1", type: "process", name: "校验", description: "", state: "in_progress" });
  addNode(gm, { moduleID: 1, nodeID: "P2", type: "process", name: "通过", description: "" });
  addEdge(gm, { moduleID: 0, node1: "S1", node2: "M1", text: "进入" });
  addEdge(gm, { moduleID: 1, node1: "P1", node2: "P2", text: "通过" });
  const mmd = toMermaid(gm);
  assert.ok(mmd.startsWith("flowchart LR\n"));
  assert.ok(mmd.includes("subgraph mod_0["));
  assert.ok(mmd.includes("subgraph mod_1[登录模块]"));
  assert.ok(mmd.includes("classDef completed"));
  assert.ok(mmd.includes("n1_P1"));
  assert.ok(mmd.includes("n0_A_1")); // 节点 id 非法字符替换为 _
  assert.ok(mmd.includes("n0_S1 -->|进入| mod_1")); // 模块节点被 subgraph 取代，边指向 subgraph
  assert.ok(mmd.includes("n1_P1 -->|通过| n1_P2"));
  assert.ok(mmd.includes("class n0_S1 completed"));
  assert.ok(mmd.includes("class n1_P1 in_progress"));
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `source ~/.config/nvm/nvm.sh && npm test`
Expected: FAIL —— 找不到 `../src/render/mermaid.js` 模块。

- [x] **Step 3: 实现 src/render/mermaid.ts**

新建文件，完整内容：

```ts
/**
 * Mermaid 文本导出：把 FlowGraph 转成 flowchart LR 语法的纯函数。
 * CLI export 与查看器「复制 Mermaid」共用这一份实现（单一实现，不重复造）。
 */
import { FlowGraph, State, STATE_COLORS, STATES } from "../core/schema.js";

/** Mermaid id 只允许字母数字下划线，其余替换为 _（配合 n<模块ID>_ 前缀防跨模块冲突） */
function mmdId(id: string): string {
  return id.replace(/[^A-Za-z0-9_]/g, "_");
}

/** 去掉会破坏 Mermaid 语法的字符（方括号/竖线/引号/反引号/换行） */
function mmdLabel(s: string): string {
  return String(s ?? "").replace(/[\[\]>"`|\r\n]/g, " ").trim();
}

/** 深色背景配白字，浅色配深字 */
function darkText(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 150;
}

/** 7 个状态各一个 classDef，色值复用 STATE_COLORS；deprecated 用灰色系区分 */
function classDefLine(state: State): string {
  const fill = state === "deprecated" ? "#6b7280" : STATE_COLORS[state];
  return `classDef ${state} fill:${fill},color:${darkText(fill) ? "#1f2430" : "#ffffff"}`;
}

export function toMermaid(graph: FlowGraph): string {
  const lines: string[] = ["flowchart LR"];
  for (const s of STATES) lines.push(classDefLine(s));

  const rendered = new Set<string>(); // 已渲染为 subgraph 的模块 id（防环 + 防重复）
  const classRows: Record<string, string[]> = {}; // state -> 普通 Mermaid 节点 id 列表
  const subMap: Record<string, string> = {}; // "模块ID:节点ID" -> 该模块节点被替换成的 subgraph 引用

  const emitModule = (mid: string, indent: string): void => {
    const mod = graph.modules[mid];
    if (!mod || rendered.has(mid)) return;
    rendered.add(mid);
    lines.push(`${indent}subgraph mod_${mmdId(mid)}[${mmdLabel(mod.name)}]`);
    const inner = indent + "  ";
    // 先铺普通节点；module 节点记录映射，稍后嵌套 subgraph 取代它
    const moduleTargets: string[] = [];
    for (const n of Object.values(mod.nodes)) {
      if (n.type === "module" && n.target && graph.modules[n.target]) {
        subMap[`${mid}:${n.id}`] = `mod_${mmdId(n.target)}`;
        moduleTargets.push(n.target);
      } else {
        const nid = `n${mmdId(mid)}_${mmdId(n.id)}`;
        lines.push(`${inner}${nid}["${mmdLabel(n.name)}"]`);
        (classRows[n.state] = classRows[n.state] ?? []).push(nid);
      }
    }
    // 按 target 递归嵌套子模块（validate 已限制嵌套深度，rendered 防环）
    for (const t of moduleTargets) emitModule(t, inner);
    // 本模块的边；端点是模块节点时指向对应 subgraph
    for (const e of Object.values(mod.edges)) {
      const from = subMap[`${mid}:${e.from}`] ?? `n${mmdId(mid)}_${mmdId(e.from)}`;
      const to = subMap[`${mid}:${e.to}`] ?? `n${mmdId(mid)}_${mmdId(e.to)}`;
      lines.push(`${inner}${from} -->${e.text ? `|${mmdLabel(e.text)}|` : ""} ${to}`);
    }
    lines.push(`${indent}end`);
  };

  emitModule("0", "");
  // 不在主图链上的模块也各给一个 subgraph
  for (const mid of Object.keys(graph.modules)) emitModule(mid, "");

  for (const s of STATES) {
    const ids = classRows[s];
    if (ids?.length) lines.push(`class ${ids.join(",")} ${s}`);
  }
  return lines.join("\n") + "\n";
}
```

- [x] **Step 4: 跑测试确认通过**

Run: `source ~/.config/nvm/nvm.sh && npm test`
Expected: 全部通过（含新步骤）。

- [x] **Step 5: 提交**

```bash
git add src/render/mermaid.ts test/smoke.ts
git commit -m "feat(export): toMermaid 纯函数，FlowGraph 转 Mermaid 文本"
```

---

### Task 2: parseLocation + 跳转链接（src/render/html.ts 及调用点）

**Files:**
- Modify: `src/render/html.ts`（parseLocation / VNode·VEdge.locLinks / DATA.root·mermaid / renderHtml 第三参 / 详情面板 locRow / click 委托 data-loc）
- Modify: `src/index.ts:68`（render() 传 store.root）
- Modify: `src/mcp/server.ts:406`（renderHtml 传 store.root）
- Modify: `test/smoke.ts`（parseLocation 测试）

- [x] **Step 1: 写失败测试**

`test/smoke.ts` 顶部加 import（`import path from "node:path";` 已有；补 html 的 parseLocation）：

```ts
import { parseLocation, renderHtml } from "../src/render/html.js";
```

（把原有 `import { renderHtml } from "../src/render/html.js";` 替换掉。）在 mermaid 测试段之后插入：

```ts
// ---------- parseLocation（代码定位跳转） ----------
step("parseLocation 三种行号写法/多段/无路径段丢弃/相对拼 root/绝对路径不拼", () => {
  const root = "/tmp/proj";
  const r1 = parseLocation("src/a.ts:12", root);
  assert.equal(r1.length, 1);
  assert.equal(r1[0].path, path.join(root, "src/a.ts"));
  assert.equal(r1[0].line, 12);
  assert.equal(parseLocation("src/b.ts 8", root)[0].line, 8);
  assert.equal(parseLocation("README.md 20-50行", root)[0].line, 20);
  assert.ok(!("line" in parseLocation("src/c.ts", root)[0]));
  assert.deepEqual(parseLocation("没有路径的函数 loadStore()", root), []);
  const r2 = parseLocation("src/a.ts:1; README.md 20-50行", root);
  assert.equal(r2.length, 2);
  assert.equal(r2[1].line, 20);
  assert.equal(parseLocation("/abs/x.ts:3", root)[0].path, "/abs/x.ts");
  assert.equal(parseLocation("C:\\x\\y.ts:3", root)[0].path, "C:\\x\\y.ts");
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `source ~/.config/nvm/nvm.sh && npm test`
Expected: FAIL —— `parseLocation` 未导出。

- [x] **Step 3: 实现 html.ts 的 Node 侧改动**

3a. 文件头 import 区（`import { LayoutResult } ...` 附近）加：

```ts
import path from "node:path";
import { toMermaid } from "./mermaid.js";
```

3b. 在 `interface VNode {` 之前加：

```ts
/** 代码定位跳转链接（Node 侧预解析好，前端直接拼 vscode:// 链接） */
export interface LocLink {
  path: string;
  line?: number;
}

/**
 * 把 location 字符串解析成定位列表。支持三种行号写法：
 * "src/a.ts:12"、"src/a.ts 12"、"README.md 20-50行"（区间取起始行），
 * 分号分隔多段；提取不到带扩展名路径的段丢弃；相对路径拼 root 成绝对路径。
 * 放在 Node 侧做，避开 VIEWER_JS 禁用反斜杠/正则的约束。
 */
export function parseLocation(location: string, root: string): LocLink[] {
  const out: LocLink[] = [];
  for (const seg of location.split(";")) {
    const m = /((?:[A-Za-z]:)?[^\s:]*\.[A-Za-z0-9]+)(?::(\d+))?(?:\s+(\d+)(?:\s*-\s*\d+)?\s*行?)?/.exec(seg.trim());
    if (!m) continue;
    const p = m[1];
    const line = m[2] ? Number(m[2]) : m[3] ? Number(m[3]) : undefined;
    const isAbs = path.isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p);
    const link: LocLink = { path: isAbs ? p : path.join(root, p) };
    if (line !== undefined) link.line = line;
    out.push(link);
  }
  return out;
}
```

3c. `interface VNode` 加字段（`sql?: string;` 之后）：

```ts
  locLinks?: LocLink[];
```

`interface VEdge` 加字段（`state?: string;` 之后）：

```ts
  locLinks?: LocLink[];
```

3d. `buildViewData` 改签名与字段（完整替换该函数开头与节点/边的 locLinks 填充）：

```ts
function buildViewData(graph: FlowGraph, layout: LayoutResult, root: string) {
  return {
    project: graph.project,
    root,
    mermaid: toMermaid(graph),
    modules: Object.values(graph.modules).map((m) => {
```

节点映射里，`if (n.sql) v.sql = n.sql;` 之后加：

```ts
        if (n.location) {
          const locs = parseLocation(n.location, root);
          if (locs.length) v.locLinks = locs;
        }
```

边映射里，`if (e.state) v.state = e.state;` 之后加：

```ts
        if (e.location) {
          const locs = parseLocation(e.location, root);
          if (locs.length) v.locLinks = locs;
        }
```

3e. `renderHtml` 改签名并传 root：

```ts
export function renderHtml(graph: FlowGraph, layout: LayoutResult, root = ""): string {
```

函数体内 `const data = buildViewData(graph, layout);` 改为：

```ts
  const data = buildViewData(graph, layout, root);
```

3f. `src/index.ts:68`（render 函数内）改为：

```ts
  store.saveHtml(renderHtml(graph, layout, store.root));
```

3g. `src/mcp/server.ts:406` 改为：

```ts
        const html = renderHtml(graph, layout, store.root);
```

- [x] **Step 4: 实现前端改动（VIEWER_JS 内，禁反斜杠/反引号/${}）**

4a. `showDetail` 里「位置」行（原 `h+=row("位置",n.location?...)` 那行）替换为：

```js
h+=row("位置",n.location?locRow(n.location,n.locLinks):"<span style='color:#b6bdc9'>未填写</span>");
```

4b. `showEdgeDetail` 里 `if(e.location)h+=row("位置",...)` 替换为：

```js
if(e.location)h+=row("位置",locRow(e.location,e.locLinks));
```

4c. 在 `function row(k,v){...}` 之后加两个辅助函数：

```js
function fileName(p){var i=Math.max(p.lastIndexOf("/"),p.lastIndexOf(String.fromCharCode(92)));return i>=0?p.slice(i+1):p;}
function locRow(loc,links){var h='<span class="loc">'+esc(loc)+'</span><span class="copy" data-copy="'+esc(loc)+'">复制</span>';
if(links&&links.length){for(var i=0;i<links.length;i++){var l=links[i];h+=' <a class="copy" data-loc="'+esc(l.path)+'" data-line="'+(l.line||"")+'" title="在 IDE 中打开">'+esc(fileName(l.path))+(l.line?":"+l.line:"")+" ↗</a>";}}
return h;}
```

4d. `document.addEventListener("click",...)` 的 `#detail` 分支里，`var cpo=...` 块之后、`var cp=...` 之前插入：

```js
var lc=ev.target.closest("[data-loc]");
if(lc){var lp=lc.getAttribute("data-loc");var ll=lc.getAttribute("data-line");window.open("vscode://file/"+encodeURIComponent(lp)+(ll?":"+ll:""),"_blank");return;}
```

- [x] **Step 5: 跑测试与构建确认通过**

Run: `source ~/.config/nvm/nvm.sh && npm run build && npm test`
Expected: build 无错，测试全部通过。

- [x] **Step 6: 提交**

```bash
git add src/render/html.ts src/index.ts src/mcp/server.ts test/smoke.ts
git commit -m "feat(viewer): 代码定位 parseLocation，详情面板支持 IDE 跳转链接"
```

---

### Task 3: serve 模块（src/serve/serve.ts）

**Files:**
- Create: `src/serve/serve.ts`
- Modify: `test/smoke.ts`（serve 测试）

- [x] **Step 1: 写失败测试**

`test/smoke.ts` 顶部加 import：

```ts
import { startServe } from "../src/serve/serve.js";
```

把 `function step(name: string, fn: () => void): void` 改为支持异步：

```ts
async function step(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}
```

在 `store.saveHtml 落盘` 步骤之后、`fs.rmSync(tmp, ...)` 之前插入（顶层 await）：

```ts
// ---------- serve（真实 HTTP，随机端口） ----------
await step("startServe：随机端口/注入 EventSource/404/磁盘保持纯净", async () => {
  const stmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-flow-serve-"));
  const sstore = new FlowStore(stmp);
  sstore.load(); // 生成 flow.json，flow.html 由 startServe 内部首次渲染
  const { server, port, url } = await startServe(sstore, { port: 0, open: false });
  assert.ok(port > 0);
  const res = await fetch(url + "/");
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes("var DATA="));
  assert.ok(text.includes("EventSource"));
  assert.ok(text.includes('"root":"'));
  const disk = fs.readFileSync(sstore.htmlFile, "utf-8");
  assert.ok(disk.includes("var DATA="));
  assert.ok(!disk.includes("EventSource")); // 注入只发生在响应内存，磁盘文件保持纯净
  const nf = await fetch(url + "/nope");
  assert.equal(nf.status, 404);
  server.close();
  fs.rmSync(stmp, { recursive: true, force: true });
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `source ~/.config/nvm/nvm.sh && npm test`
Expected: FAIL —— 找不到 `../src/serve/serve.js` 模块。

- [x] **Step 3: 实现 src/serve/serve.ts**

新建文件，完整内容：

```ts
/**
 * agent-flow serve：本地实时预览。
 * - GET /        返回 flow.html，响应内存中注入 SSE 自动刷新脚本（磁盘文件保持纯净）
 * - GET /events  SSE 流，图变更后广播 reload，浏览器 location.reload()
 * - fs.watch(.flow 目录)，flow.json 变化 → 防抖 300ms → load→布局→渲染→落盘 → 广播
 * 零依赖：全部基于 node:http / node:fs / node:child_process。
 */
import fs from "node:fs";
import http from "node:http";
import { spawn } from "node:child_process";
import { FlowStore } from "../core/store.js";
import { layoutGraph } from "../layout/dagre.js";
import { renderHtml } from "../render/html.js";

export interface ServeOptions {
  /** 端口，默认 3457；0 表示随机可用端口（测试用） */
  port?: number;
  /** 启动后自动拉起浏览器，默认 true */
  open?: boolean;
}

const RELOAD_SCRIPT =
  '<script>(function(){var es=new EventSource("/events");es.onmessage=function(){location.reload();};})();</script>';

export async function startServe(
  store: FlowStore,
  opts: ServeOptions = {},
): Promise<{ server: http.Server; port: number; url: string }> {
  // 首次启动若还没渲染过，先出一份 flow.html
  if (!fs.existsSync(store.htmlFile)) {
    const graph = store.load();
    store.saveHtml(renderHtml(graph, layoutGraph(graph), store.root));
  }

  const clients = new Set<http.ServerResponse>();
  let debounceTimer: NodeJS.Timeout | null = null;

  const rerender = (): void => {
    try {
      const graph = store.load();
      store.saveHtml(renderHtml(graph, layoutGraph(graph), store.root));
    } catch (e) {
      console.error("重渲染失败：" + (e instanceof Error ? e.message : String(e)));
    }
    for (const res of clients) res.write("data: reload\n\n");
  };

  const server = http.createServer((req, res) => {
    const url = (req.url || "/").split("?")[0];
    if (url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(": connected\n\n");
      clients.add(res);
      const beat = setInterval(() => res.write(": ping\n\n"), 25000); // 心跳防代理断连
      req.on("close", () => {
        clearInterval(beat);
        clients.delete(res);
      });
      return;
    }
    if (url === "/" || url === "/index.html") {
      try {
        const html = fs.readFileSync(store.htmlFile, "utf-8");
        // 锚点 </body> 全文仅结尾一处（数据里的 < 已转义、VIEWER_JS 无该字样）
        const body = html.replace("</body>", RELOAD_SCRIPT + "</body>");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(body);
      } catch {
        res.writeHead(500);
        res.end("flow.html 读取失败，请运行 agent-flow render");
      }
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error("端口被占用，请换一个端口：agent-flow serve --port 3458");
      process.exit(1);
    }
    throw err;
  });

  const port = opts.port ?? 3457;
  await new Promise<void>((resolve) => server.listen(port, () => resolve()));

  // 监听目录而非单文件，规避部分平台单文件 watch 不触发的问题
  try {
    fs.watch(store.flowDir, (_event, filename) => {
      if (filename && filename !== "flow.json") return; // filename 为 null 的平台放行
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(rerender, 300);
    });
  } catch (e) {
    console.warn(
      "文件监听不可用（" + (e instanceof Error ? e.message : String(e)) + "），自动刷新失效，可手动刷新浏览器",
    );
  }

  const realPort = (server.address() as { port: number }).port;
  const url = "http://localhost:" + realPort + "/";
  console.log("agent-flow serve 已启动：" + url);
  console.log("agent 改图后浏览器会自动刷新（监听 " + store.flowDir + "）");
  console.log("Ctrl+C 退出");

  if (opts.open !== false) {
    try {
      const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
      const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
      const child = spawn(cmd, args, { stdio: "ignore", detached: true });
      child.on("error", () => console.warn("自动打开浏览器失败，请手动访问 " + url));
      child.unref();
    } catch {
      console.warn("自动打开浏览器失败，请手动访问 " + url);
    }
  }

  return { server, port: realPort, url };
}
```

- [x] **Step 4: 跑测试确认通过**

Run: `source ~/.config/nvm/nvm.sh && npm run build && npm test`
Expected: build 无错，测试全部通过（含 serve 步骤）。

- [x] **Step 5: 提交**

```bash
git add src/serve/serve.ts test/smoke.ts
git commit -m "feat(serve): agent-flow serve 实时预览（HTTP + watch + SSE 自动刷新）"
```

---

### Task 4: CLI serve / export 子命令（src/index.ts）

**Files:**
- Modify: `src/index.ts`（imports、HELP、serve/export 分支）

- [x] **Step 1: 实现**

1a. import 区加：

```ts
import path from "node:path";
import { toMermaid } from "./render/mermaid.js";
```

1b. 文件头注释「命令：」列表与 HELP 的命令表、示例更新。HELP 命令表中 `render` 行之后插入：

```
  serve [--port N] [--no-open]
                       本地实时预览：监听 .flow 目录，agent 改图后浏览器自动刷新（默认端口 3457 并自动开浏览器）
  export [--out FILE]  导出 Mermaid 文本（默认 .flow/flow.mmd，可粘贴进 README/GitHub）
```

示例区（`agent-flow render` 之后）插入：

```
  agent-flow serve
  agent-flow export --out docs/flow.mmd
```

1c. `main()` 里 `if (cmd === "render")` 分支之后插入：

```ts
  if (cmd === "serve") {
    let port = 3457;
    let open = true;
    for (let i = 1; i < argv.length; i++) {
      if (argv[i] === "--port") {
        port = Number(argv[++i]);
        if (!Number.isInteger(port) || port < 0) die("--port 需要一个非负整数，如 --port 3458");
      } else if (argv[i] === "--no-open") {
        open = false;
      } else {
        die(`未知参数 "${argv[i]}"，serve 只支持 --port N / --no-open`);
      }
    }
    const { startServe } = await import("./serve/serve.js");
    await startServe(store, { port, open });
    return;
  }

  if (cmd === "export") {
    let out = "";
    for (let i = 1; i < argv.length; i++) {
      if (argv[i] === "--out") {
        out = argv[++i] ?? "";
        if (!out) die("--out 需要一个文件路径，如 --out flow.mmd");
      } else {
        die(`未知参数 "${argv[i]}"，export 只支持 --out <file>`);
      }
    }
    const mmd = toMermaid(store.load());
    const outFile = out || path.join(store.flowDir, "flow.mmd");
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, mmd, "utf-8");
    console.log(`已导出 ${outFile}`);
    console.log("Mermaid 文本可直接粘贴进 README / GitHub / mermaid.live 渲染");
    return;
  }
```

- [x] **Step 2: 构建并手动验证**

Run: `source ~/.config/nvm/nvm.sh && npm run build && node dist/index.js export && head -5 .flow/flow.mmd && node dist/index.js serve --port 39451 --no-open & sleep 1 && curl -s http://localhost:39451/ | head -3; kill %1`

Expected: flow.mmd 首行为 `flowchart LR`；serve 启动日志打印；curl 返回 `<!DOCTYPE html>`。（serve 属常驻进程，验证后即杀。）

- [x] **Step 3: 提交**

```bash
git add src/index.ts
git commit -m "feat(cli): serve/export 子命令与 HELP 更新"
```

---

### Task 5: 查看器顶栏「复制 Mermaid / 下载 PNG」按钮（src/render/html.ts）

**Files:**
- Modify: `src/render/html.ts`（CSS、HTML_HEAD rightbar、VIEWER_JS 按钮逻辑）

- [x] **Step 1: 实现**

1a. CSS 里把：

```
#fitbtn{cursor:pointer;border:1px solid #e2e5ea;background:#fff;border-radius:10px;padding:7px 12px;font-size:12px;color:#4b5563}
#fitbtn:hover{background:#f2f4f7}
```

替换为：

```
#fitbtn,#resetbtn,#mmdbtn,#pngbtn{cursor:pointer;border:1px solid #e2e5ea;background:#fff;border-radius:10px;padding:7px 12px;font-size:12px;color:#4b5563}
#fitbtn:hover,#resetbtn:hover,#mmdbtn:hover,#pngbtn:hover{background:#f2f4f7}
```

1b. HTML_HEAD 的 rightbar（`<button id="resetbtn">重置布局</button>` 之后）加：

```
    <button id="mmdbtn">复制 Mermaid</button>
    <button id="pngbtn">下载 PNG</button>
```

1c. VIEWER_JS 里 `document.getElementById("resetbtn").addEventListener(...)` 之后加：

```js
document.getElementById("mmdbtn").addEventListener("click",function(){
var txt=DATA.mermaid||"";
if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(txt).then(function(){toast("Mermaid 已复制，可粘贴进 README");},function(){toast("复制失败，请手动选择");});}
else{toast("浏览器不支持一键复制");}});

document.getElementById("pngbtn").addEventListener("click",function(){
var src=document.getElementById("cv");
var clone=src.cloneNode(true);
var sb=clone.querySelector("#selbox");if(sb&&sb.parentNode)sb.parentNode.removeChild(sb);
var marks=clone.querySelectorAll(".dragged,.selected");for(var i=0;i<marks.length;i++){marks[i].classList.remove("dragged");marks[i].classList.remove("selected");}
var rect=src.getBoundingClientRect();
var w=Math.max(1,Math.round(vb.w)),h=Math.max(1,Math.round(vb.h));
clone.setAttribute("viewBox",vb.x+" "+vb.y+" "+vb.w+" "+vb.h);
clone.setAttribute("width",w);clone.setAttribute("height",h);
clone.setAttribute("font-family","system-ui,'Segoe UI','Microsoft YaHei',sans-serif");
var xml=new XMLSerializer().serializeToString(clone);
var img=new Image();
img.onload=function(){var c=document.createElement("canvas");c.width=w*2;c.height=h*2;var ctx=c.getContext("2d");if(!ctx){toast("PNG 导出失败");return;}
ctx.fillStyle="#f5f6f8";ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);
if(c.toBlob){c.toBlob(function(b){if(!b){toast("PNG 导出失败");return;}var a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="flow.png";a.click();setTimeout(function(){URL.revokeObjectURL(a.href);},2000);toast("PNG 已下载");},"image/png");}
else{toast("当前浏览器不支持 PNG 导出，请用现代浏览器");}};
img.onerror=function(){toast("PNG 导出失败");};
img.src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(xml);});
```

（注意：VIEWER_JS 内禁止反斜杠/反引号/${}，上述代码已遵守。`var sc` 未再使用，直接以 viewBox 尺寸定导出分辨率，2 倍绘制保证清晰度。）

- [x] **Step 2: 构建并重新渲染本项目流程图（dogfood）**

Run: `source ~/.config/nvm/nvm.sh && npm run build && node dist/index.js render`

Expected: `.flow/flow.html` 更新，`grep -c "mmdbtn" .flow/flow.html` 为 1，`grep -c "mermaid" .flow/flow.html` 大于 0。

- [x] **Step 3: 提交**

```bash
git add src/render/html.ts .flow/flow.html
git commit -m "feat(viewer): 顶栏复制 Mermaid / 下载 PNG 按钮"
```

---

### Task 6: 文档与 skill 同步

**Files:**
- Modify: `README.md:117-124`（CLI Reference）
- Modify: `README.zh-CN.md:91-98`（CLI 降级通道）
- Modify: `skill/SKILL.md`（CLI 命令列表/速查表）
- Modify: `~/.trae-cn/skills/agent-flow/SKILL.md`（与仓库版逐字节一致）

- [x] **Step 1: README.md 的 CLI Reference 代码块（`agent-flow render` 行后）加：**

```
agent-flow serve                # live preview: auto-reload browser when flow.json changes
agent-flow export               # export Mermaid text (.flow/flow.mmd) for README/GitHub
```

- [x] **Step 2: README.zh-CN.md 的 CLI 代码块（`agent-flow render` 行后）加：**

```
agent-flow serve                # 本地实时预览：agent 改图后浏览器自动刷新（默认端口 3457）
agent-flow export               # 导出 Mermaid 文本（默认 .flow/flow.mmd，可粘贴进 README）
```

- [x] **Step 3: skill/SKILL.md 按 CLI 命令列表实际情况补 serve/export 两行**（先读文件定位列表，保持中文风格一致），然后用 Write 工具把仓库版全文覆盖到 `~/.trae-cn/skills/agent-flow/SKILL.md`（沙箱拦 shell 写入该目录，必须用 Write 工具），最后 `diff` 校验两处逐字节一致。

- [x] **Step 4: 全量验证 + 提交**

Run: `source ~/.config/nvm/nvm.sh && npm run build && npm test && git status --short`
Expected: build 无错、测试全过。

```bash
git add README.md README.zh-CN.md skill/SKILL.md
git commit -m "docs: README 与 skill 补 serve/export 命令"
```

---

### 验收（对照规格 §8 手工清单，交还用户前自查）

- [x] `npm run build && npm test` 全绿
- [x] `node dist/index.js export` 产物 `.flow/flow.mmd` 首行 `flowchart LR`
- [x] serve 验证见 Task 4 Step 2（注入 EventSource、404、磁盘纯净）
- [ ] 浏览器侧（PNG/复制 Mermaid/跳转链接/自动刷新）留给用户手工验收
