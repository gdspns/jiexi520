## 目标

把前端硬编码的解析 API 配置（`API_ENDPOINT` 和 `API_TOKEN`）迁移到后台管理面板，由管理员在网页里配置；当前默认值作为初始值写入数据库，不影响现有功能。

## 实现步骤

### 1. 数据库（迁移）
在已存在的 `app_settings` 表中新增两条配置：
- `key = 'api_endpoint'`，默认 `"https://v3.alapi.cn/api/video/url"`
- `key = 'api_token'`，默认 `"jerv9kslg8kiuxute89fizcl06m5e1"`

用 `INSERT ... ON CONFLICT DO NOTHING`，不覆盖已有值。

### 2. 后端 server functions（`src/lib/admin.functions.ts`）

新增三个：
- `getApiConfig`（管理员）：返回 `{ endpoint, token }`，从 `app_settings` 读取
- `setApiConfig`（管理员）：入参 `{ endpoint, token }`，upsert 两条记录
- `getPublicApiConfig`（仅需登录，不要 admin）：返回 `{ endpoint, token }` 给前端解析时使用 —— 因为 `app_settings` 表的 RLS 只允许管理员读，普通用户读不到，所以走 server fn 用 `supabaseAdmin` 透出

> 安全说明：这个 token 原本就硬编码在前端 HTML 里，任何访客都能看到，所以通过登录用户可读的接口透出不会降低安全级别；同时也避免在 admin 之外暴露给匿名用户。

### 3. 管理后台 UI（`src/routes/_authenticated/admin.tsx`）

在"开通赠送"区块附近新增「API 配置」卡片：
- 两个输入框：API 接口地址、API 密钥（token 用 password 类型，旁边带"显示/隐藏"切换）
- 一个「保存」按钮
- 一个「恢复默认」按钮（把两个值重置为当前硬编码默认值）
- 加载时调用 `getApiConfig` 填入当前值

### 4. 前端解析逻辑（`public/app.html`）

- 删除硬编码常量 `API_ENDPOINT`、`API_TOKEN`
- 新增模块级缓存 `let apiConfig = null;`
- 新增 `async function loadApiConfig()`：用 `fetch('/_serverFn/...')` 不方便（serverFn 不易在静态 html 里调用），所以改为新增一个 **TanStack server route** `src/routes/api/config.ts`：
  - `GET`，要求带用户 access_token（从 Authorization header 取）
  - 校验 token 后用 `supabaseAdmin` 读 `app_settings` 返回 `{ endpoint, token }`
- `app.html` 已有 Supabase 客户端（用于登录态），在 `fetchVideoDataAPI` 第一次调用前 `await loadApiConfig()`：
  1. 取 `supabase.auth.getSession()` 拿 access_token
  2. `fetch('/api/config', { headers: { Authorization: 'Bearer ' + token }})`
  3. 缓存到 `apiConfig`
- `fetchVideoDataAPI` 内部用 `apiConfig.endpoint` / `apiConfig.token` 替换原常量；其余流程完全不变（包括模拟数据回退分支：当 `apiConfig.token` 为空时仍走 mock）

### 5. 不修改

- 不动认证、credits 扣费、media-proxy、批量下载等
- 默认值与现在硬编码值相同，已登录用户解析行为完全一致

## 验证

1. 管理员登录 → 后台「API 配置」显示当前默认值，可改写、保存、刷新后仍在
2. 普通用户登录 → 解析一条链接 → 走的 endpoint/token 是数据库里那条，能正常解析
3. 管理员把 token 清空保存 → 普通用户解析 → 走 mock 回退分支不报错
4. Network 面板看不到前端源码再硬编码 token
