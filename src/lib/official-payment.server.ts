import crypto from "node:crypto";

export type OfficialConfig = Record<string, any>;

const ALIPAY_GATEWAY = "https://openapi.alipay.com/gateway.do";
const WECHAT_API = "https://api.mch.weixin.qq.com";

function pem(value: string, type: "PRIVATE KEY" | "PUBLIC KEY") {
  if (value.includes("BEGIN")) return value;
  const lines = value.replace(/\s/g, "").match(/.{1,64}/g)?.join("\n") || "";
  return `-----BEGIN ${type}-----\n${lines}\n-----END ${type}-----`;
}

function sign(content: string, privateKey: string) {
  const signer = crypto.createSign("RSA-SHA256"); signer.update(content, "utf8"); signer.end();
  return signer.sign(crypto.createPrivateKey(pem(privateKey, "PRIVATE KEY")), "base64");
}

function alipayContent(params: Record<string, any>, callback = false) {
  return Object.keys(params).filter(k => k !== "sign" && (!callback || k !== "sign_type") && params[k] !== "").sort().map(k => `${k}=${params[k]}`).join("&");
}

/** 支付宝要求的 timestamp：yyyy-MM-dd HH:mm:ss（北京时间） */
function alipayTimestamp() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date()).replace("T", " ");
}

/** 组装并签名一次支付宝 openapi 请求（公共参数 + 业务参数） */
function alipayRequestParams(cfg: OfficialConfig, method: string, bizContent: Record<string, any>, extra: Record<string, string> = {}) {
  if (!cfg.official_alipay_app_id || !cfg.official_alipay_private_key) throw new Error("支付宝官方商户配置未完成");
  const params: Record<string, string> = {
    app_id: cfg.official_alipay_app_id,
    method,
    format: "JSON",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: alipayTimestamp(),
    version: "1.0",
    biz_content: JSON.stringify(bizContent),
    ...extra,
  };
  for (const k of Object.keys(params)) if (params[k] === "" || params[k] == null) delete params[k];
  params.sign = sign(alipayContent(params), cfg.official_alipay_private_key);
  return params;
}

async function alipayPost(params: Record<string, string>) {
  const response = await fetch(ALIPAY_GATEWAY, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: new URLSearchParams(params),
  });
  const text = await response.text();
  try {
    return { ok: response.ok, status: response.status, payload: JSON.parse(text) };
  } catch {
    throw new Error("支付宝响应格式异常: " + text.slice(0, 200));
  }
}

export async function createOfficialAlipay(cfg: OfficialConfig, input: { orderNo: string; amountCents: number; title: string; notifyUrl: string }) {
  // 支付宝公钥只用于校验异步通知；没填也能下单（靠主动查单兜底），这里只提示不拦截
  if (!cfg.official_alipay_public_key) {
    console.warn("[official-payment] 未配置支付宝公钥，异步通知将无法验签，将由主动查单兜底到账");
  }
  const params = alipayRequestParams(cfg, "alipay.trade.precreate", {
    out_trade_no: input.orderNo,
    total_amount: (input.amountCents / 100).toFixed(2),
    subject: input.title.slice(0, 256),
    timeout_express: "20m",
  }, { notify_url: input.notifyUrl });

  const { ok, payload } = await alipayPost(params);
  const result: any = payload.alipay_trade_precreate_response || {};
  if (!ok || result.code !== "10000" || !result.qr_code) {
    throw new Error([result.sub_msg, result.sub_code, result.msg].filter(Boolean).join(" / ") || "支付宝官方下单失败");
  }
  const qr: string = result.qr_code;
  return {
    // 官方返回的是「待编码内容」，前端必须用二维码库生成图片
    qr_url: qr,
    // 支付宝的 qr_code 本身就是 https://qr.alipay.com/xxx，手机浏览器可直接打开拉起 App
    wap_url: /^https?:\/\//i.test(qr) ? qr : null,
  };
}

/** 微信支付 v3 请求签名（method\npath\ntimestamp\nnonce\nbody\n） */
function wechatAuthorization(cfg: OfficialConfig, method: string, path: string, body: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString("hex");
  const signature = sign(`${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`, cfg.official_wechat_private_key);
  return `WECHATPAY2-SHA256-RSA2048 mchid="${cfg.official_wechat_mch_id}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${cfg.official_wechat_serial_no}",signature="${signature}"`;
}

