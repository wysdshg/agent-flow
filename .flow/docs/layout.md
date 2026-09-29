# 自动布局层

> 状态: completed | 建立: 2026-09-24 | 更新: 2026-09-30 | 上次验证: 2026-09-29（npm test 19/19 通过）

## 为什么做

让 AI 直接给坐标又费 token 又摆不齐；布局必须是工具的事，AI 只描述「谁连谁」。

## 解决什么

任意拓扑的图自动从左到右排好：节点不重叠、连线清晰、数据表自动挂在所属数据库下方。

## 怎么实现

- dagre（唯一 npm 依赖）做分层布局，方向 LR
- estimateSize 按名称/描述文字长度（中英文分开算宽）与表字段数估节点宽高，先量后排
- table/sql 节点绑定 dbNodeId 时，布局约束在其数据库节点正下方
- 前端把用户拖动后的坐标存 localStorage（按图 hash 隔离），不回写 JSON

## 怎么扩展

- 换布局引擎只需替换 layoutGraph 内部实现，签名不变
- 新节点类型要给 estimateSize 补尺寸估算分支，否则走默认尺寸

## 代码位置

- src/layout/dagre.ts:34 estimateSize
- src/layout/dagre.ts:73 layoutGraph

## 关联

- 输入来自 [core-data](core-data.md) 的 FlowGraph，输出给 [render-html](render-html.md)
- 手写坐标方案已废弃（图中 OLD_manual 节点）
