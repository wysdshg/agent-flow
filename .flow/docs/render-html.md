# HTML 渲染层（零依赖单文件查看器）

> 状态: completed | 建立: 2026-09-24 | 更新: 2026-09-30 | 上次验证: 2026-09-29（npm test 19/19 通过，含渲染产物断言）

## 为什么做

用户不想读几万字 md 进度文档，要「打开一个文件就看懂项目」——渲染产物必须零依赖、双击就能开。

## 解决什么

一张 flow.html：缩放/拖拽/点选详情/双击进子图/面包屑返回/右键框选平移/模块颜色聚合/网页上改状态生成指令 JSON。

## 怎么实现

- renderHtml 把图数据 + 布局坐标内嵌进 HTML，全部脚本在 VIEWER_JS 常量里
- VIEWER_JS 硬约束：它是 TS 模板字符串，禁用反斜杠、反引号、${}，正则等用字符串拼接绕开
- 模块颜色聚合：子模块全完成→绿；单一未完成状态→该色；多种→分色块；deprecated 不计入（死代码不亮红灯）
- 详情面板「位置」「文档」两行的可点链接由 parseLocation 生成：serve 模式走 /open 接口，直接双击走 vscode:// 协议
- PNG 下载：克隆 SVG→清掉选中态→XMLSerializer→白底 canvas 2 倍→toBlob

## 怎么扩展

- 样式/交互都在 VIEWER_JS 里改，注意三大禁用字符
- 已知坑：旧版 Edge 没测过（图中 P3_compat 节点 broken）；小地图是待规划想法（P3_minimap）

## 代码位置

- src/render/html.ts:459 renderHtml
- src/render/html.ts:355 parseLocation

## 关联

- 上游 [layout](layout.md)；跳转细节见 [ide-jump](ide-jump.md)；Mermaid 导出见 [export](export.md)
