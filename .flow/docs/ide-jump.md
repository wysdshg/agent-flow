# IDE 跳转与功能文档

## 为什么做

节点详情里的"代码定位"原本是纯文本+复制按钮，用户要手动在 IDE 里找文件找行；功能的设计决策更是散落在对话里，换个人（或换个会话的 AI）就丢了。

## 解决什么

详情面板两个链接：`文件名:行号 ↗` 在 IDE 打开对应代码行；`功能文档 ↗` 直接打开该功能的 md 设计文档。图=索引、md=正文、代码=源头。

## 怎么实现

- 解析在 Node 侧：`parseLocation`（src/render/html.ts:320）按 `;` 拆段，支持 `a.ts:12` / `a.ts 12` / `README.md 20-50行` 三种行号写法，相对路径拼 root 成绝对路径；放在 Node 侧是为了避开 VIEWER_JS 禁用正则转义的约束
- serve 模式：前端 fetch `/open?path=&line=`（src/serve/serve.ts:117），服务端按顺序试 trae/trae-cn/code/cursor 等 CLI 用 `-g file:line` 拉起；只允许项目根内路径，越界 403
- 非 serve 模式（双击打开）：`vscode://file/` 协议兜底（本机需注册协议处理器，否则静默失败）
- `doc` 字段（src/core/schema.ts:87）挂功能 md 路径，`missingDocs`（src/core/validate.ts:15）在 validate 时软提醒文档缺失

## 怎么扩展

- 新增 IDE：往 openInIde 的候选数组加 CLI 名或绝对路径即可
- 新增行号写法：只改 parseLocation 的正则，前端零改动
- `/open` 只为本地服务，别暴露到公网（无鉴权，按 YAGNI 未做）

## 代码位置

- src/render/html.ts:320 parseLocation（三种行号写法）
- src/serve/serve.ts:117 /open 路由（越界拒绝）
- src/serve/serve.ts:31 openInIde（IDE 候选链）
- src/core/validate.ts:15 missingDocs（文档缺失软提醒）

## 关联

- 依赖 [serve](serve.md) 注入的 `__SERVE__` 标志区分两种打开方式
- 功能文档规范见 skill/SKILL.md「功能文档（doc 字段）」
