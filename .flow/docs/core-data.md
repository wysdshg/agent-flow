# 核心数据层（schema / store / graph-ops / validate）

> 状态: completed | 建立: 2026-09-24 | 更新: 2026-09-30 | 上次验证: 2026-09-29（npm test 19/19 通过）

## 为什么做

agent 和用户要共用同一份项目进度数据，必须有一个进 git 不打架的存储格式，和一套改数据的规矩。

## 解决什么

- flow.json 是唯一数据源：agent 改它，用户在网页上改会生成指令 JSON 粘回给 agent
- 14 个图操作（加节点/连线/建表/导入…）MCP 和 CLI 走同一份纯函数实现，行为永远一致
- 改完能自动查出悬空连线、非法状态、嵌套过深这类低级错

## 怎么实现

- schema.ts 定类型：7 种状态（固定颜色）、22 种节点类型、FlowGraph/FlowNode 结构，zod 定义工具入参
- store.ts 的 FlowStore 管 root/flowDir/flowFile/htmlFile 四个路径，load/save 是唯一写入口，nextEdgeId 生成不冲突的边 ID
- graph-ops.ts 全是纯函数（输入图返回新状态，不碰文件系统），MCP 层与 CLI 层都调这里
- validate.ts 的 validateGraph 抓硬错误；missingDocs 是软提醒：节点挂了 doc 但 md 文件不存在时提示补文档

## 怎么扩展

- 加第 15 个工具：graph-ops.ts 写纯函数 → schema.ts 补 zod schema → server.ts 与 index.ts 各注册一份
- state/type 必须从 STATES/NODE_TYPES 常量取，别散落字符串字面量

## 代码位置

- src/core/schema.ts:8 STATES（7 态）；schema.ts:40 NODE_TYPES（22 种）；schema.ts:172 FlowError（中文报错基类）
- src/core/store.ts:9 FlowStore；store.ts:71 nextEdgeId
- src/core/graph-ops.ts:69 addNode 起，到 :425 getProjectStatus 共 14 个操作
- src/core/validate.ts:30 validateGraph；validate.ts:15 missingDocs

## 关联

- 上游：所有工具层（[mcp-server](mcp-server.md)、[cli](cli.md)）都调本层
- 下游：[layout](layout.md) 消费 FlowGraph，[render-html](render-html.md) 消费布局结果
