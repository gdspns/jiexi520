import { createPrivateKey, createPublicKey, createSign, createVerify, randomBytes, createDecipheriv } from "node:crypto";

export type OfficialConfig = Record<string, any>;

function pem(value: string, type: "PRIVATE KEY" | "PUBLIC KEY") {
  if (value.includes("BEGIN")) return value;
  const lines = value.replace(/\s/g, "").match(/.{1,64}/g)?.join("\n") || "";
  return `-----BEGIN ${type}-----\n${lines}\n-----END ${type}-----`;
}

function sign(content: string, privateKey: string) {
  const signer = createSign("RSA-SHA256"); signer.update(content, "utf8"); signer.end();
  return signer.sign(createPrivateKey(pem(privateKey, "PRIVATE KEY")), "base64");
}

function alipayContent(params: Record<string, any>, callback = false) {
  return Object.keys(params).filter(k => k !== "sign" && (!callback || k !== "sign_type") && params[k] !== "").sort().map(k => `${k}=${params[k]}`).join("&");
}

export async function createOfficialAlipay(cfg: OfficialConfig, input: { orderNo: string; amountCents: number; title: string; notifyUrl: string }) {
  if (!cfg.official_alipay_app_id || !cfg.official_alipay_private_key || !cfg.official_alipay_public_key) throw new Error("支付宝官方商户配置未完成");
  const params: Record<string, string> = {
    app_id: cfg.official_alipay_app_id, method: "alipay.trade.precreate", format: "JSON", charset: "utf-8", sign_type: "RSA2",
    timestamp: new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date()).replace("T", " "),
    version: "1.0", notify_url: input.notifyUrl,
    biz_content: JSON.stringify({ out_trade_no: input.orderNo, total_amount: (input.amountCents / 100).toFixed(2), subject: input.title.slice(0, 256), timeout_express: "20m" }),
  };
  params.sign = sign(alipayContent(params), cfg.official_alipay_private_key);
  const response = await fetch("https://openapi.alipay.com/gateway.do", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" }, body: new URLSearchParams(params) });
  const payload: any = await response.json().catch(() => ({})); const result = payload.alipay_trade_precreate_response || {};
  if (!response.ok || result.code !== "10000" || !result.qr_code) throw new Error(result.sub_msg || result.msg || "支付宝官方下单失败");
  return { qr_url: result.qr_code, wap_url: null };
}

export async function createOfficialWechat(cfg: OfficialConfig, input: { orderNo: string; amountCents: number; title: string; notifyUrl: string }) {
  if (!cfg.official_wechat_app_id || !cfg.official_wechat_mch_id || !cfg.official_wechat_serial_no || !cfg.official_wechat_private_key || !cfg.official_wechat_api_v3_key || !cfg.official_wechat_platform_public_key) throw new Error("微信官方商户配置未完成");
  const path = "/v3/pay/transactions/native", timestamp = String(Math.floor(Date.now() / 1000)), nonce = randomBytes(16).toString("hex");
  const body = JSON.stringify({ appid: cfg.official_wechat_app_id, mchid: cfg.official_wechat_mch_id, description: input.title.slice(0, 127), out_trade_no: input.orderNo, notify_url: input.notifyUrl, amount: { total: input.amountCents, currency: "CNY" } });
  const signature = sign(`POST\n${path}\n${timestamp}\n${nonce}\n${body}\n`, cfg.official_wechat_private_key);
  const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${cfg.official_wechat_mch_id}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${cfg.official_wechat_serial_no}",signature="${signature}"`;
  const response = await fetch(`https://api.mch.weixin.qq.com${path}`, { method: "POST", headers: { Authorization: authorization, Accept: "application/json", "Content-Type": "application/json" }, body });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok || !payload.code_url) throw new Error(payload.message || "微信官方下单失败");
  return { qr_url: payload.code_url, wap_url: null };
}

export function verifyAlipayCallback(params: Record<string, any>, publicKey: string) {
  const verifier = createVerify("RSA-SHA256"); verifier.update(alipayContent(params, true), "utf8"); verifier.end();
  return verifier.verify(createPublicKey(pem(publicKey, "PUBLIC KEY")), String(params.sign || "").replace(/ /g, "+"), "base64");
}

export function verifyWechatCallback(raw: string, headers: Headers, publicKey: string) {
  const timestamp = headers.get("Wechatpay-Timestamp") || "", nonce = headers.get("Wechatpay-Nonce") || "", signature = headers.get("Wechatpay-Signature") || "";
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const verifier = createVerify("RSA-SHA256"); verifier.update(`${timestamp}\n${nonce}\n${raw}\n`, "utf8"); verifier.end();
  return verifier.verify(createPublicKey(pem(publicKey, "PUBLIC KEY")), signature, "base64");
}

export function decryptWechatResource(resource: any, apiV3Key: string) {
  const data = Buffer.from(resource.ciphertext, "base64"), tag = data.subarray(data.length - 16), encrypted = data.subarray(0, data.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(apiV3Key, "utf8"), Buffer.from(resource.nonce, "utf8"));
  decipher.setAAD(Buffer.from(resource.associated_data || "", "utf8")); decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8"));
}
