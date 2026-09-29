#!/usr/bin/env node
/**
 * CLI 入口。正常使用走 MCP（agent-flow mcp），CLI 是降级通道：
 * 让用户/CI 在没有 MCP 环境时也能建图、渲染、查看状态。
 *
 * 命令：
 *   init                 初始化 .flow/ 并打印 MCP 配置片段
 *   batch <spec.json>    从 JSON spec 一次性建图（冷启动），完成后自动渲染
 *   apply <ops.json>     依次执行 [{tool,args}] 写操作，完成后自动渲染
 *   render               重新布局并生成 .flow/flow.html
 *   serve                本地实时预览（HTTP + SSE 自动刷新）
 *   export               导出 Mermaid 文本
 *   status               项目进度总览
 *   validate             校验流程图
 *   mcp                  启动 MCP stdio 服务
 */
import fs from "node:fs";
import path from "node:path";
import { FlowStore } from "./core/store.js";
import { FlowError } from "./core/schema.js";
import {
  addEdge,
  addNode,
  addSQL,
  addTable,
  batchImport,
  createSubModule,
  deleteEdge,
  deleteNode,
  getProjectStatus,
  updateEdge,
  updateNode,
} from "./core/graph-ops.js";
import { missingDocs, validateGraph } from "./core/validate.js";
import { layoutGraph } from "./layout/dagre.js";
import { renderHtml } from "./render/html.js";
import { toMermaid } from "./render/mermaid.js";

const HELP = `agent-flow — 用流程图整理项目进度，给 AI agent 用的 MCP 插件

用法：agent-flow <命令> [参数]

命令：
  init                 初始化 .flow/flow.json，并打印 MCP 配置片段
  batch <spec.json>    从 JSON spec 一次性建图（适合旧项目冷启动），完成后自动渲染
  apply <ops.json>     依次执行写操作 [{tool,args},...]，tool 见下方列表，完成后自动渲染
  render               重新自动布局并生成 .flow/flow.html（浏览器直接打开）
  serve [--port N] [--no-open]
                       本地实时预览：监听 .flow 目录，agent 改图后浏览器自动刷新（默认端口 3457 并自动开浏览器）
  export [--out FILE]  导出 Mermaid 文本（默认 .flow/flow.mmd，可粘贴进 README/GitHub）
  status               项目进度总览（各模块七态统计 + broken/待决策清单）
  validate             校验流程图（悬空连线/非法状态/子模块引用/嵌套深度/环）
  mcp                  启动 MCP stdio 服务（一般由 MCP 客户端调用，不手动跑）

apply 可用的 tool：
  create_sub_module / add_node / update_node / delete_node /
  n2n / update_edge / delete_edge / add_table / add_sql / batch_import

示例：
  agent-flow init
  agent-flow batch flow-spec.json
  agent-flow render
  agent-flow serve
  agent-flow export --out docs/flow.mmd
  agent-flow status

环境变量：AGENT_FLOW_ROOT 可指定项目根目录（默认当前目录）`;

function die(msg: string): never {
  console.error("错误：" + msg);
  process.exit(1);
}

/** 布局 + 渲染 HTML */
function render(store: FlowStore, graph: ReturnType<FlowStore["load"]>): void {
  const layout = layoutGraph(graph);
  store.saveHtml(renderHtml(graph, layout, store.root));
}

/** apply 命令支持的工具 → graph-ops 函数映射（都是写操作） */
const toolMap: Record<string, (graph: ReturnType<FlowStore["load"]>, args: any) => unknown> = {
  create_sub_module: (g, a) => createSubModule(g, a),
  add_node: (g, a) => addNode(g, a),
  update_node: (g, a) => updateNode(g, a),
  delete_node: (g, a) => deleteNode(g, a),
  n2n: (g, a) => addEdge(g, a),
  update_edge: (g, a) => updateEdge(g, a),
  delete_edge: (g, a) => deleteEdge(g, a),
  add_table: (g, a) => addTable(g, a),
  add_sql: (g, a) => addSQL(g, a),
  batch_import: (g, a) => batchImport(g, a),
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    console.log(HELP);
    return;
  }

  const store = new FlowStore();

  if (cmd === "init") {
    const graph = store.load(); // 不存在会自动创建
    render(store, graph);
    console.log(`已初始化 ${store.flowFile}`);
    console.log(`已生成 ${store.htmlFile}`);
    console.log("");
    console.log("把下面片段加进你的 MCP 客户端配置（如 Trae / Claude Desktop / Cursor）：");
    console.log(
      JSON.stringify({ mcpServers: { "agent-flow": { command: "npx", args: ["-y", "agent-flow", "mcp"] } } }, null, 2),
    );
    return;
  }

  if (cmd === "batch") {
    const file = argv[1];
    if (!file) die("用法：agent-flow batch <spec.json>，spec 格式见 README.md");
    const spec = JSON.parse(fs.readFileSync(file, "utf-8"));
    const graph = store.load();
    const res = batchImport(graph, spec);
    store.save(graph);
    render(store, graph);
    console.log(
      `建图完成：新建模块 ${res.modulesCreated.length} 个 [${res.modulesCreated.join(", ")}]，节点 ${res.nodesAdded} 个，连线 ${res.edgesAdded} 条`,
    );
    console.log(`已生成 ${store.htmlFile}`);
    return;
  }

  if (cmd === "apply") {
    const file = argv[1];
    if (!file) die("用法：agent-flow apply <ops.json>，文件内容为 [{\"tool\":\"add_node\",\"args\":{...}},...]");
    const ops = JSON.parse(fs.readFileSync(file, "utf-8")) as { tool: string; args: unknown }[];
    if (!Array.isArray(ops)) die("ops.json 必须是数组：[{tool, args},...]");
    const graph = store.load();
    for (let i = 0; i < ops.length; i++) {
      const { tool, args } = ops[i] ?? {};
      const fn = toolMap[tool ?? ""];
      if (!fn) die(`第 ${i + 1} 个操作的 tool "${tool}" 不认识。可用：${Object.keys(toolMap).join(", ")}`);
      fn(graph, args);
      console.log(`[${i + 1}/${ops.length}] ${tool} ✓`);
    }
    store.save(graph);
    render(store, graph);
    console.log(`已保存并渲染 ${store.htmlFile}`);
    return;
  }

  if (cmd === "render") {
    const graph = store.load();
    render(store, graph);
    console.log(`已生成 ${store.htmlFile}`);
    return;
  }

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

  if (cmd === "status") {
    console.log(JSON.stringify(getProjectStatus(store.load()), null, 2));
    return;
  }

  if (cmd === "validate") {
    const graph = store.load();
    const res = validateGraph(graph);
    console.log(JSON.stringify(res, null, 2));
    const miss = missingDocs(graph, store.root);
    if (miss.length) {
      console.error(`\n提醒：${miss.length} 个节点的功能文档文件不存在（不影响校验结果）：`);
      for (const m of miss) console.error(`  [模块 ${m.moduleID}] ${m.nodeID}（${m.name}）→ ${m.doc}`);
      console.error("在 .flow/docs/ 补齐对应 md 后，详情面板的文档链接才能打开。");
    }
    if (!res.ok) process.exitCode = 1;
    return;
  }

  if (cmd === "mcp") {
    const { startMcp } = await import("./mcp/server.js");
    await startMcp();
    return;
  }

  die(`未知命令 "${cmd}"。\n\n` + HELP);
}

main().catch((e: unknown) => {
  die(e instanceof FlowError || e instanceof Error ? e.message : String(e));
});
