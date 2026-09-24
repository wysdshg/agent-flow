/**
 * 14 个图操作工具的纯函数实现：不碰文件系统，输入 FlowGraph 返回新状态或结果对象。
 * MCP 层和 CLI 层都调用这里，保证行为一致。
 */
import {
  FlowError,
  FlowGraph,
  FlowNode,
  FlowEdge,
  NODE_TYPES,
  NodeType,
  PORTED_TYPES,
  STATES,
  State,
  TableField,
  nowISO,
} from "./schema.js";
import { nextEdgeId, requireModule } from "./store.js";

function assertType(type: string): asserts type is NodeType {
  if (!(NODE_TYPES as readonly string[]).includes(type)) {
    throw new FlowError(`未知的节点类型 "${type}"。可用类型：${NODE_TYPES.join(", ")}`);
  }
}

function assertState(state: string): asserts state is State {
  if (!(STATES as readonly string[]).includes(state)) {
    throw new FlowError(
      `未知的状态 "${state}"。可用状态：${STATES.join(", ")}（completed/in_progress/planned/broken/to_plan/pending_decision/deprecated）`,
    );
  }
}

// ---------- 1. CreateSubModule ----------
export function createSubModule(
  graph: FlowGraph,
  args: { moduleID?: number | string; name: string; description?: string },
): { moduleID: string } {
  void args.moduleID; // 预留：记录父模块关系用，P0 扁平存储
  const ids = Object.keys(graph.modules).map(Number);
  const newId = String(Math.max(0, ...ids) + 1);
  graph.modules[newId] = {
    id: newId,
    name: args.name,
    description: args.description ?? "",
    nodes: {},
    edges: {},
  };
  return {
    moduleID: newId,
  };
}

// ---------- 2. AddNode ----------
export interface AddNodeArgs {
  moduleID: number | string;
  nodeID: string;
  type: string;
  name: string;
  description?: string;
  location?: string;
  state?: string;
  inputs?: string[];
  outputs?: string[];
  target?: string | number;
}

