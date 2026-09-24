/**
 * 图校验：ID 重复、悬空连线、非法 state/type、子模块引用、database 绑定、嵌套深度。
 */
import { FlowGraph, NODE_TYPES, STATES } from "./schema.js";

export interface ValidateResult {
  ok: boolean;
  issueCount: number;
  issues: string[];
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