export async function createOfficialWechat(cfg: OfficialConfig, input: { orderNo: string; amountCents: number; title: string; notifyUrl: string }) {
  if (!cfg.official_wechat_app_id || !cfg.official_wechat_mch_id || !cfg.official_wechat_serial_no || !cfg.official_wechat_private_key || !cfg.official_wechat_api_v3_key || !cfg.official_wechat_platform_public_key) throw new Error("微信官方商户配置未完成");
  const path = "/v3/pay/transactions/native";
  const body = JSON.stringify({ appid: cfg.official_wechat_app_id, mchid: cfg.official_wechat_mch_id, description: input.title.slice(0, 127), out_trade_no: input.orderNo, notify_url: input.notifyUrl, amount: { total: input.amountCents, currency: "CNY" } });
  const response = await fetch(`${WECHAT_API}${path}`, {
    method: "POST",
    headers: { Authorization: wechatAuthorization(cfg, "POST", path, body), Accept: "application/json", "Content-Type": "application/json" },
    body,
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok || !payload.code_url) throw new Error(payload.message || "微信官方下单失败");
  // code_url 为 weixin://wxpay/bizpayurl?pr=xxx，手机端可直接尝试拉起微信
  return { qr_url: payload.code_url, wap_url: String(payload.code_url).startsWith("weixin://") ? payload.code_url : null };
}

/** 主动查单（支付宝）：异步通知不可达时，用它兜底确认支付结果 */
export async function queryOfficialAlipay(cfg: OfficialConfig, orderNo: string) {
  const params = alipayRequestParams(cfg, "alipay.trade.query", { out_trade_no: orderNo });
  const { ok, payload } = await alipayPost(params);
  const result: any = payload.alipay_trade_query_response || {};
  if (!ok || result.code !== "10000") {
    return { paid: false, amountCents: 0, tradeId: "", pending: true, reason: result.sub_msg || result.sub_code || result.msg || `HTTP ${ok ? 200 : "err"}` };
  }
  const status = String(result.trade_status || "");
  return {
    paid: status === "TRADE_SUCCESS" || status === "TRADE_FINISHED",
    amountCents: Math.round(Number(result.total_amount || 0) * 100),
    tradeId: String(result.trade_no || ""),
    pending: status === "WAIT_BUYER_PAY",
    reason: status || "unknown",
  };
}

/** 主动查单（微信 v3）：订单不存在会返回 404，视为未支付 */
export async function queryOfficialWechat(cfg: OfficialConfig, orderNo: string) {
  const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderNo)}?mchid=${encodeURIComponent(cfg.official_wechat_mch_id)}`;
  const response = await fetch(`${WECHAT_API}${path}`, {
    method: "GET",
    headers: { Authorization: wechatAuthorization(cfg, "GET", path, ""), Accept: "application/json" },
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { paid: false, amountCents: 0, tradeId: "", pending: true, reason: payload.message || payload.code || `HTTP ${response.status}` };
  }
  if (payload.mchid && payload.mchid !== cfg.official_wechat_mch_id) {
    return { paid: false, amountCents: 0, tradeId: "", pending: false, reason: "商户号不匹配" };
  }
  if (payload.appid && cfg.official_wechat_app_id && payload.appid !== cfg.official_wechat_app_id) {
    return { paid: false, amountCents: 0, tradeId: "", pending: false, reason: "AppID 不匹配" };
  }
  return {
    paid: payload.trade_state === "SUCCESS",
    amountCents: Number(payload.amount?.total || 0),
    tradeId: String(payload.transaction_id || ""),
    pending: ["NOTPAY", "USERPAYING"].includes(String(payload.trade_state || "")),
    reason: payload.trade_state || "unknown",
  };
}

export function verifyAlipayCallback(params: Record<string, any>, publicKey: string) {
  if (!publicKey) return false;
  const verifier = crypto.createVerify("RSA-SHA256"); verifier.update(alipayContent(params, true), "utf8"); verifier.end();
  return verifier.verify(crypto.createPublicKey(pem(publicKey, "PUBLIC KEY")), String(params.sign || "").replace(/ /g, "+"), "base64");
}

export function verifyWechatCallback(raw: string, headers: Headers, publicKey: string) {
  if (!publicKey) return false;
  const timestamp = headers.get("Wechatpay-Timestamp") || "", nonce = headers.get("Wechatpay-Nonce") || "", signature = headers.get("Wechatpay-Signature") || "";
  if (!signature) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const verifier = crypto.createVerify("RSA-SHA256"); verifier.update(`${timestamp}\n${nonce}\n${raw}\n`, "utf8"); verifier.end();
  return verifier.verify(crypto.createPublicKey(pem(publicKey, "PUBLIC KEY")), signature, "base64");
}

export function decryptWechatResource(resource: any, apiV3Key: string) {
  const data = Buffer.from(resource.ciphertext, "base64"), tag = data.subarray(data.length - 16), encrypted = data.subarray(0, data.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(apiV3Key, "utf8"), Buffer.from(resource.nonce, "utf8"));
  decipher.setAAD(Buffer.from(resource.associated_data || "", "utf8")); decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8"));
}
