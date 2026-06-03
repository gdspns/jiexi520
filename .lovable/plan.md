## 目标

修复"解析音频后无法在线播放、无法下载 MP3 / 无水印视频"。

## 根因

抖音 / 小红书等平台返回的 `music_url` / `video_url` 指向其自家 CDN：
1. 浏览器直接给 `<audio src="...">` 会触发跨域 + Referer 防盗链 → 不播放
2. `downloadMedia()` 用 `fetch()` 拉流被 CORS 拦截，退回到 `corsproxy.io` 等公共代理；这些代理对大文件和强防盗链 CDN 经常 403、超时或被封 → 显示"防盗链极严格"

## 方案

新增一个**自家后端媒体代理**，由我们的 Worker 去拉远端媒体并流式返回，附带正确的 `Referer` / `User-Agent`，对浏览器开放 CORS。前端所有播放/下载都改走这个代理。

### 1. 新建服务端代理路由

文件：`src/routes/api/public/media-proxy.ts`（放 `/api/public/*` 下，外部回调不需要登录；用 GET）

要点：
- 入参：`?url=<远端媒体直链>`
- 校验 URL：只允许 `http(s)://`，拒绝本机/内网地址（防 SSRF）
- 根据 host 设置合适的 Referer，例如：
  - `*.douyin.com` / `aweme*` / `*.bytecdn` → `Referer: https://www.douyin.com/`
  - `*.xhscdn.com` / `*.xiaohongshu.com` → `Referer: https://www.xiaohongshu.com/`
  - 其它默认不带 Referer
- `User-Agent` 用一个标准桌面 Chrome UA
- 透传客户端的 `Range` 头，并把远端返回的 `Content-Type` / `Content-Length` / `Content-Range` / `Accept-Ranges` 透传回去（让 `<audio>` 能 seek）
- 响应头加：
  - `Access-Control-Allow-Origin: *`
  - `Cache-Control: public, max-age=3600`
- 用 `response.body`（ReadableStream）直接 pipe，不要 `arrayBuffer()`，避免大文件占内存
- 同时实现 `OPTIONS` 预检

### 2. 前端改造 `public/app.html`

新增一个 helper：

```js
function proxify(u) {
  if (!u) return u;
  return '/api/public/media-proxy?url=' + encodeURIComponent(u);
}
```

修改点：
- `renderSingleResult`：`player.src = proxify(data.music_url)`，让在线试听走代理
- `弹窗视频播放器`处（约 854 行附近）：视频试看也用 `proxify(data.video_url)`
- `downloadMedia()`：把 `smartFetch(url)` 改为 `fetch(proxify(url))`，并删除/降级 `smartFetch` 中的公共代理回退（保留一次直连兜底即可）
- 批量下载 `triggerBatchDownload` 内的 `fetch` 也改走 `proxify(...)`
- 失败提示文案保留，但不再常态触发

### 3. 不修改内容

- 不动认证、次数扣费、admin 等已有逻辑
- 不动 `fetchVideoDataAPI` 解析接口本身

## 验证

1. 解析一条抖音/小红书链接 → 顶部音频条点播放，能听到声音、进度条能拖动
2. 点【下载真MP3音频】→ 浏览器下载到 `.mp3`，能正常播放
3. 点【下载无水印视频】→ 下载到 `.mp4`，能正常播放
4. 批量下载 5 条 → 全部成功，不再出现"防盗链被阻断"提示
5. 检查 Network：媒体请求都走 `/api/public/media-proxy?url=...`，状态 200/206
