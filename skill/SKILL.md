---
name: agent-flow
description: 用流程图给用户整理项目进度与流程。当用户要求"整理项目进度/流程"、"画项目流程图"、"记录/更新功能进度"，或在新项目/旧项目里需要让 AI 边开发边维护一张可视化的项目进度图时使用。通过 agent-flow MCP 工具（或 agent-flow CLI）维护 .flow/flow.json 并渲染 .flow/flow.html 供用户浏览器查看。
---

# agent-flow — 用流程图给用户整理项目进度

你（AI agent）在开发过程中，用 agent-flow 提供的 MCP 工具维护一张"项目流程图"。
图数据存在项目的 `.flow/flow.json`，渲染页面在 `.flow/flow.html`（浏览器直接打开，用户可看）。

目的只有一个：**让用户随时打开一张图就看懂项目现在做到哪了、还剩什么、哪里有问题**。

> 工具来源：agent-flow（开源工具，仓库 github.com/wysdshg/agent-flow）。开工先自检：`agent-flow status`
> 能跑就直接用；提示命令不存在就现场安装：`git clone https://github.com/wysdshg/agent-flow && cd agent-flow && npm install && npm link`。
> 若当前会话没有 agent-flow 的 MCP 工具，改用 CLI：`agent-flow init / batch / apply / render / status / validate / serve / export`
> （`apply` 接 `[{tool,args},...]`，tool 与下表同名；`batch` 接建图 spec；`serve` 起本地实时预览，改图后浏览器自动刷新；`export` 导出 Mermaid 文本可贴 README）。`AGENT_FLOW_ROOT` 环境变量可指定项目根。
> **多项目共用这个 MCP 服务时，每次工具调用都要传 `project_root` 参数**（见下文「多项目隔离」），否则会把不同项目的图混在一起。

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
7. **整理旧项目必须以代码实况为准**：项目的 md 文档可能过时、有错或与代码脱节，禁止照抄文档直接建图。节点描述、连线关系、状态判断要基于**读代码、跑测试**后的结论；发现文档与代码冲突时以代码为准，并在节点 description 里注明"文档写的 X，实际代码是 Y"。
8. **尊重并感知人工改动**：用户可能手工编辑过 flow.json，或在网页详情面板生成过修改指令（`[{"tool":...}]` JSON）。每次会话开工必须先 `get_project_status`/`read_graph` **重新读磁盘上的最新图**，禁止凭上次会话的记忆直接改图；发现用户手工加的节点或改动要原样保留，拿不准就问用户。用户发来一段 ops JSON 时，逐条执行并汇报结果。
9. **建功能节点必建文档**：给功能/模块节点挂 `doc` 字段（`.flow/docs/<功能名>.md`），文档不存在时 `validate_graph` 会返回 docWarnings。规则见下文「功能文档」。
10. **状态入库必须有验证证据**：自动可证的（测试/构建）AI 自己跑过再标；主观体验类（视觉效果/交互）运行起来交用户确认，收工打包问一次、别中途反复打断；拿不准的宁标 to_plan，**虚报 completed 是最恶劣的失败**。改完上游，下游「上次验证」即过期，重验之前不许标 completed。

## 怎么用图了解项目（读侧，会话开场）

图是**索引**，md 文档是**正文**，代码是**源头**。三层按需加载，不要一上来吞全量：

```
1. get_project_status        → 七态统计，只记两件事：哪些 broken、哪些 pending_decision
2. 有 broken/待决策？        → 这才是本次要干活的清单，别的先不看
3. read_graph moduleID=X     → 只读目标模块，看节点状态和连线关系
4. 想深入某个节点？           → 读它 doc 字段指向的 md（先看文档头：状态+上次验证日期判断信息新鲜度，再看正文）
5. 要动手改代码才去读代码     → 用节点 location 字段定位文件与行号
```

用户问"项目现在怎么样"→ 答第 1 步的统计 + 第 2 步清单即可，别复述整张图。
用户问"XX 功能怎么实现的"→ 直接读那个节点的 doc md，读完给结论，别全文背诵。

## 功能文档（doc 字段）

**文档头（紧跟标题一行，validate_graph 会校验，出问题返回 docHeaderIssues）**：

```markdown
> 状态: completed | 建立: 2026-09-29 | 更新: 2026-09-30 | 上次验证: 2026-09-30（npm test 19/19 通过）
```

- 状态用 7 态之一且必须与图节点一致；「上次验证」是证据链（日期+怎么验的：测试命令/用户确认），completed 必填
- 「更新」在功能变动或 AI 使用前核对时更新；「上次验证」只在真跑过验证后更新，改了代码没跑 ≠ 验证
- validate 抓四类腐烂：缺头、状态与图不一致、更新早于图变更、completed 缺验证/验证超 90 天

**何时写（分段长成，不攒到最后）**：
- 节点 planned → in_progress 时就写「为什么做 / 解决什么 / 怎么实现」——设计意图还在脑子里；事后补写只剩流水账
- completed 前补「代码位置 / 上次验证证据 / 怎么扩展」
- 一个功能一个文件，放 `.flow/docs/`（文件名=功能名，kebab-case），并在 `.flow/docs/README.md` 索引登记一行（名称|一句话|状态）

**正文模板（六段，总长 ≤ 100 行，写不出来的段就删掉）**：

```markdown
# <功能名>
> 状态: ... | 建立: ... | 更新: ... | 上次验证: ...（证据）
## 为什么做    ← 背景与痛点，2-3 句大白话
## 解决什么    ← 给谁用、带来什么变化
## 怎么实现    ← 关键设计决策 + 为什么这么选；不贴大段代码，给文件:行号
## 怎么扩展    ← 扩展点、约束、别踩的坑
## 代码位置    ← src/xxx.ts:12 清单
## 关联        ← 相关节点 ID / 上下游文档链接
```

