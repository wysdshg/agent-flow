/**
 * 冒烟测试：不依赖测试框架，直接跑核心链路，任何一步抛错/断言失败即退出码 1。
 * 覆盖：建模块/加节点/连线/表/SQL/批量导入/更新/级联删除/校验/布局/渲染。
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { newGraph, FlowStore } from "../src/core/store.js";
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
  readGraph,
  updateEdge,
  updateNode,
} from "../src/core/graph-ops.js";
import { FlowError } from "../src/core/schema.js";
import { validateGraph } from "../src/core/validate.js";
import { layoutGraph } from "../src/layout/dagre.js";
import { renderHtml } from "../src/render/html.js";

let passed = 0;
function step(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

function expectThrow(fn: () => void, keyword: string): void {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof FlowError, `应抛 FlowError，实际：${e}`);
    assert.ok(String((e as Error).message).includes(keyword), `报错应包含 "${keyword}"，实际：${(e as Error).message}`);
    return;
  }
  assert.fail(`应抛出包含 "${keyword}" 的 FlowError`);
}

// ---------- 纯函数：graph-ops ----------
const g = newGraph("测试项目");

step("createSubModule 返回递增编号", () => {
  const m1 = createSubModule(g, { name: "登录模块", description: "验证码登录" });
  assert.equal(m1.moduleID, "1");
  const m2 = createSubModule(g, { name: "订单模块" });
  assert.equal(m2.moduleID, "2");
});

step("addNode 默认 to_plan，重复 ID 报错", () => {
  const n = addNode(g, { moduleID: 0, nodeID: "S1", type: "start", name: "开始", description: "打开网页" });
  assert.equal(n.state, "to_plan");
  expectThrow(
    () => addNode(g, { moduleID: 0, nodeID: "S1", type: "start", name: "重复", description: "" }),
    "已存在",
  );
});

step("addNode 非法类型/状态报错（中文）", () => {
  expectThrow(() => addNode(g, { moduleID: 0, nodeID: "X1", type: "nope", name: "x", description: "" }), "未知的节点类型");
  expectThrow(
    () => addNode(g, { moduleID: 0, nodeID: "X2", type: "process", name: "x", description: "", state: "done" }),
    "未知的状态",
  );
  expectThrow(() => addNode(g, { moduleID: 99, nodeID: "X3", type: "process", name: "x", description: "" }), "不存在");
});

step("n2n 连线 + 自环/悬空报错", () => {
  addNode(g, { moduleID: 0, nodeID: "P1", type: "process", name: "处理", description: "干活" });
  addNode(g, { moduleID: 0, nodeID: "P2", type: "process", name: "处理2", description: "再干活" });
  const e = addEdge(g, { moduleID: 0, node1: "S1", node2: "P1", text: "启动" });
  assert.match(e.id, /^e\d+$/);
  addEdge(g, { moduleID: 0, node1: "P1", node2: "P2" });
  expectThrow(() => addEdge(g, { moduleID: 0, node1: "P2", node2: "P2" }), "同一个节点");
  expectThrow(() => addEdge(g, { moduleID: 0, node1: "P2", node2: "幽灵" }), "不存在");
});

step("addTable/addSQL 需绑定 database 节点", () => {
  addNode(g, { moduleID: 0, nodeID: "DB1", type: "database", name: "业务库", description: "MySQL" });
  const t = addTable(g, {
    moduleID: 0,
    tableId: "T_user",
    dbNodeId: "DB1",
    tableName: "user",
    fields: [{ name: "id", type: "bigint" }],
  });
  assert.equal(t.type, "table");
  const q = addSQL(g, { moduleID: 0, sqlId: "Q1", dbNodeId: "DB1", name: "查用户", sql: "SELECT 1" });
  assert.equal(q.type, "sql");
  expectThrow(
    () => addTable(g, { moduleID: 0, tableId: "T_bad", dbNodeId: "P1", tableName: "x", fields: [] }),
    "不是 database 类型",
  );
});

step("updateNode 局部 patch + updateEdge", () => {
  const n = updateNode(g, { moduleID: 0, nodeID: "P1", patch: { state: "completed", location: "src/a.ts" } });
  assert.equal(n.state, "completed");
  assert.equal(n.location, "src/a.ts");
  expectThrow(
    () => updateNode(g, { moduleID: 0, nodeID: "P1", patch: { state: "wrong" } }),
    "未知的状态",
  );
  const e = updateEdge(g, { moduleID: 0, edgeID: "e1", patch: { text: "点火" } });
  assert.equal(e.text, "点火");
});

step("deleteNode 级联删边，deleteEdge", () => {
  const res = deleteNode(g, { moduleID: 0, nodeID: "P2" });
  assert.ok(res.removedEdges.includes("e2"));
  expectThrow(() => deleteEdge(g, { moduleID: 0, edgeID: "e2" }), "不存在");
  deleteEdge(g, { moduleID: 0, edgeID: "e1" });
});

step("batchImport 冷启动 + replace", () => {
  const res = batchImport(g, {
    project: "批量项目",
    modules: [
      {
        id: 5,
        name: "RAG 模块",
        nodes: [
          { id: "R1", type: "retrieval", name: "检索", description: "查资料", state: "in_progress" },
          { id: "A1", type: "assemble", name: "组装", description: "拼提示词", inputs: ["资料"], outputs: ["提示词"] },
        ],
        edges: [{ from: "R1", to: "A1", text: "段落" }],
      },
    ],
  });
  assert.deepEqual(res.modulesCreated, ["5"]);
  assert.equal(res.nodesAdded, 2);
  assert.equal(res.edgesAdded, 1);
  // 对已有模块 replace=true 重建
  batchImport(g, { replace: true, modules: [{ id: 5, name: "RAG 模块", nodes: [{ id: "R9", type: "retrieval", name: "新检索", description: "" }] }] });
  assert.ok(g.modules["5"].nodes["R9"]);
  assert.ok(!g.modules["5"].nodes["R1"]);
  expectThrow(() => batchImport(g, { modules: [] }), "modules");
});

step("readGraph 紧凑输出 / getProjectStatus 统计", () => {
  const r = readGraph(g, { moduleID: 5 }) as any;
  assert.equal(r.module.nodes.length, 1);
  const all = readGraph(g) as any;
  assert.equal(all.modules.length, 4);
  const st = getProjectStatus(g) as any;
  assert.equal(st.totalModules, 4);
  assert.ok(st.modules.every((m: any) => Object.keys(m.byState).length === 7));
});

// ---------- validate ----------
step("validateGraph：正常图通过，悬空边/坏引用/深嵌套被抓", () => {
  const okRes = validateGraph(g);
  assert.equal(okRes.ok, true, `应为 ok，issues: ${JSON.stringify(okRes.issues)}`);
  // 制造悬空边
  g.modules["5"].edges["e_bad"] = { id: "e_bad", from: "R9", to: "幽灵", createdAt: "" };
  const bad = validateGraph(g);
  assert.equal(bad.ok, false);
  assert.ok(bad.issues.some((i) => i.includes("幽灵")));
  delete g.modules["5"].edges["e_bad"];
  // 制造嵌套过深：0 → 1 → 2 → 3 → 4
  const c3 = createSubModule(g, { name: "三" });
  const c4 = createSubModule(g, { name: "四" });
  addNode(g, { moduleID: 0, nodeID: "M1", type: "module", name: "一", description: "", target: 1 });
  addNode(g, { moduleID: 1, nodeID: "M2", type: "module", name: "二", description: "", target: 2 });
  addNode(g, { moduleID: 2, nodeID: "M3", type: "module", name: "三", description: "", target: c3.moduleID });
  addNode(g, { moduleID: String(c3.moduleID), nodeID: "M4", type: "module", name: "四", description: "", target: c4.moduleID });
  const deep = validateGraph(g);
  assert.equal(deep.ok, false);
  assert.ok(deep.issues.some((i) => i.includes("嵌套")));
});

// ---------- layout + render ----------
step("layoutGraph 自动布局有坐标且渲染产物是合法 HTML", () => {
  const layout = layoutGraph(g);
  const pos = layout.modules["0"].nodes["S1"];
  assert.ok(pos && Number.isFinite(pos.x) && Number.isFinite(pos.y));
  const html = renderHtml(g, layout);
  assert.ok(html.startsWith("<!DOCTYPE html>"));
  assert.ok(html.includes("var DATA="));
  assert.ok(!html.includes("__KEEP__"));
});

// ---------- store（真实文件系统，用临时目录） ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-flow-test-"));
process.env.AGENT_FLOW_ROOT = tmp;
const store = new FlowStore(tmp);

step("store.load 自动初始化空图并落盘", () => {
  const graph = store.load();
  assert.equal(graph.modules["0"].id, "0");
  assert.ok(fs.existsSync(store.flowFile));
});

step("store.save 写盘可回读", () => {
  const graph = store.load();
  batchImport(graph, {
    modules: [{ name: "临时模块", nodes: [{ id: "T1", type: "process", name: "临时", description: "" }] }],
  });
  store.save(graph);
  const again = JSON.parse(fs.readFileSync(store.flowFile, "utf-8"));
  assert.ok(again.modules["1"] && again.modules["1"].nodes["T1"]);
});

step("store.saveHtml 落盘", () => {
  const graph = store.load();
  store.saveHtml(renderHtml(graph, layoutGraph(graph)));
  const html = fs.readFileSync(store.htmlFile, "utf-8");
  assert.ok(html.includes("</html>"));
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n全部通过：${passed} 步`);
