# 撤销功能（已规划，未动工）

> 状态: planned | 建立: 2026-09-24 | 更新: 2026-09-30

## 为什么做

agent 一条 delete_node 误删没法反悔；用户手工编辑 flow.json 手滑也没有后悔药。图是唯一数据源，误删代价大。

## 解决什么

给危险写操作（delete_node / delete_edge / batch replace）提供回滚：删错了能回到上一个好状态。

## 怎么实现（拟定方案，未实现）

- 每次写操作前把当前图快照到 .flow/history/，滚动保留最近 N 份
- 提供 undo 工具/命令回退到上一份快照
- 方案对比过：操作日志重放（复杂、怕日志损坏）vs 快照（简单可靠），选快照

## 怎么扩展

- 历史目录加进 .gitignore，避免快照刷屏 git status
- 撤销粒度先做「单次操作」，会话级 undo 栈以后再说

## 代码位置

- 入口预计在 src/core/graph-ops.ts（deleteNode/deleteEdge 前置快照）
- 工具注册在 src/mcp/server.ts 与 src/index.ts

## 关联

- 依赖 [core-data](core-data.md) 的 FlowStore 读写