**怎么做**：add_node 或 update_node 时传 `doc: ".flow/docs/<功能名>.md"`；文档里别复制图的描述（description 管一句话，md 管展开），也别把多个功能写进同一个 md。用户在详情面板点「文件名 ↗」就是打开这份 md。

**实验文档（与正式文档分离）**：试新方向（如换 RAG 切分方式、不确定变好变坏）**不改正式文档**——新建 `exp-<主题>.md` + 一个 to_plan 实验节点，只写五样：
假设（为什么觉得新方向好）/ 怎么算赢（对比指标）/ 改动范围 / 回滚方式 / 结论（留空）。
采纳 → 补结论，回写正式节点 doc，实验节点标 deprecated；否决 → 标 deprecated，**负结论留档防重蹈**。
文档里影响的下游（如换入库方式影响检索），在「关联」段列出来，动它之前先看下游。

## 冷启动（新项目 / 老项目没有 .flow 时）

项目事实的来源优先级：**代码（证据）> 项目内文档（线索，可能过时）> 用户（仲裁）**。全局记忆/用户偏好只回答"按什么规范整理"，不回答"这个项目是什么"。

```
1. 读代码、跑测试摸清结构：模块划分、调用关系、关键文件入口
2. 结构事实直接入图：batch_import 一次性建（参考铁律 7，禁止照抄旧文档）
3. 状态事实分级入库：
   - 测试过/构建过的        → AI 自证后标 completed（doc 头记证据）
   - 视觉/交互等主观类      → 运行起来交用户确认后再标
   - 拿不准的               → 一律 to_plan，宁低勿高
4. 每个功能节点按模板建 doc md（带文档头）→ validate_graph → render_html
5. 汇报："图已建好，X 个节点拿不准标了 to_plan 待你确认"
```

## 多项目隔离（MCP 模式必读）

MCP 服务是全局唯一进程：无论在哪个项目的会话里调用，都是同一个 server 进程。14 个工具全部支持可选 `project_root` 参数（项目根目录，绝对路径优先）：

- **多项目环境每次调用都传** `project_root: "<当前项目绝对路径>"`，把 `.flow/` 隔离在各项目内
- 不传时落到服务启动目录（Windows 上是 `C:\Users\<你>\.flow\`），不同项目的图会混进同一个 flow.json
- 每个工具的返回值都带 `project_root` 字段，用它核对有没有串台；发现混了就删掉错误目录下的 `.flow/` 重建
- 单项目专用配置可以固定根目录：mcpServers 配置加 `"env": { "AGENT_FLOW_ROOT": "C:\\path\\to\\project" }`，此后可不传 project_root
- CLI 模式无此问题（每次进程启动时就在项目里跑，或用 `AGENT_FLOW_ROOT`）

## 标准会话流程

```
开工：  get_project_status → （需要细节时）read_graph moduleID=X
干活中：add_node / n2n / add_table ...（新想法 to_plan，动手了改 in_progress 并写文档前三段）
收工：  update_node 把写完测过的节点改 completed（出 bug 改 broken）
        → 补全该功能的 doc md（文档头 + 六段；completed 必须有上次验证证据）
        → 没做完的 in_progress 节点，description 或 doc 里留一行「下一步：xxx」
        → validate_graph（docWarnings/docHeaderIssues 先补）→ render_html
        → 需要用户看效果的主观验证打包成一次清单问，别中途反复打断
        → 告诉用户"图已更新，打开 .flow/flow.html 查看
        （若用户跑过 agent-flow serve，浏览器会自动刷新，无需手动重开）"
```

## 工具速查（14 个）

> 全部工具都支持可选 `project_root`（项目根绝对路径）：多项目共用 MCP 时每次必传，见「多项目隔离」。

| 工具 | 用途 | 关键参数 |
|---|---|---|
| get_project_status | 进度总览 | 无 |
| read_graph | 读图（推荐按模块读） | moduleID? |
| create_sub_module | 建子模块画布 | name, description? |
| add_node | 加节点 | moduleID, nodeID, type, name, description, state?, location?, doc?, inputs?, outputs?, target? |
| update_node | 改节点 | moduleID, nodeID, patch{state,...} |
| delete_node | 删节点（级联删线） | moduleID, nodeID |
| n2n | 连线 | moduleID, node1, node2, text? |
| update_edge / delete_edge | 改线/删线 | moduleID, edgeID |
| add_table | 加数据表 | moduleID, tableId, dbNodeId?, tableName, fields[] |
| add_sql | 加 SQL 节点 | moduleID, sqlId, dbNodeId?, name, sql |
| batch_import | 一次性建图（冷启动） | spec{project?, replace?, modules[]} |
| validate_graph | 校验（docWarnings 缺文档 + docHeaderIssues 文档头问题） | moduleID? |
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
    }
  ]
}
```

注意：table / sql 节点的 dbNodeId 必须指向**同一模块内**的 database 节点。完整示例见仓库 `examples/demo.flow.json`。

## 状态怎么流转

```
新想法 → to_plan →（方案定了）→ planned →（开始写）→ in_progress
       →（写完测过）→ completed
任何阶段发现坏了 → broken        被新方案替代 → deprecated
需要用户拍板   → pending_decision（这是最该在汇报里提到的）
```

不要把 to_plan 当垃圾桶：确定不做的直接删除，不做的想法记 deprecated。