export function addNode(graph: FlowGraph, args: AddNodeArgs): FlowNode {
  assertType(args.type);
  const state = (args.state ?? "to_plan") as State;
  assertState(state);
  const mod = requireModule(graph, args.moduleID);
  if (mod.nodes[args.nodeID]) {
    throw new FlowError(
      `节点 "${args.nodeID}" 在模块 ${args.moduleID} 已存在，换个 ID 或用 update_node 修改它。`,
    );
  }
  const node: FlowNode = {
    id: args.nodeID,
    type: args.type as NodeType,
    name: args.name,
    description: args.description ?? "",
    location: args.location ?? "",
    state,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  if (args.inputs?.length) node.inputs = args.inputs;
  if (args.outputs?.length) node.outputs = args.outputs;
  if (args.target !== undefined && args.target !== null && String(args.target) !== "") {
    node.target = String(args.target);
  }
  mod.nodes[args.nodeID] = node;
  return node;
}

// ---------- 3. UpdateNode ----------
export interface UpdateNodeArgs {
  moduleID: number | string;
  nodeID: string;
  patch: {
    name?: string;
    description?: string;
    location?: string;
    state?: string;
    inputs?: string[];
    outputs?: string[];
    target?: string | number;
  };
}

export function updateNode(graph: FlowGraph, args: UpdateNodeArgs): FlowNode {
  const mod = requireModule(graph, args.moduleID);
  const node = mod.nodes[args.nodeID];
  if (!node) {
    throw new FlowError(`节点 "${args.nodeID}" 在模块 ${args.moduleID} 不存在。现有节点：${Object.keys(mod.nodes).join(", ") || "（无）"}`);
  }
  const p = args.patch ?? {};
  if (p.state !== undefined) assertState(p.state);
  if (p.name !== undefined) node.name = p.name;
  if (p.description !== undefined) node.description = p.description;
  if (p.location !== undefined) node.location = p.location;
  if (p.state !== undefined) node.state = p.state as State;
  if (p.inputs !== undefined) node.inputs = p.inputs;
  if (p.outputs !== undefined) node.outputs = p.outputs;
  if (p.target !== undefined) node.target = String(p.target);
  node.updatedAt = nowISO();
  return node;
}

// ---------- 4. DeleteNode（级联删边） ----------
export function deleteNode(
  graph: FlowGraph,
  args: { moduleID: number | string; nodeID: string },
): { removedEdges: string[] } {
  const mod = requireModule(graph, args.moduleID);
  if (!mod.nodes[args.nodeID]) {
    throw new FlowError(`节点 "${args.nodeID}" 在模块 ${args.moduleID} 不存在，无需删除。`);
  }
  delete mod.nodes[args.nodeID];
  const removedEdges: string[] = [];
  for (const [eid, e] of Object.entries(mod.edges)) {
    if (e.from === args.nodeID || e.to === args.nodeID) {
      delete mod.edges[eid];
      removedEdges.push(eid);
    }
  }
  return { removedEdges };
}

// ---------- 5. N2N ----------
export interface AddEdgeArgs {
  moduleID: number | string;
  node1: string;
  node2: string;
  text?: string;
  description?: string;
  location?: string;
  state?: string;
}

export function addEdge(graph: FlowGraph, args: AddEdgeArgs): FlowEdge {
  if (args.node1 === args.node2) throw new FlowError("连线的起点和终点不能是同一个节点。");
  const mod = requireModule(graph, args.moduleID);
  if (!mod.nodes[args.node1]) throw new FlowError(`起点节点 "${args.node1}" 在模块 ${args.moduleID} 不存在，请先 add_node。`);
  if (!mod.nodes[args.node2]) throw new FlowError(`终点节点 "${args.node2}" 在模块 ${args.moduleID} 不存在，请先 add_node。`);
  let state: State | undefined;
  if (args.state) {
    assertState(args.state);
    state = args.state as State;
  }
  const edge: FlowEdge = {
    id: nextEdgeId(graph, mod.id),
    from: args.node1,
    to: args.node2,
    createdAt: nowISO(),
  };
  if (args.text) edge.text = args.text;
  if (args.description) edge.description = args.description;
  if (args.location) edge.location = args.location;
  if (state) edge.state = state;
  mod.edges[edge.id] = edge;
  return edge;
}

// ---------- 6/7. UpdateEdge / DeleteEdge ----------
export function updateEdge(
  graph: FlowGraph,
  args: { moduleID: number | string; edgeID: string; patch: { text?: string; description?: string; location?: string; state?: string } },
): FlowEdge {
  const mod = requireModule(graph, args.moduleID);
  const edge = mod.edges[args.edgeID];
  if (!edge) throw new FlowError(`连线 "${args.edgeID}" 在模块 ${args.moduleID} 不存在。现有连线：${Object.keys(mod.edges).join(", ") || "（无）"}`);
  const p = args.patch ?? {};
  if (p.state !== undefined) assertState(p.state);
  if (p.text !== undefined) edge.text = p.text;
  if (p.description !== undefined) edge.description = p.description;
  if (p.location !== undefined) edge.location = p.location;
  if (p.state !== undefined) edge.state = p.state as State;
  return edge;
}

export function deleteEdge(graph: FlowGraph, args: { moduleID: number | string; edgeID: string }): { ok: true } {
  const mod = requireModule(graph, args.moduleID);
  if (!mod.edges[args.edgeID]) throw new FlowError(`连线 "${args.edgeID}" 在模块 ${args.moduleID} 不存在。`);
  delete mod.edges[args.edgeID];
  return { ok: true };
}

// ---------- 8. AddTable ----------
export function addTable(
  graph: FlowGraph,
  args: {
    moduleID: number | string;
    tableId: string;
    dbNodeId?: string;
    tableName: string;
    fields: TableField[];
    description?: string;
    location?: string;
    state?: string;
  },
): FlowNode {
  const mod = requireModule(graph, args.moduleID);
  if (mod.nodes[args.tableId]) {
    throw new FlowError(`数据表节点 "${args.tableId}" 已存在，换个 tableId 或用 update_node 修改。`);
  }
  if (args.dbNodeId) {
    const db = mod.nodes[args.dbNodeId];
    if (!db) throw new FlowError(`绑定的数据库节点 "${args.dbNodeId}" 不存在，请先 add_node(type=database)。`);
    if (db.type !== "database") throw new FlowError(`节点 "${args.dbNodeId}" 不是 database 类型（是 ${db.type}），请绑定到 database 节点。`);
  }
  const state = (args.state ?? "to_plan") as State;
  assertState(state);
  const node: FlowNode = {
    id: args.tableId,
    type: "table",
    name: args.tableName,
    description: args.description ?? "",
    location: args.location ?? "",
    state,
    dbNodeId: args.dbNodeId,
    fields: args.fields ?? [],
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  mod.nodes[args.tableId] = node;
  return node;
}

// ---------- 9. AddSQL ----------
export function addSQL(
  graph: FlowGraph,
  args: {
    moduleID: number | string;
    sqlId: string;
    dbNodeId?: string;
    name: string;
    sql: string;
    description?: string;
    location?: string;
    state?: string;
  },
): FlowNode {
  const mod = requireModule(graph, args.moduleID);
  if (mod.nodes[args.sqlId]) {
    throw new FlowError(`SQL 节点 "${args.sqlId}" 已存在，换个 sqlId 或用 update_node 修改。`);
  }
  if (args.dbNodeId && !mod.nodes[args.dbNodeId]) {
    throw new FlowError(`绑定的数据库节点 "${args.dbNodeId}" 不存在，请先 add_node(type=database)。`);
  }
  const state = (args.state ?? "to_plan") as State;
  assertState(state);
  const node: FlowNode = {
    id: args.sqlId,
    type: "sql",
    name: args.name,
    description: args.description ?? "",
    location: args.location ?? "",
    state,
    dbNodeId: args.dbNodeId,
    sql: args.sql,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  mod.nodes[args.sqlId] = node;
  return node;
}

// ---------- 10. BatchImport ----------
export interface BatchNodeSpec {
  id: string;
  type: string;
  name: string;
  description?: string;
  location?: string;
  state?: string;
  inputs?: string[];
  outputs?: string[];
  target?: string | number;
  dbNodeId?: string;
  fields?: TableField[];
  sql?: string;
}

export interface BatchEdgeSpec {
  from: string;
  to: string;
  text?: string;
  description?: string;
  state?: string;
}

export interface BatchModuleSpec {
  id?: number | string;
  name: string;
  description?: string;
  nodes: BatchNodeSpec[];
  edges?: BatchEdgeSpec[];
}

export interface BatchSpec {
  project?: string;
  replace?: boolean;
  modules: BatchModuleSpec[];
}

export function batchImport(
  graph: FlowGraph,
  spec: BatchSpec,
): { modulesCreated: string[]; nodesAdded: number; edgesAdded: number } {
  if (!spec || !Array.isArray(spec.modules) || spec.modules.length === 0) {
    throw new FlowError("BatchImport 的 spec 里必须有非空的 modules 数组，格式见 skill/SKILL.md 的 BatchImport 一节。");
  }
  if (spec.project) graph.project = spec.project;
  const modulesCreated: string[] = [];
  let nodesAdded = 0;
  let edgesAdded = 0;

  for (const m of spec.modules) {
    let mod = m.id !== undefined ? graph.modules[String(m.id)] : undefined;
    if (!mod) {
      const newId = m.id !== undefined ? String(m.id) : String(Math.max(-1, ...Object.keys(graph.modules).map(Number)) + 1);
      graph.modules[newId] = { id: newId, name: m.name, description: m.description ?? "", nodes: {}, edges: {} };
      mod = graph.modules[newId];
      modulesCreated.push(newId);
    } else if (spec.replace) {
      mod.nodes = {};
      mod.edges = {};
      mod.name = m.name;
      mod.description = m.description ?? "";
    }
    for (const n of m.nodes) {
      addNode(graph, { moduleID: mod.id, nodeID: n.id, type: n.type, name: n.name, description: n.description, location: n.location, state: n.state, inputs: n.inputs, outputs: n.outputs, target: n.target });
      const node = mod.nodes[n.id];
      if (n.fields) node.fields = n.fields;
      if (n.sql) node.sql = n.sql;
      nodesAdded++;
    }
    for (const e of m.edges ?? []) {
      addEdge(graph, { moduleID: mod.id, node1: e.from, node2: e.to, text: e.text, description: e.description, state: e.state });
      edgesAdded++;
    }
  }
  return { modulesCreated, nodesAdded, edgesAdded };
}

// ---------- 11. ReadGraph ----------
function compactNode(n: FlowNode): Record<string, unknown> {
  const o: Record<string, unknown> = { id: n.id, type: n.type, name: n.name, state: n.state };
  if (n.description) o.description = n.description;
  if (n.location) o.location = n.location;
  if (n.inputs?.length) o.inputs = n.inputs;
  if (n.outputs?.length) o.outputs = n.outputs;
  if (n.target) o.target = n.target;
  if (n.fields?.length) o.fields = n.fields;
  if (n.sql) o.sql = n.sql;
  return o;
}

function compactEdge(e: FlowEdge): Record<string, unknown> {
  const o: Record<string, unknown> = { id: e.id, from: e.from, to: e.to };
  if (e.text) o.text = e.text;
  if (e.description) o.description = e.description;
  if (e.state) o.state = e.state;
  return o;
}

export function readGraph(graph: FlowGraph, args: { moduleID?: number | string } = {}): Record<string, unknown> {
  if (args.moduleID !== undefined) {
    const mod = requireModule(graph, args.moduleID);
    return {
      project: graph.project,
      module: {
        id: mod.id,
        name: mod.name,
        description: mod.description,
        nodes: Object.values(mod.nodes).map(compactNode),
        edges: Object.values(mod.edges).map(compactEdge),
      },
    };
  }
  return {
    project: graph.project,
    modules: Object.values(graph.modules).map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      nodeCount: Object.keys(m.nodes).length,
      nodes: Object.values(m.nodes).map(compactNode),
      edges: Object.values(m.edges).map(compactEdge),
    })),
  };
}

// ---------- 12. GetProjectStatus ----------
export function getProjectStatus(graph: FlowGraph): Record<string, unknown> {
  const modules = Object.values(graph.modules).map((m) => {
    const byState: Record<string, number> = {};
    for (const s of STATES) byState[s] = 0;
    for (const n of Object.values(m.nodes)) byState[n.state]++;
    const attention = Object.values(m.nodes)
      .filter((n) => n.state === "broken" || n.state === "pending_decision")
      .map((n) => ({ id: n.id, name: n.name, state: n.state }));
    return {
      id: m.id,
      name: m.name,
      total: Object.keys(m.nodes).length,
      edges: Object.keys(m.edges).length,
      byState,
      attention,
    };
  });
  return {
    project: graph.project,
    updatedAt: graph.updatedAt,
    totalModules: modules.length,
    totalNodes: modules.reduce((a, m) => a + m.total, 0),
    modules,
    hint: "attention 里是 broken（有Bug）和 pending_decision（待决策）的节点，优先处理",
  };
}
