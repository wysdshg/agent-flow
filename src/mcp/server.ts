/**
 * MCP stdio 服务：把 14 个图操作工具注册给 AI agent 使用。
 * 工具命名用 snake_case（MCP 惯例），错误以友好中文文本返回给模型。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { FlowStore } from "../core/store.js";
import {
  addNode,
  addEdge,
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
} from "../core/graph-ops.js";
import { validateGraph } from "../core/validate.js";
import { layoutGraph } from "../layout/dagre.js";
import { renderHtml } from "../render/html.js";
import { FlowError, addNodeSchema, tableFieldSchema } from "../core/schema.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown): ToolResult {
  const msg = err instanceof FlowError || err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: "操作失败：" + msg }], isError: true };
}

const batchNodeShape = {
  id: z.string().describe("节点 ID"),
  type: z.string().describe("节点类型，22 种之一"),
  name: z.string().describe("节点名称"),
  description: z.string().optional().describe("中文大白话功能描述"),
  location: z.string().optional().describe("代码/文档位置"),
  state: z.string().optional().describe("七态之一，默认 to_plan"),
  inputs: z.array(z.string()).optional(),
  outputs: z.array(z.string()).optional(),
  target: z.union([z.string(), z.number()]).optional().describe("module 节点跳转的子模块编号"),
  dbNodeId: z.string().optional().describe("所属 database 节点 ID"),
  fields: z.array(tableFieldSchema).optional().describe("table 节点的字段"),
  sql: z.string().optional().describe("sql 节点的 SQL 内容"),
};

const batchModuleShape = {
  id: z.union([z.string(), z.number()]).optional().describe("模块编号，缺省自动分配；0=主图"),
  name: z.string().describe("模块名"),
  description: z.string().optional(),
  nodes: z.array(z.object(batchNodeShape)).describe("该模块的全部节点"),
  edges: z
    .array(
      z.object({
        from: z.string().describe("起点节点 ID"),
        to: z.string().describe("终点节点 ID"),
        text: z.string().optional().describe("连线短文字"),
        description: z.string().optional(),
        state: z.string().optional(),
      }),
    )
    .optional()
    .describe("该模块的全部连线"),
};

export async function startMcp(): Promise<void> {
  const store = new FlowStore();
  const server = new McpServer({ name: "agent-flow", version: "0.1.0" });

  const read = () => store.load();
  const save = (g: ReturnType<typeof store.load>) => store.save(g);

  server.registerTool(
    "get_project_status",
    {
      title: "项目状态总览",
      description:
        "查看项目各模块的进度统计（各状态节点数、broken/pending_decision 清单）。每次开发会话开工前先调用它了解现状，不要凭记忆猜。",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(getProjectStatus(read()));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "read_graph",
    {
      title: "读流程图",
      description:
        "读取流程图数据。传 moduleID 只读一个模块（推荐，省上下文）；不传读全图。改图之前必须先读相关模块。",
      inputSchema: { moduleID: z.number().int().min(0).optional().describe("模块编号，0=主流程图") },
    },
    async (args) => {
      try {
        return ok(readGraph(read(), { moduleID: args.moduleID }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "create_sub_module",
    {
      title: "创建子模块画布",
      description:
        "新建一个子模块画布，返回新的 moduleID。主图只放模块级节点，内部流程放子模块画布里。创建后记得在主图用 add_node(type=module, target=返回的moduleID) 加一个对应的模块节点。",
      inputSchema: {
        moduleID: z.number().int().min(0).optional().describe("（预留）父模块编号，一般不传"),
        name: z.string().describe("模块名，如：章节生成模块"),
        description: z.string().optional().describe("模块职责，中文大白话"),
      },
    },
    async (args) => {
      try {
        const graph = read();
        const res = createSubModule(graph, args);
        save(graph);
        return ok({ ...res, hint: `已创建子模块画布 ${res.moduleID}。请在主图(moduleID=0)加一个 type=module 的节点并把 target 设为 ${res.moduleID}，才能从主图跳转进来。` });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "add_node",
    {
      title: "添加节点",
      description:
        "向指定画布添加节点。type 必须是 22 种类型之一；state 必须是七态之一（新想法用 to_plan，方案定了用 planned，开始写了用 in_progress，写完测过用 completed）。description 必须用中文大白话。",
      inputSchema: addNodeSchema,
    },
    async (args) => {
      try {
        const graph = read();
        const node = addNode(graph, args);
        save(graph);
        return ok({ added: node.id, type: node.type, state: node.state, moduleID: String(args.moduleID) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_node",
    {
      title: "修改节点",
      description:
        "修改已有节点的名称/描述/位置/状态/端口。最常见的用途：功能写完测过后把 state 改成 completed；发现回归 bug 改成 broken。",
      inputSchema: {
        moduleID: z.number().int().min(0).describe("模块编号"),
        nodeID: z.string().describe("节点 ID"),
        patch: z
          .object({
            name: z.string().optional(),
            description: z.string().optional(),
            location: z.string().optional(),
            state: z.string().optional(),
            inputs: z.array(z.string()).optional(),
            outputs: z.array(z.string()).optional(),
            target: z.union([z.string(), z.number()]).optional(),
          })
          .describe("要修改的字段，只传需要改的"),
      },
    },
    async (args) => {
      try {
        const graph = read();
        const node = updateNode(graph, args);
        save(graph);
        return ok({ updated: node.id, state: node.state });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "delete_node",
    {
      title: "删除节点",
      description: "删除节点，相关连线会一并删除。",
      inputSchema: {
        moduleID: z.number().int().min(0).describe("模块编号"),
        nodeID: z.string().describe("节点 ID"),
      },
    },
    async (args) => {
      try {
        const graph = read();
        const res = deleteNode(graph, args);
        save(graph);
        return ok({ deleted: args.nodeID, removedEdges: res.removedEdges });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "n2n",
    {
      title: "节点连线",
      description: "在两个节点之间连一条有向边（从 node1 指向 node2）。text 是连线上的短文字，如「角色实体」。",
      inputSchema: {
        moduleID: z.number().int().min(0).describe("模块编号"),
        node1: z.string().describe("起点节点 ID"),
        node2: z.string().describe("终点节点 ID"),
        text: z.string().optional().describe("连线短文字，1-6 个字"),
        description: z.string().optional().describe("连线详细说明"),
        location: z.string().optional().describe("这条链路对应的代码位置"),
        state: z.string().optional().describe("这条链路的状态（可选）"),
      },
    },
    async (args) => {
      try {
        const graph = read();
        const edge = addEdge(graph, args);
        save(graph);
        return ok({ edgeId: edge.id, from: edge.from, to: edge.to });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_edge",
    {
      title: "修改连线",
      description: "修改连线的文字/说明/状态。",
      inputSchema: {
        moduleID: z.number().int().min(0).describe("模块编号"),
        edgeID: z.string().describe("连线 ID，如 e3"),
        patch: z
          .object({
            text: z.string().optional(),
            description: z.string().optional(),
            location: z.string().optional(),
            state: z.string().optional(),
          })
          .describe("要修改的字段"),
      },
    },
    async (args) => {
      try {
        const graph = read();
        const edge = updateEdge(graph, args);
        save(graph);
        return ok({ updated: edge.id });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "delete_edge",
    {
      title: "删除连线",
      description: "删除一条连线。",
      inputSchema: {
        moduleID: z.number().int().min(0).describe("模块编号"),
        edgeID: z.string().describe("连线 ID，如 e3"),
      },
    },
    async (args) => {
      try {
        const graph = read();
        deleteEdge(graph, args);
        save(graph);
        return ok({ deleted: args.edgeID });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "add_table",
    {
      title: "添加数据表",
      description: "添加一张数据表（ER 表）节点，需先有 type=database 的数据库节点，用 dbNodeId 绑定它。字段名和说明用大白话。",
      inputSchema: {
        moduleID: z.number().int().min(0).describe("模块编号"),
        tableId: z.string().describe("表节点 ID，如 T_user"),
        dbNodeId: z.string().optional().describe("所属数据库节点 ID"),
        tableName: z.string().describe("表名，如 user"),
        fields: z
          .array(tableFieldSchema)
          .describe("字段列表 [{name,type,desc}]，desc 用大白话说明这个字段存什么"),
        description: z.string().optional().describe("这张表是干嘛的"),
        location: z.string().optional().describe("建表 SQL 或 migration 文件位置"),
        state: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const graph = read();
        const node = addTable(graph, args);
        save(graph);
        return ok({ added: node.id, table: node.name, fields: node.fields?.length ?? 0 });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "add_sql",
    {
      title: "添加 SQL 脚本",
      description: "添加一条关键 SQL/查询逻辑节点，绑定到 database 节点上。",
      inputSchema: {
        moduleID: z.number().int().min(0).describe("模块编号"),
        sqlId: z.string().describe("SQL 节点 ID，如 Q_hot_chapters"),
        dbNodeId: z.string().optional().describe("所属数据库节点 ID"),
        name: z.string().describe("名称，如：热门章节查询"),
        sql: z.string().describe("SQL 内容"),
        description: z.string().optional(),
        location: z.string().optional(),
        state: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const graph = read();
        const node = addSQL(graph, args);
        save(graph);
        return ok({ added: node.id });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "batch_import",
    {
      title: "批量建图（冷启动）",
      description:
        "从一份 JSON spec 一次性建出整张图，用于给旧项目整理现状或初始化新项目。spec.modules[].id 不传则自动分配；replace=true 时清空同名模块后重建。",
      inputSchema: {
        spec: z.object({
          project: z.string().optional().describe("项目名"),
          replace: z.boolean().optional().describe("模块已存在时是否清空重建，默认 false"),
          modules: z.array(z.object(batchModuleShape)).describe("模块列表"),
        }),
      },
    },
    async (args) => {
      try {
        const graph = read();
        const res = batchImport(graph, args.spec);
        save(graph);
        return ok({ ...res, hint: "建议接着调用 validate_graph 检查一遍，再 render_html 生成查看页面" });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "validate_graph",
    {
      title: "校验流程图",
      description:
        "检查图是否合法：节点/连线 ID、悬空连线、非法 state、子模块引用、表绑定、嵌套深度。每次动图之后调用。",
      inputSchema: { moduleID: z.number().int().min(0).optional().describe("只校验某个模块，缺省校验全图") },
    },
    async (args) => {
      try {
        return ok(validateGraph(read(), args.moduleID));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "render_html",
    {
      title: "生成流程图网页",
      description:
        "自动布局并生成单文件 .flow/flow.html，用户可用浏览器直接打开查看。建图/改图完成后调用它刷新页面。",
      inputSchema: {},
    },
    async () => {
      try {
        const graph = read();
        const layout = layoutGraph(graph);
        const html = renderHtml(graph, layout);
        store.saveHtml(html);
        const nodes = Object.values(graph.modules).reduce((a, m) => a + Object.keys(m.nodes).length, 0);
        return ok({
          path: store.htmlFile,
          modules: Object.keys(graph.modules).length,
          nodes,
          hint: "已生成，用浏览器打开即可查看；改动图数据后重新调用本工具刷新",
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
