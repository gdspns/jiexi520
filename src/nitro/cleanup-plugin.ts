// Nitro 启动插件：服务进程一起来就注册清理调度器。
//
// 为什么不能放在 src/server.ts：那是 SSR 包的入口，只有 SSR 请求（/auth、/admin）
// 才会加载；首页是 public/index.html 静态文件，走不到 SSR，定时器就永远不会启动。
// Nitro 插件在 node-server 产物启动时无条件执行，是唯一可靠的时机。
import { startCleanupScheduler } from "../lib/media-cache.server";

export default function mediaCleanupPlugin() {
  startCleanupScheduler();
}
