# 冒烟测试（狗粮）

> 状态: completed | 建立: 2026-09-24 | 更新: 2026-09-30 | 上次验证: 2026-09-29（npm test 20/20 通过）

## 为什么做

agent-flow 自己也是 AI 维护的项目，测试要能一条命令验证全链路没被改坏；同时本项目用自己的工具建图（吃自己的狗粮）。

## 解决什么

npm test 跑 20 步冒烟：核心纯函数 + serve 服务 + 文档链路全过一遍，红了就知道哪里改坏。

## 怎么实现

- test/smoke.ts 用 tsx 直跑，step() 逐项断言，任何一步失败立即中止
- 覆盖：toMermaid 输出、parseLocation 三种行号写法、startServe（随机端口/SSE 注入/磁盘纯净/404//open 越界 403）、doc 字段增删、missingDocs 提醒与渲染产物 data-doc/data-loc、docIssues 四类文档头腐烂
- serve 相关测试结尾必须 closeAllConnections() + close()，否则 undici keep-alive 让进程挂起不退出

## 怎么扩展

- 新功能先在这里加失败测试再实现（TDD）
- 涉及文件系统的测试统一走临时目录，别污染项目 .flow

## 代码位置

- test/smoke.ts（20 步）

## 关联

- 测的是 [core-data](core-data.md)、[render-html](render-html.md)、[serve](serve.md) 的公开行为
