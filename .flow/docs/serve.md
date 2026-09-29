# serve 实时预览

## 为什么做

agent 改完图后，用户必须手动重新打开 flow.html 才能看到新图；改一次开一次，验证节奏被打断。参考 gitdiagram 的实时网页体验补上这一环。

## 解决什么

用户跑 `agent-flow serve` 后浏览器常驻一个预览页：agent 每次改 flow.json，页面 1 秒内自动刷新，无需任何手动操作。

## 怎么实现

- `startServe`（src/serve/serve.ts:64）基于 node:http：`GET /` 返回 flow.html 并在响应内存注入 SSE 脚本（`window.__SERVE__=1` + EventSource），磁盘文件保持纯净；`GET /events` 是 SSE 流，25s 心跳防断连
- `fs.watch` 监听整个 `.flow` 目录（规避单文件 watch 平台差异），flow.json 变化 → 防抖 300ms → load → layout → renderHtml → saveHtml → 广播 reload
- 选 `fs.watch` 目录监听 + 防抖，是因为保存类工具常触发多次事件；watch 句柄随 server.close 释放，否则测试进程挂起
- 布局坐标 localStorage 按 `DATA.hash` 隔离，图一变 hash 变，自动回落到新自动布局，无脏坐标

## 怎么扩展

- 加新路由：在 http.createServer 回调里按 `url` 分发，保持零依赖
- 要改注入脚本：改 `RELOAD_SCRIPT` 常量；注入只发生在内存响应，别把脚本写进磁盘 flow.html

## 代码位置

- src/serve/serve.ts:31 openInIde（IDE CLI 拉起链）
- src/serve/serve.ts:64 startServe（HTTP + watch + SSE）
- src/index.ts:157 serve 子命令参数解析

## 关联

- 跳转链接的 serve 模式依赖本模块注入的 `__SERVE__` 标志 → [ide-jump](ide-jump.md)
- 首次访问时若 flow.html 不存在会自动渲染一次
