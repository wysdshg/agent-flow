<div align="center">

# agent-flow

**Let your AI agent maintain a living flowchart of the project — so you never read 10,000-word status docs again.**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/Protocol-MCP-blue)](https://modelcontextprotocol.io)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)](https://nodejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-ff69b4)](https://github.com/wysdshg/agent-flow/pulls)

[**🎮 Live Demo**](https://wysdshg.github.io/agent-flow/demo.html) · [中文文档](README.zh-CN.md) · [Report Issue](https://github.com/wysdshg/agent-flow/issues)

<img src="docs/screenshots/main.png" alt="agent-flow viewer" width="860">

</div>

---

## The Problem

If you build projects **with AI agents** (Trae, Cursor, Claude Code, ...), you know this loop:

- The agent writes **10,000-word Markdown** progress docs — nobody reads them
- Half the terms it uses you don't understand, so trust erodes
- Weeks in, the project has drifted far from the original plan and **nobody knows what's done, what's broken, and what's waiting on you**

**agent-flow flips this**: the agent maintains a single flowchart (`flow.json`) as it works. You open one HTML file and *see* everything:

- How the project is decomposed and what connects to what
- Which features are done, in progress, or just planned — **7 color-coded states**
- Where the bugs are and which nodes are waiting for your decision

No more reading. Just look.

## How It Works

```text
You ──talk──> AI agent ──calls 14 MCP tools──> .flow/flow.json (single source of truth)
                                                    │
              You <──open in browser── .flow/flow.html (auto-rendered, zero deps)
```

1. **Install once**, register the MCP server in your AI tool
2. **Talk normally**: "add a payment module", "we shipped the login API" — the agent records it into the graph
3. **Open `flow.html`** anytime: zoom, drag, click nodes for details, double-click modules to drill into subgraphs

**Live demo** (no install): [wysdshg.github.io/agent-flow/demo.html](https://wysdshg.github.io/agent-flow/demo.html) — drag nodes, click for details, double-click a module to enter its subgraph.

## Quick Start

```bash
git clone https://github.com/wysdshg/agent-flow.git
cd agent-flow && npm install && npm run build
npm link                # registers the `agent-flow` CLI globally
npx agent-flow init     # inside YOUR project: creates .flow/ and prints MCP config
```

Then add the MCP server to your AI tool (Trae / Claude Desktop / Cursor / any MCP client):

```json
{
  "mcpServers": {
    "agent-flow": {
      "command": "agent-flow",
      "args": ["mcp"]
    }
  }
}
```

> - Claude Code: `claude mcp add agent-flow -- agent-flow mcp`
> - Cursor: put the JSON above in `.cursor/mcp.json`
> - No MCP environment? Use the CLI fallback: `agent-flow batch spec.json` builds the whole graph from one JSON file and renders it.

Now just tell your agent: **"Organize this project's progress into a flowchart"** — and keep talking to it normally while it maintains the graph.

## The 7-State System

Every node carries an honest, test-backed status. The agent is instructed (via the bundled SKILL.md) to only mark `completed` after tests pass:

| State | Color | Meaning |
|---|---|---|
| `completed` | 🟢 green | done and tested |
| `in_progress` | 🔵 light blue | being written now |
| `planned` | 🔷 dark blue | design settled, not started |
| `broken` | 🔴 red | has a bug |
| `to_plan` | ⚪ gray | raw idea, not yet planned |
| `pending_decision` | 🟡 yellow | **waiting for you to decide** |
| `deprecated` | 🟤 brown | abandoned, kept for history |

**Module nodes aggregate their children**: all done → green; one unfinished state → that color; mixed states → the module shows all of them as color segments. Deprecated nodes are ignored — dead code shouldn't raise alarms.

## 22 Node Types

- **Flow**: `start` `end` `process` `judge` `module`
- **Data**: `database` `table` `file` `sql` (tables auto-attach to their database)
- **AI apps**: `llm` `tool_call` `retrieval` `rerank` `assemble` `api` `embedding` `cache` `queue` `prompt` `agent` `human_loop` `checkpoint`

`module / llm / tool_call / agent / assemble` support multi in/out ports. Layout is fully automatic (dagre, left-to-right) — the agent never deals with coordinates.

## Human-in-the-Loop Editing

Drag nodes to rearrange (saved in your browser, never pollutes the JSON the AI reads). Right-click-drag to box-select and move groups. If you change a node's state or delete it in the viewer, it generates a small ops JSON — **paste it back to your agent and it syncs the graph**, always re-reading the latest file first.

## CLI Reference

```bash
agent-flow init                 # init + print MCP config
agent-flow batch spec.json      # one-shot graph build (great for retrofitting old projects)
agent-flow apply ops.json       # run [{"tool":"add_node","args":{...}}, ...]
agent-flow render               # re-layout + refresh flow.html
agent-flow status               # progress overview (JSON)
agent-flow validate             # graph sanity check
agent-flow mcp                  # start the MCP stdio server
```

## Why Not Mermaid / draw.io?

| | Mermaid | draw.io | agent-flow |
|---|---|---|---|
| AI maintains it as it codes | text diffs, merge hell | can't | ✅ 14 typed tools |
| Status colors (7 states) | manual | manual | ✅ built-in semantics |
| Human view | re-render | yes | ✅ zero-dep single HTML |
| Coordinates | manual | manual | ✅ automatic (dagre) |

## Development

```bash
npm run build   # tsc
npm test        # smoke tests (tsx)
```

<div align="center">

**If agent-flow saves you from doc-hell, please give it a ⭐ — it helps other builders find it.**

</div>
