/**
 * 数据模型与常量定义：节点类型、状态体系、图结构 schema。
 * graph 的唯一数据源是 <项目根>/.flow/flow.json。
 */
import { z } from "zod";

// ---------- 状态体系（7 种，固定配色，不可自定义） ----------
export const STATES = [
  "completed",
  "in_progress",
  "planned",
  "broken",
  "to_plan",
  "pending_decision",
  "deprecated",
] as const;
export type State = (typeof STATES)[number];

export const STATE_COLORS: Record<State, string> = {
  completed: "#2ea44f",
  in_progress: "#61aeee",
  planned: "#0366d6",
  broken: "#d73a4a",
  to_plan: "#959da5",
  pending_decision: "#ffd33d",
  deprecated: "#92400e",
};

export const STATE_LABELS: Record<State, string> = {
  completed: "已完成",
  in_progress: "进行中",
  planned: "已规划",
  broken: "存在Bug",
  to_plan: "待规划",
  pending_decision: "待决策",
  deprecated: "已废弃",
};

// ---------- 节点类型（22 种，6 类形状） ----------
export const NODE_TYPES = [
  // 流程（5）
  "start",
  "end",
  "process",
  "judge",
  "module",
  // 数据资源（4）
  "database",
  "table",
  "file",
  "sql",
  // AI 应用（13）
  "llm",
  "tool_call",
  "retrieval",
  "rerank",
  "assemble",
  "api",
  "embedding",
  "cache",
  "queue",
  "prompt",
  "agent",
  "human_loop",
  "checkpoint",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

/** 支持多输入/多输出端口的节点类型 */
export const PORTED_TYPES: readonly NodeType[] = ["module", "llm", "tool_call", "agent", "assemble"];

// ---------- 图结构 ----------
export interface TableField {
  name: string;
  type?: string;
  desc?: string;
}

export interface FlowNode {
  id: string;
  type: NodeType;
  name: string;
  description: string;
  /** 代码/文档定位，多文件用分号分隔，如 "src/render/html.ts; README.md 20-50行" */
  location: string;
  state: State;
  /** 输入端口名列表（左侧） */
  inputs?: string[];
  /** 输出端口名列表（右侧） */
  outputs?: string[];
  /** module 节点双击跳转的目标 moduleID */
  target?: string;
  /** table / sql 节点绑定的 database 节点 id */
  dbNodeId?: string;
  /** table 节点的字段列表 */
  fields?: TableField[];
  /** sql 节点的 SQL 内容 */
  sql?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  /** 连线上的短文字 */
  text?: string;
  description?: string;
  location?: string;
  state?: State;
  createdAt: string;
}

export interface FlowModule {
  id: string;
  name: string;
  description: string;
  nodes: Record<string, FlowNode>;
  edges: Record<string, FlowEdge>;
}

export interface FlowGraph {
  version: number;
  project: string;
  updatedAt: string;
  modules: Record<string, FlowModule>;
}

// ---------- zod schema（MCP 工具入参校验用） ----------
const stateSchema = z.enum(STATES);
const nodeTypeSchema = z.enum(NODE_TYPES);

export const addNodeSchema = {
  moduleID: z.number().int().min(0).describe("画布/模块编号，0=主流程图"),
  nodeID: z.string().min(1).describe("节点唯一 ID，建议前缀：M=模块 P=流程 D=判断 DB=数据库 L=LLM T=工具"),
  type: nodeTypeSchema.describe(
    "节点类型：start/end/process/judge/module 流程类；database/table/file/sql 数据类；llm/tool_call/retrieval/rerank/assemble/api/embedding/cache/queue/prompt/agent/human_loop/checkpoint AI应用类",
  ),
  name: z.string().min(1).describe("节点名称，简短"),
  description: z
    .string()
    .describe("功能描述，必须用中文大白话说明这个节点是干嘛的、给谁用，禁止堆砌未解释的术语"),
  location: z
    .string()
    .describe(
      '代码/文档定位，如 "src/core/store.ts loadStore()" 或 "README.md 20-50行"，多文件用分号分隔；还没实现可填 ""',
    )
    .optional(),
  state: stateSchema.describe("节点状态").optional(),
  inputs: z.array(z.string()).describe("输入端口名列表（仅 module/llm/tool_call/agent/assemble）").optional(),
  outputs: z.array(z.string()).describe("输出端口名列表（仅 module/llm/tool_call/agent/assemble）").optional(),
  target: z
    .string()
    .describe("type=module 时，双击跳转的目标 moduleID（用 CreateSubModule 返回的编号）")
    .optional(),
};

export const tableFieldSchema = z.object({
  name: z.string().describe("字段名"),
  type: z.string().optional().describe("字段类型，如 bigint/varchar(64)/text"),
  desc: z.string().optional().describe("字段说明，大白话"),
});

// ---------- 错误类型：友好中文报错，MCP 层直接返回给 AI ----------
export class FlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlowError";
  }
}

export function nowISO(): string {
  return new Date().toISOString();
}
