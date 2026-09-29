/**
 * 图校验：ID 重复、悬空连线、非法 state/type、子模块引用、database 绑定、嵌套深度。
 */
import fs from "node:fs";
import path from "node:path";
import { FlowGraph, NODE_TYPES, STATES } from "./schema.js";

export interface ValidateResult {
  ok: boolean;
  issueCount: number;
  issues: string[];
}

/** 软提醒（不算校验错误）：节点挂了 doc 但文档文件不存在，提示 AI/用户补文档 */
export function missingDocs(
  graph: FlowGraph,
  root: string,
): { moduleID: string; nodeID: string; name: string; doc: string }[] {
  const out: { moduleID: string; nodeID: string; name: string; doc: string }[] = [];
  for (const [mid, mod] of Object.entries(graph.modules)) {
    for (const n of Object.values(mod.nodes)) {
      if (n.doc && !fs.existsSync(path.resolve(root, n.doc))) {
        out.push({ moduleID: mid, nodeID: n.id, name: n.name, doc: n.doc });
      }
    }
  }
  return out;
}

export interface DocIssue {
  moduleID: string;
  nodeID: string;
  name: string;
  doc: string;
  problem: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 文档头校验（软提醒）。文档头是 md 里紧跟标题的一行引用块：
 *   > 状态: completed | 建立: 2026-09-29 | 更新: 2026-09-30 | 上次验证: 2026-09-30（npm test 19/19）
 * 抓四类腐烂：缺头/字段缺、状态与图不一致、更新日期早于图变更、completed 缺验证记录或验证过期（>90 天）。
 * 一篇 md 可被多个节点共享：状态与其中任一节点一致即算匹配。
 */
export function docIssues(graph: FlowGraph, root: string): DocIssue[] {
  const byDoc = new Map<
    string,
    { moduleID: string; nodeID: string; name: string; state: string; updatedAt: string }[]
  >();
  for (const [mid, mod] of Object.entries(graph.modules)) {
    for (const n of Object.values(mod.nodes)) {
      if (!n.doc) continue;
      if (!byDoc.has(n.doc)) byDoc.set(n.doc, []);
      byDoc.get(n.doc)!.push({ moduleID: mid, nodeID: n.id, name: n.name, state: n.state, updatedAt: n.updatedAt });
    }
  }

  const out: DocIssue[] = [];
  for (const [doc, refs] of byDoc) {
    const abs = path.resolve(root, doc);
    if (!fs.existsSync(abs)) continue; // 文件不存在归 missingDocs 管
    const report = (problem: string): void => {
      out.push({ moduleID: refs[0].moduleID, nodeID: refs[0].nodeID, name: refs[0].name, doc, problem });
    };

    const head = fs
      .readFileSync(abs, "utf-8")
      .split("\n")
      .find((l) => l.startsWith("> 状态:"));
    if (!head) {
      report("缺文档头（紧跟标题加一行：> 状态: <7态> | 建立: YYYY-MM-DD | 更新: YYYY-MM-DD | 上次验证: YYYY-MM-DD（证据））");
      continue;
    }
    const st = head.match(/状态:\s*([a-z_]+)/)?.[1];
    const created = head.match(/建立:\s*(\d{4}-\d{2}-\d{2})/)?.[1];
    const updated = head.match(/更新:\s*(\d{4}-\d{2}-\d{2})/)?.[1];
    const verified = head.match(/上次验证:\s*(\d{4}-\d{2}-\d{2})/)?.[1];

    if (!st || !(STATES as readonly string[]).includes(st)) {
      report(`文档头状态 "${st ?? "缺失"}" 非法，只能是 ${STATES.join("/")}`);
      continue;
    }
    if (!created || !updated) {
      report("文档头缺建立/更新日期");
      continue;
    }
    if (!refs.some((r) => r.state === st)) {
      const nodeStates = [...new Set(refs.map((r) => r.state))].join("/");
      report(`文档状态 ${st} 与图节点状态（${nodeStates}）不一致，重跑验证后按实况改`);
    }
    const latestOf = refs.map((r) => r.updatedAt.slice(0, 10)).sort().slice(-1)[0] ?? "";
    if (latestOf && updated < latestOf) {
      report(`文档更新时间（${updated}）早于图最近变更（${latestOf}），图改了文档没跟上`);
    }
    if (st === "completed") {
      if (!verified) {
        report("状态 completed 但缺上次验证记录（格式：上次验证: YYYY-MM-DD（测试命令/用户确认等证据））");
      } else if (Date.now() - Date.parse(verified) > 90 * DAY_MS) {
        report(`上次验证是 ${verified}（超过 90 天），久未验证的功能状态存疑，建议重验后再信`);
      }
    }
  }
  return out;
}

export function validateGraph(graph: FlowGraph, moduleID?: number | string): ValidateResult {
  const issues: string[] = [];
  const scope = moduleID !== undefined ? [String(moduleID)] : Object.keys(graph.modules);

  for (const mid of scope) {
    const mod = graph.modules[mid];
    if (!mod) {
      issues.push(`模块 ${mid} 不存在`);
      continue;
    }
    const tag = `模块${mid}(${mod.name})`;

    for (const n of Object.values(mod.nodes)) {
      if (!(STATES as readonly string[]).includes(n.state)) {
        issues.push(`${tag} 节点 ${n.id}: 非法状态 "${n.state}"，只能是 ${STATES.join("/")}`);
      }
      if (!(NODE_TYPES as readonly string[]).includes(n.type)) {
        issues.push(`${tag} 节点 ${n.id}: 非法类型 "${n.type}"`);
      }
      if (n.type === "module" && n.target && !graph.modules[n.target]) {
        issues.push(`${tag} 节点 ${n.id}: 引用的子模块 ${n.target} 不存在`);
      }
      if ((n.type === "table" || n.type === "sql") && n.dbNodeId && !mod.nodes[n.dbNodeId]) {
        issues.push(`${tag} 节点 ${n.id}: 绑定的数据库节点 ${n.dbNodeId} 不存在`);
      }
    }

    for (const e of Object.values(mod.edges)) {
      if (!mod.nodes[e.from]) issues.push(`${tag} 连线 ${e.id}: 起点节点 ${e.from} 不存在（悬空连线）`);
      if (!mod.nodes[e.to]) issues.push(`${tag} 连线 ${e.id}: 终点节点 ${e.to} 不存在（悬空连线）`);
      if (e.state && !(STATES as readonly string[]).includes(e.state)) {
        issues.push(`${tag} 连线 ${e.id}: 非法状态 "${e.state}"`);
      }
    }
  }

  // 子模块嵌套深度检查（>3 层提示），顺带检测环
  const depthCache = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (mid: string): number => {
    if (depthCache.has(mid)) return depthCache.get(mid)!;
    if (visiting.has(mid)) {
      issues.push(`模块嵌套出现环：${[...visiting].join(" -> ")} -> ${mid}`);
      return 0;
    }
    visiting.add(mid);
    const mod = graph.modules[mid];
    let childMax = 0;
    for (const n of Object.values(mod?.nodes ?? {})) {
      if (n.type === "module" && n.target && graph.modules[n.target]) {
        childMax = Math.max(childMax, depthOf(n.target) + 1);
      }
    }
    visiting.delete(mid);
    depthCache.set(mid, childMax);
    if (childMax > 3) issues.push(`模块 ${mid}(${mod?.name}) 下方嵌套达 ${childMax} 层，超过建议的 3 层，考虑合并或拆分`);
    return childMax;
  };
  depthOf("0");

  return { ok: issues.length === 0, issueCount: issues.length, issues };
}
