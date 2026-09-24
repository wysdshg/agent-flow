# agent-flow skill — 用流程图给用户整理项目进度

你（AI agent）在开发过程中，用本项目提供的 MCP 工具维护一张"项目流程图"。
图数据存在项目的 `.flow/flow.json`，渲染页面在 `.flow/flow.html`（浏览器直接打开，用户可看）。

目的只有一个：**让用户随时打开一张图就看懂项目现在做到哪了、还剩什么、哪里有问题**。

## 铁律（必须遵守）

1. **description 必须用中文大白话**，说清楚"这个东西是干嘛的、给谁用"。禁止堆砌用户没确认过的术语。
   - 好："把前面写过的剧情找出来，拼到提示词里，让 AI 记得前文"
   - 差："基于向量相似度的上下文召回与 Rerank 融合"
2. **状态只有 7 种**，颜色固定，不要自己发明状态：
   | state | 颜色 | 什么时候用 |
   |---|---|---|
   | completed | 绿 | 写完并且测试通过了 |
   | in_progress | 浅蓝 | 正在写 |
   | planned | 深蓝 | 方案已定、还没动手 |
   | broken | 红 | 曾经能用，现在有 bug |
   | to_plan | 灰 | 只是个想法，还没定方案 |
   | pending_decision | 黄 | 有分歧/要用户拍板 |
   | deprecated | 棕 | 被替代了，别再用了 |
3. **主图（moduleID=0）只放两类东西**：模块级节点（type=module）+ 全局资源节点（database/llm/queue/file 等）。函数级细节放子模块画布，双击 module 节点可跳转。
4. **开工先看图，改前先读图**：每个开发会话开始先调 `get_project_status`；要改某个模块前先 `read_graph` 该模块。
5. **动图之后必做**：`validate_graph` 校验，通过后 `render_html` 刷新页面。
6. 每完成一件事就同步图（加节点/改状态），**不要攒到最后一次性补**。

## 标准会话流程

```
开工：  get_project_status → （需要细节时）read_graph moduleID=X
干活中：add_node / n2n / add_table ...（新想法 to_plan，动手了改 in_progress）
收工：  update_node 把写完测过的节点改 completed（出 bug 改 broken）
        → validate_graph → render_html → 告诉用户"图已更新，打开 .flow/flow.html 查看"
```

## 工具速查（14 个）

| 工具 | 用途 | 关键参数 |
|---|---|---|
| get_project_status | 进度总览 | 无 |
| read_graph | 读图（推荐按模块读） | moduleID? |
| create_sub_module | 建子模块画布 | name, description? |
| add_node | 加节点 | moduleID, nodeID, type, name, description, state?, location?, inputs?, outputs?, target? |
| update_node | 改节点 | moduleID, nodeID, patch{state,...} |
| delete_node | 删节点（级联删线） | moduleID, nodeID |
| n2n | 连线 | moduleID, node1, node2, text? |
| update_edge / delete_edge | 改线/删线 | moduleID, edgeID |
| add_table | 加数据表 | moduleID, tableId, dbNodeId?, tableName, fields[] |
| add_sql | 加 SQL 节点 | moduleID, sqlId, dbNodeId?, name, sql |
| batch_import | 一次性建图（冷启动） | spec{project?, replace?, modules[]} |
| validate_graph | 校验 | moduleID? |
| render_html | 生成/刷新网页 | 无 |

## 节点类型（22 种）

- 流程：start / end / process / judge / module
- 数据资源：database / table / file / sql
- AI 应用：llm / tool_call / retrieval / rerank / assemble / api / embedding / cache / queue / prompt / agent / human_loop / checkpoint

其中 module / llm / tool_call / agent / assemble 支持 inputs[] / outputs[] 端口（画在节点左右两侧）。
布局是自动的（从左到右），**不要给坐标**，只给拓扑关系。

## batch_import spec 格式（给老项目整理现状用）

```json
{
  "project": "项目名",
  "replace": false,
  "modules": [
    {
      "id": 0,
      "name": "主流程图",
      "nodes": [
        { "id": "S1", "type": "start", "name": "开始", "description": "用户打开网页", "state": "completed" },
        { "id": "M1", "type": "module", "name": "登录模块", "description": "手机号验证码登录", "state": "completed", "target": "1" },
        { "id": "DB1", "type": "database", "name": "业务库", "description": "MySQL，存用户和订单", "state": "completed" }
      ],
      "edges": [
        { "from": "S1", "to": "M1", "text": "点登录" }
      ]
    },
    {
      "id": 1,
      "name": "登录模块",
      "nodes": [
        { "id": "T_user", "type": "table", "name": "user", "dbNodeId": "DB1", "tableName": "user", "state": "completed", "fields": [ { "name": "id", "type": "bigint", "desc": "用户编号" } ] }
      ]
    }
  ]
}
```

注意：table / sql 节点的 dbNodeId 必须指向**同一模块内**的 database 节点。

## 状态怎么流转

```
新想法 → to_plan →（方案定了）→ planned →（开始写）→ in_progress
       →（写完测过）→ completed
任何阶段发现坏了 → broken        被新方案替代 → deprecated
需要用户拍板   → pending_decision（这是最该在汇报里提到的）
```

不要把 to_plan 当垃圾桶：确定不做的直接删除，不做的想法记 deprecated。
