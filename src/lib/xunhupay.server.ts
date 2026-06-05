import crypto from "node:crypto";

export type Channel = "wechat" | "alipay";

export interface XunhupayConfig {
  wechat_appid: string;
  wechat_appsecret: string;
  wechat_enabled: boolean;
  alipay_appid: string;
  alipay_appsecret: string;
  alipay_enabled: boolean;
  api_endpoint: string;
}

export function getCreds(cfg: XunhupayConfig, channel: Channel) {
  if (channel === "wechat") {
    return { appid: cfg.wechat_appid, appsecret: cfg.wechat_appsecret, enabled: cfg.wechat_enabled };
  }
  return { appid: cfg.alipay_appid, appsecret: cfg.alipay_appsecret, enabled: cfg.alipay_enabled };
}

function md5(s: string) {
  return crypto.createHash("md5").update(s, "utf8").digest("hex");
}

// 虎皮椒签名: 按 key 字典升序排序，过滤空值与 hash 字段，组装 k=v&k=v ，末尾拼接 appsecret，MD5
export function sign(params: Record<string, string | number>, appsecret: string): string {
  const keys = Object.keys(params)
    .filter((k) => k !== "hash" && params[k] !== "" && params[k] !== undefined && params[k] !== null)
    .sort();
  const str = keys.map((k) => `${k}=${params[k]}`).join("&");
  return md5(str + appsecret);
}

export function verifySign(params: Record<string, any>, appsecret: string): boolean {
  const incoming = String(params.hash || "");
  if (!incoming) return false;
  const clone: Record<string, string | number> = {};
  for (const k of Object.keys(params)) {
    if (k === "hash") continue;
    const v = params[k];
    if (v === "" || v === undefined || v === null) continue;
    clone[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
  }
  return sign(clone, appsecret) === incoming;
}

export interface CreateOrderInput {
  cfg: XunhupayConfig;
  channel: Channel;
  orderNo: string;
  amountCents: number;
  title: string;
  notifyUrl: string;
  returnUrl: string;
  clientIp?: string;
}

export interface CreateOrderResult {
  qr_url: string | null; // 用于渲染二维码（weixin:// 或 alipay scheme / http）
  wap_url: string | null; // 用于 H5 跳转
  raw: any;
}

export async function createXunhupayOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const { cfg, channel, orderNo, amountCents, title, notifyUrl, returnUrl, clientIp } = input;
  const creds = getCreds(cfg, channel);
  if (!creds.enabled) throw new Error(`${channel === "wechat" ? "微信" : "支付宝"}支付未启用`);
  if (!creds.appid || !creds.appsecret) throw new Error("支付参数未配置，请联系管理员");

  const totalFee = (amountCents / 100).toFixed(2);

  const params: Record<string, string | number> = {
    version: "1.1",
    appid: creds.appid,
    trade_order_id: orderNo,
    total_fee: totalFee,
    title: title.slice(0, 32),
    time: Math.floor(Date.now() / 1000),
    notify_url: notifyUrl,
    return_url: returnUrl,
    nonce_str: Math.random().toString(36).slice(2, 12),
    type: "WAP",
    wap_url: returnUrl,
    wap_name: title.slice(0, 16),
    payment: channel === "wechat" ? "wechat" : "alipay",
  };
  // attach 是商户自定义透传字段，留空避免干扰签名
  void clientIp;

  const hash = sign(params, creds.appsecret);
  const body = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => body.append(k, String(v)));
  body.append("hash", hash);

  const defaultEndpoint =
    channel === "alipay"
      ? "https://api.xunhupay.com/payment/do.html"
      : "https://api.xunhupay.com/payment/do.html";
  const res = await fetch(cfg.api_endpoint || defaultEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("虎皮椒响应格式异常: " + text.slice(0, 200));
  }
  if (data.errcode !== 0) {
    const detail = data.errmsg || data.hint || JSON.stringify(data);
    throw new Error(
      `虎皮椒下单失败(${channel}): ${detail}` +
        ` [appid=${creds.appid?.slice(0, 4)}***, total_fee=${totalFee}, order=${orderNo}]`
    );
  }
  return {
    qr_url: data.url_qrcode || data.url || null,
    wap_url: data.url || data.url_qrcode || null,
    raw: data,
  };
}