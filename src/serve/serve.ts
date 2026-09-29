/**
 * agent-flow serve：本地实时预览。
 * - GET /        返回 flow.html，响应内存中注入 SSE 自动刷新脚本（磁盘文件保持纯净）
 * - GET /events  SSE 流，图变更后广播 reload，浏览器 location.reload()
 * - fs.watch(.flow 目录)，flow.json 变化 → 防抖 300ms → load→布局→渲染→落盘 → 广播
 * 零依赖：全部基于 node:http / node:fs / node:child_process。
 */
import fs from "node:fs";
import http from "node:http";
import { spawn } from "node:child_process";
import { FlowStore } from "../core/store.js";
import { layoutGraph } from "../layout/dagre.js";
import { renderHtml } from "../render/html.js";

export interface ServeOptions {
  /** 端口，默认 3457；0 表示随机可用端口（测试用） */
  port?: number;
  /** 启动后自动拉起浏览器，默认 true */
  open?: boolean;
}

const RELOAD_SCRIPT =
  '<script>(function(){var es=new EventSource("/events");es.onmessage=function(){location.reload();};})();</script>';

export async function startServe(
  store: FlowStore,
  opts: ServeOptions = {},
): Promise<{ server: http.Server; port: number; url: string }> {
  // 首次启动若还没渲染过，先出一份 flow.html
  if (!fs.existsSync(store.htmlFile)) {
    const graph = store.load();
    store.saveHtml(renderHtml(graph, layoutGraph(graph), store.root));
  }

  const clients = new Set<http.ServerResponse>();
  let debounceTimer: NodeJS.Timeout | null = null;

  const rerender = (): void => {
    try {
      const graph = store.load();
      store.saveHtml(renderHtml(graph, layoutGraph(graph), store.root));
    } catch (e) {
      console.error("重渲染失败：" + (e instanceof Error ? e.message : String(e)));
    }
    for (const res of clients) res.write("data: reload\n\n");
  };

  const server = http.createServer((req, res) => {
    const url = (req.url || "/").split("?")[0];
    if (url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(": connected\n\n");
      clients.add(res);
      const beat = setInterval(() => res.write(": ping\n\n"), 25000); // 心跳防代理断连
      req.on("close", () => {
        clearInterval(beat);
        clients.delete(res);
      });
      return;
    }
    if (url === "/" || url === "/index.html") {
      try {
        const html = fs.readFileSync(store.htmlFile, "utf-8");
        // 锚点 </body> 全文仅结尾一处（数据里的 < 已转义、VIEWER_JS 无该字样）
        const body = html.replace("</body>", RELOAD_SCRIPT + "</body>");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(body);
      } catch {
        res.writeHead(500);
        res.end("flow.html 读取失败，请运行 agent-flow render");
      }
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error("端口被占用，请换一个端口：agent-flow serve --port 3458");
      process.exit(1);
    }
    throw err;
  });

  const port = opts.port ?? 3457;
  await new Promise<void>((resolve) => server.listen(port, () => resolve()));

  // 监听目录而非单文件，规避部分平台单文件 watch 不触发的问题
  let watcher: fs.FSWatcher | null = null;
  try {
    watcher = fs.watch(store.flowDir, (_event, filename) => {
      if (filename && filename !== "flow.json") return; // filename 为 null 的平台放行
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(rerender, 300);
    });
  } catch (e) {
    console.warn(
      "文件监听不可用（" + (e instanceof Error ? e.message : String(e)) + "），自动刷新失效，可手动刷新浏览器",
    );
  }

  // 服务关闭时释放 watch 与 SSE 连接，保证进程能正常退出
  server.on("close", () => {
    watcher?.close();
    for (const res of clients) res.end();
    clients.clear();
  });

  const realPort = (server.address() as { port: number }).port;
  const url = "http://localhost:" + realPort + "/";
  console.log("agent-flow serve 已启动：" + url);
  console.log("agent 改图后浏览器会自动刷新（监听 " + store.flowDir + "）");
  console.log("Ctrl+C 退出");

  if (opts.open !== false) {
    try {
      const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
      const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
      const child = spawn(cmd, args, { stdio: "ignore", detached: true });
      child.on("error", () => console.warn("自动打开浏览器失败，请手动访问 " + url));
      child.unref();
    } catch {
      console.warn("自动打开浏览器失败，请手动访问 " + url);
    }
  }

  return { server, port: realPort, url };
}
