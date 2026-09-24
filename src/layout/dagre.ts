/**
 * 自动布局：AI 只提供拓扑（节点+连线），坐标由 dagre 统一计算，保证图不会乱。
 * 每个模块独立布局，输出节点中心坐标与宽高。
 */
import dagre from "dagre";
import { FlowGraph, FlowNode, PORTED_TYPES } from "../core/schema.js";

export interface NodeBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ModuleLayout {
  width: number;
  height: number;
  nodes: Record<string, NodeBox>;
}

export interface LayoutResult {
  modules: Record<string, ModuleLayout>;
}

/** 中英混排的视觉长度：中文按 1.7 个字符宽估算 */
function visualLen(s: string | undefined): number {
  if (!s) return 0;
  let len = 0;
  for (const ch of s) len += ch.codePointAt(0)! > 0x2e80 ? 1.7 : 1;
  return len;
}

/** 估算节点尺寸：宽度适配名称与端口文字，高度适配字段/端口数量 */
export function estimateSize(node: FlowNode): { w: number; h: number } {
  let w = Math.max(116, Math.min(300, visualLen(node.name) * 13 + 34));
  let h = 52;

  if (node.type === "start" || node.type === "end") {
    h = 44;
    w = Math.max(100, w);
  } else if (node.type === "judge") {
    w = Math.max(w + 40, 150);
    h = 84;
  } else if (node.type === "database") {
    h = 58;
  } else if (node.type === "table") {
    const fields = (node.fields ?? []).slice(0, 6);
    h = 30 + fields.length * 17 + 10;
    w = Math.max(w, 190);
  } else if (node.type === "sql") {
    h = 60;
    w = Math.max(w, 170);
  }

  if (PORTED_TYPES.includes(node.type)) {
    const ports = Math.max(node.inputs?.length ?? 0, node.outputs?.length ?? 0, 1);
    const portTextW = Math.max(
      visualLen(longest(node.inputs)),
      visualLen(longest(node.outputs)),
    ) * 11 + 48;
    w = Math.max(w, portTextW, 170);
    h = 38 + ports * 18 + 10;
  }
  return { w: Math.round(w), h: Math.round(h) };
}

function longest(arr?: string[]): string {
  if (!arr?.length) return "";
  return arr.reduce((a, b) => (b.length > a.length ? b : a), "");
}

/** 对整张图做布局（每个模块独立）。table/sql 节点会自动对齐到所属 database 下方。 */
export function layoutGraph(graph: FlowGraph): LayoutResult {
  const result: LayoutResult = { modules: {} };

  for (const [mid, mod] of Object.entries(graph.modules)) {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "LR", nodesep: 48, ranksep: 84, marginx: 44, marginy: 44 });
    g.setDefaultEdgeLabel(() => ({}));

    const sizes: Record<string, { w: number; h: number }> = {};
    for (const node of Object.values(mod.nodes)) {
      const s = estimateSize(node);
      sizes[node.id] = s;
      g.setNode(node.id, { width: s.w, height: s.h });
    }

    for (const e of Object.values(mod.edges)) {
      if (mod.nodes[e.from] && mod.nodes[e.to]) g.setEdge(e.from, e.to);
    }
    // table/sql 挂到 database 下面一起布局（仅影响排版，不写入数据）
    for (const node of Object.values(mod.nodes)) {
      if ((node.type === "table" || node.type === "sql") && node.dbNodeId && mod.nodes[node.dbNodeId]) {
        g.setEdge(node.dbNodeId, node.id, { weight: 2 });
      }
    }

    dagre.layout(g);

    const nodes: Record<string, NodeBox> = {};
    let maxX = 0;
    let maxY = 0;
    for (const [id, s] of Object.entries(sizes)) {
      const pos = g.node(id);
      const box: NodeBox = {
        x: Math.round(pos?.x ?? 0),
        y: Math.round(pos?.y ?? 0),
        w: s.w,
        h: s.h,
      };
      nodes[id] = box;
      maxX = Math.max(maxX, box.x + s.w / 2);
      maxY = Math.max(maxY, box.y + s.h / 2);
    }
    result.modules[mid] = { width: Math.round(maxX + 44), height: Math.round(maxY + 44), nodes };
  }
  return result;
}
