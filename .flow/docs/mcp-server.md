# MCP 服务层

> 状态: completed | 建立: 2026-09-24 | 更新: 2026-09-30 | 上次验证: 2026-09-29（npm test 19/19 通过）

## 为什么做

agent 需要结构化的工具入口改图，而不是手拼文件；MCP 是 Trae/Claude/Cursor 的通用协议。

## 解决什么

14 个工具注册到 stdio MCP 服务：AI 会话里直接 add_node/update_node/validate_graph/render_html，改完即时落盘生效。

## 怎么实现

- startMcp 起 stdio server，工具 handler 调 graph-ops 纯函数 → FlowStore 落盘 → 自动 render_html
- 报错全中文大白话（FlowError），agent 收到能自己改参数重试
- validate_graph 除硬错误外附带 docWarnings（缺失的功能文档清单）+ hint，提醒 agent 补文档

## 怎么扩展

- 新工具三处同步：graph-ops 纯函数 → schema.ts zod schema → server.ts 注册
- 工具描述是写给 AI 看的，要包含「什么时候该用我」

## 代码位置

- src/mcp/server.ts:73 startMcp（工具注册）
- src/core/schema.ts:136 addNodeSchema 等各工具入参定义

## 关联

- 调 [core-data](core-data.md)；CLI 是同能力降级通道（[cli](cli.md)）
