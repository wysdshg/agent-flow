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
