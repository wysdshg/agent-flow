# agent-flow

给 AI agent 用的项目进度/流程可视化插件（MCP server）。

**解决的问题**：项目做久了，AI 写的几万字 Markdown 文档没人看得下去，专业术语一堆，到底做到哪了全靠猜。agent-flow 让 agent 在开发过程中用工具维护一张流程图，你随时用浏览器打开一张图，就能看懂：

- 项目拆成了哪几块，每块什么关系
- 每个功能做到哪一步了（7 种颜色状态）
- 哪里有 bug、哪里在等你拍板

## 快速开始

```bash
git clone https://github.com/wysdshg/agent-flow.git
cd agent-flow
npm install
npm run build
npm link                     # 全局注册 agent-flow 命令
npx agent-flow init          # 在你的项目里执行：生成 .flow/ 并打印 MCP 配置
```

### 接入 MCP 客户端（Trae / Claude Desktop / Cursor 等）

`init` 会打印配置片段，把其中的路径换成你本机的 clone 路径即可：

```json
{
  "mcpServers": {
    "agent-flow": {
      "command": "node",
      "args": ["<本仓库路径>/dist/index.js", "mcp"]
    }
  }
}
```

> 已 `npm link` 的话也可以用 `"command": "agent-flow", "args": ["mcp"]`。
> 指定项目根目录：设置环境变量 `AGENT_FLOW_ROOT`（默认为进程工作目录）。

之后对 agent 说"整理一下这个项目的流程"或正常开发即可，agent 会通过 14 个工具维护 `.flow/flow.json` 并渲染 `.flow/flow.html`。

### CLI 降级通道（没有 MCP 环境时）

```bash
agent-flow init                 # 初始化 + 打印 MCP 配置
agent-flow batch spec.json      # 从 JSON spec 一次性建图（整理旧项目），自动渲染
agent-flow apply ops.json       # 依次执行 [{"tool":"add_node","args":{...}},...]
agent-flow render               # 重新布局并刷新 flow.html
agent-flow status               # 进度总览（JSON）
agent-flow validate             # 校验图合法性
agent-flow mcp                  # 启动 MCP stdio 服务
```

示例 spec 见 [examples/demo.flow.json](examples/demo.flow.json)，跑一下看效果：

```bash
mkdir -p /tmp/demo && cd /tmp/demo
agent-flow batch <本仓库>/examples/demo.flow.json
# 用浏览器打开 .flow/flow.html
```

## 状态体系（固定 7 色）

| 状态 | 颜色 | 含义 |
|---|---|---|
| completed | 🟢 绿 | 写完且测试通过 |
| in_progress | 🔵 浅蓝 | 正在写 |
| planned | 🔷 深蓝 | 方案已定，还没动手 |
| broken | 🔴 红 | 有 bug |
| to_plan | ⚪ 灰 | 待规划的想法 |
| pending_decision | 🟡 黄 | 需要用户拍板 |
| deprecated | 🟤 棕 | 已废弃 |

## 节点类型（22 种）

- 流程：`start` `end` `process` `judge` `module`
- 数据资源：`database` `table` `file` `sql`
- AI 应用：`llm` `tool_call` `retrieval` `rerank` `assemble` `api` `embedding` `cache` `queue` `prompt` `agent` `human_loop` `checkpoint`

`module / llm / tool_call / agent / assemble` 支持多输入/输出端口；`table / sql` 绑定 `database` 节点（自动挂在其下方）；`module` 节点双击可跳转子模块画布。布局由 dagre 自动完成（从左到右），无需坐标。

## 查看器功能

单文件 `flow.html`，零依赖，双击即开：滚轮缩放、拖拽平移、节点详情侧栏（含代码定位）、双击 module 进子图（面包屑返回）、状态统计面板、图内节点拖动（会话内临时）。

## 文件结构

```
.flow/
  flow.json    # 唯一数据源（进 git，团队/agent 共享）
  flow.html    # 渲染产物（建议进 git，方便直接看）
skill/SKILL.md # 给 agent 看的使用规范（配 skill 时引用它）
src/
  core/        # schema / 存储 / 14 个图操作纯函数 / 校验
  layout/      # dagre 自动布局
  render/      # 单文件 HTML 查看器生成
  mcp/         # MCP stdio server（14 工具）
  index.ts     # CLI 入口
```

## 开发

```bash
npm run build   # tsc 构建
npm test        # 冒烟测试（tsx）
```
