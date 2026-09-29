# Mermaid 导出

> 状态: completed | 建立: 2026-09-29 | 更新: 2026-09-30 | 上次验证: 2026-09-29（npm test + 用户浏览器实测 PNG 下载）

## 为什么做

流程图困在本地 HTML 里，进不了 README / GitHub 文档生态；想贴进文档只能截图，糊且不能跟代码一起 diff。

## 解决什么

`agent-flow export` 一条命令把整张图转成 Mermaid 文本（.flow/flow.mmd）；查看器顶栏「复制 Mermaid」同内容进剪贴板、「下载 PNG」白底 2x 位图。Mermaid 文本贴进 GitHub 代码块自动渲染成图。

## 怎么实现

- `toMermaid(graph)`（src/render/mermaid.ts）纯函数：flowchart LR + 7 个状态 classDef（deprecated 用灰色区分）+ 每模块一个 subgraph，module 节点按 target 递归嵌套
- 节点 id 加 `n<模块ID>_` 前缀防跨模块冲突，id 非法字符替换为 `_`；模块节点的边指向对应 subgraph
- 单一实现两处消费：CLI export 写文件、renderHtml 把结果存进 `DATA.mermaid` 给前端复制按钮——不重复造轮子
- PNG：前端克隆 #cv SVG → 去掉选框/拖拽痕迹 → XMLSerializer → Image → 白底 canvas（2x）→ toBlob 下载

## 怎么扩展

- 要改 Mermaid 样式：只动 classDefLine 的色值映射
- 要加导出格式（如 PlantUML）：新建独立纯函数 + CLI 子命令，别往 toMermaid 里塞
- id 前缀规则别改：下游 class 语句依赖它

## 代码位置

- src/render/mermaid.ts:36 toMermaid（主函数）
- src/index.ts:175 export 子命令（--out 覆盖输出路径）
- src/render/html.ts VIEWER_JS mmdbtn/pngbtn（前端两按钮）

## 关联

- 模块 2 的 P2_export（查看器 PNG 按钮）同属导出能力
- Mermaid 嵌套深度受 validate 的嵌套校验约束
