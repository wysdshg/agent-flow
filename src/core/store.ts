/**
 * 图数据存取：负责 .flow/flow.json 的读写、初始化、模块编号管理。
 * 所有写操作都通过 FlowStore，保证单一写入方。
 */
import fs from "node:fs";
import path from "node:path";
import { FlowError, FlowGraph, FlowModule, nowISO } from "./schema.js";

export class FlowStore {
  readonly root: string;
  readonly flowDir: string;
  readonly flowFile: string;
  readonly htmlFile: string;

  constructor(root?: string) {
    this.root = path.resolve(root ?? process.env.AGENT_FLOW_ROOT ?? process.cwd());
    this.flowDir = path.join(this.root, ".flow");
    this.flowFile = path.join(this.flowDir, "flow.json");
    this.htmlFile = path.join(this.flowDir, "flow.html");
  }

  /** 是否已初始化 */
  exists(): boolean {
    return fs.existsSync(this.flowFile);
  }

  /** 读取图数据；不存在时自动初始化一份只含主图（moduleID=0）的空图 */
  load(): FlowGraph {
    if (!fs.existsSync(this.flowFile)) {
      const g = newGraph(path.basename(this.root));
      this.save(g);
      return g;
    }
    const raw = fs.readFileSync(this.flowFile, "utf-8");
    const g = JSON.parse(raw) as FlowGraph;
    if (!g || typeof g !== "object" || !g.modules || !g.modules["0"]) {
      throw new FlowError("flow.json 结构不合法：缺少 modules 或主模块 0，请修复或删除 .flow/flow.json 后重新 init");
    }
    return g;
  }

  save(graph: FlowGraph): void {
    fs.mkdirSync(this.flowDir, { recursive: true });
    graph.updatedAt = nowISO();
    fs.writeFileSync(this.flowFile, JSON.stringify(graph, null, 2), "utf-8");
  }

  /** 写入渲染后的 HTML */
  saveHtml(html: string): void {
    fs.mkdirSync(this.flowDir, { recursive: true });
    fs.writeFileSync(this.htmlFile, html, "utf-8");
  }

  /** 取下一个可用的子模块编号（字符串） */
  nextModuleId(graph: FlowGraph): string {
    let max = 0;
    for (const key of Object.keys(graph.modules)) {
      const n = Number(key);
      if (Number.isInteger(n) && n > max) max = n;
    }
    return String(max + 1);
  }

  /** 取模块内下一个可用边 ID */
  nextEdgeId(graph: FlowGraph, moduleID: string): string {
    return nextEdgeId(graph, moduleID);
  }
}

/** 取模块内下一个可用边 ID（独立函数，graph-ops 直接使用） */
export function nextEdgeId(graph: FlowGraph, moduleID: string): string {
  const mod = graph.modules[moduleID];
  let max = 0;
  for (const key of Object.keys(mod.edges)) {
    const m = /^e(\d+)$/.exec(key);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `e${max + 1}`;
}

/** 新建一张只含主图的空图 */
export function newGraph(project: string): FlowGraph {
  return {
    version: 1,
    project,
    updatedAt: nowISO(),
    modules: {
      "0": {
        id: "0",
        name: "主流程图",
        description: "项目主图：只放模块级节点和数据库/LLM 等资源节点，细节放子模块画布",
        nodes: {},
        edges: {},
      },
    },
  };
}

/** 取模块，不存在则报错 */
export function requireModule(graph: FlowGraph, moduleID: number | string): FlowModule {
  const mod = graph.modules[String(moduleID)];
  if (!mod) {
    throw new FlowError(
      `模块 ${moduleID} 不存在。已有模块：${Object.keys(graph.modules).join(", ")}。请先用 create_sub_module 创建。`,
    );
  }
  return mod;
}
