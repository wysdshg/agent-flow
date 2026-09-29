# CLI 命令行

> 状态: completed | 建立: 2026-09-24 | 更新: 2026-09-30 | 上次验证: 2026-09-29（apply/render/validate/serve/export 实跑通过）

## 为什么做

不是所有环境都能挂 MCP 服务；命令行是保底通道，也让用户能自己跑 serve、看状态。

## 解决什么

`agent-flow init/batch/apply/render/serve/export/status/validate/mcp` 九个命令覆盖建图、改图、渲染、预览、导出全流程。

## 怎么实现

- index.ts 手写参数分发（零依赖，不引 commander），每个命令调与 MCP 相同的 graph-ops
- apply 接 `[{"tool":"add_node","args":{...}}]` JSON 数组，逐条执行并汇报，是 agent 无 MCP 时的主力写入口
- AGENT_FLOW_ROOT 环境变量指定项目根，可在子目录操作
- serve/export 是后加的工作台命令，细节见各自文档

## 怎么扩展

- 加子命令：index.ts 分发处加分支，HELP 文本同步
- 输出面向 agent 的部分保持 JSON，面向人的保持中文一句话

## 代码位置

- src/index.ts（命令分发与参数解析）

## 关联

- 与 [mcp-server](mcp-server.md) 同源同行为；使用规范在 [skill](skill.md)；实时预览见 [serve](serve.md)
