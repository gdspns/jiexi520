# 虎皮椒支付 + 充值商品系统

## 一、数据库变更（一次迁移）

新增表：
- `payment_config` — 虎皮椒配置（单行 key=default）
  - `wechat_appid`, `wechat_appsecret`, `wechat_enabled`
  - `alipay_appid`, `alipay_appsecret`, `alipay_enabled`
  - `api_endpoint`（默认 `https://api.xunhupay.com/payment/do.html`）
- `recharge_products` — 商品
  - `id`, `name`, `price`(分), `credits`, `discount_price`(分, 可空), `enabled`, `sort_order`
- `payment_orders` — 订单（防止刷新丢次数的核心）
  - `id`(uuid), `order_no`(唯一), `user_id`, `product_id`, `credits`, `amount`(分), `channel`('wechat'|'alipay'), `status`('pending'|'paid'|'expired'|'failed'), `qr_url`, `wap_url`, `trade_order_id`(虎皮椒返回), `paid_at`, `created_at`, `expires_at`

RLS：
- `payment_config` / `recharge_products`：管理员可写；`recharge_products` 已启用项所有登录用户可读；`payment_config` 仅管理员可读
- `payment_orders`：用户只能查/读自己的订单；服务端（service_role）回写状态

`recharge_products` 写一个 `update_updated_at` 触发器即可。

## 二、后端 Server Functions（`src/lib/payment.functions.ts`）

管理员相关：
- `getPaymentConfig` / `setPaymentConfig`
- `listProductsAdmin` / `upsertProduct` / `deleteProduct`

用户相关：
- `listProducts` — 返回 enabled 商品
- `createRechargeOrder({ productId, channel })`
  1. 校验登录 + 商品 enabled
  2. 生成 `order_no = LV + timestamp + 6位随机`
  3. 按虎皮椒签名规则（MD5，参数按 key 字典序拼接 + `&key=appsecret`）POST 到 `api.xunhupay.com/payment/do.html`
     - `type=WAP` 用于支付宝 H5；微信走 `type=WAP` 或扫码返回 url 渲染二维码
     - `notify_url` → `/api/public/xunhupay-notify`
     - `return_url` → `/recharge/result?order_no=...`
  4. 落库 `payment_orders`（status=pending, expires_at=now+20min），返回 `{ order_no, qr_url, wap_url, expires_at }`
- `getOrderStatus({ order_no })` — 前端轮询；只读自己的订单

## 三、Public 路由

- `src/routes/api/public/xunhupay-notify.ts`（POST）
  1. 解析表单/JSON，按虎皮椒签名规则验签（用对应渠道的 appsecret）
  2. 幂等：若订单已 paid 直接返回 `success`
  3. 标记 `status=paid` + `paid_at` + `trade_order_id`
  4. 用 `supabaseAdmin` 给用户 `profiles.credits += credits`（原子 update + RETURNING）
  5. 返回纯文本 `success`

## 四、前端

管理员后台（`src/routes/_authenticated/admin.tsx` 新增两个 section）：
- **支付配置**：微信/支付宝两组 appid+appsecret+启用开关 + 保存
- **充值商品管理**：表格 + 行内编辑（名称、原价、次数、折扣价、启用、排序）+ 新增/删除

用户端：
- 顶部新增「充值」入口（已登录显示）→ 打开 `<RechargeDialog />`
- Dialog 展示商品卡片（显示原价/折扣价/赠送次数/单价折扣百分比），点选后进入支付方式选择（微信/支付宝，只显示已启用渠道）
- 创建订单后进入 `<PaymentWaiting />`：
  - 顶部 20 分钟倒计时（基于 `expires_at`）
  - 居中二维码（`qr_url`，用 `qrcode` 库本地渲染避免外链）
  - 下方「H5 跳转支付」按钮（`window.location = wap_url`，移动端可直接拉起）
  - 每 3 秒调用 `getOrderStatus` 轮询；status=paid → 提示成功 + 调用 `refreshCredits` 刷新顶部次数 + 关闭
- 防刷新丢单：订单状态在数据库，刷新后通过 URL `?order_no=` 或 localStorage 恢复等待页

## 五、密钥与签名

- 虎皮椒签名：`md5( sort(params).join('&') + appsecret )`，appsecret 即配置的"密钥"
- 所有签名/请求只在 server fn 里执行，appsecret 永不出现在前端
- 不需要 secrets 工具：商户号/密钥由管理员从后台 UI 填入，存 `payment_config` 表

## 六、依赖

`bun add qrcode @types/qrcode`（前端二维码渲染）

## 技术要点

- 订单号唯一索引保证幂等
- `xunhupay-notify` 走 `/api/public/*` 绕过 auth
- 加分逻辑只在 notify 中执行一次（基于订单 status 切换 + 唯一约束），轮询接口不加分
- 倒计时用 `expires_at - now`，刷新不重置
- 商品列表对所有登录用户开放读，避免每次走 server fn

## 不做的事

- 不做退款、对账、发票
- 不做支付密码/二次验证
- 不发邮件通知

## 实施顺序

1. 迁移（建表 + RLS + GRANT）
2. `payment.functions.ts` + notify 路由 + 装 qrcode
3. 管理员后台两个 section
4. 前端充值入口 + Dialog + 等待页 + 顶部次数刷新

确认无误后我就开始动工。