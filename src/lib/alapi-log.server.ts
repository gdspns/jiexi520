// 读取 ALAPI 控制台的「调用记录」，用于后台解析日志页的「ALAPI 调用」标签。
//
// 为什么不落库：
//   1) ALAPI 没有开放调用日志 API（/api/user/log 之类全 404），只有控制台页面在用的
//      内部接口 v3.alapi.cn/frontend/dashboard/api/log，靠 Bearer JWT 鉴权；
//   2) 线上库没有给我们 DDL 权限，建表只能手工去 Supabase 控制台跑；
//   3) 实时查 + 45 秒缓存，数据永远和 ALAPI 控制台一致，也不用做去重/清理。
//
// 凭据只存在 app_settings 的 alapi_access_token 这一行——该表 RLS 对 authenticated
// 是 USING(false)，普通登录用户读不到，只有 service_role 能读，所以放这里安全。
import type { SupabaseClient } from "@supabase/supabase-js";

const TOKEN_KEY = "alapi_access_token";
const LOG_URL = "https://v3.alapi.cn/frontend/dashboard/api/log";
const APIS_URL = "https://v3.alapi.cn/frontend/dashboard/api/user_apis";
/** 单条日志详情：带 request_payload（里面就有用户解析的原始链接） */
const DETAIL_URL = "https://v3.alapi.cn/frontend/dashboard/api/log/detail/";
/** 我的接口：每个接口今日已用 / 剩余 / 上限 */
const QUOTA_URL = "https://v3.alapi.cn/frontend/dashboard/api/index?type=0&page=1&search=";
/** 账号资料：会员档位与到期时间 */
const PROFILE_URL = "https://v3.alapi.cn/frontend/user/profile";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** 本站生产服务器出口 IP，用来把「本站后端调用」和其他来源区分开 */
export const SELF_SERVER_IP = "192.129.217.73";

export type AlapiSource = "本站" | "微信小程序" | "外部";

export type AlapiCall = {
  logId: string;
  apiId: number;
  apiName: string;
  nodeId: number;
  status: number;
  ip: string;
  referer: string;
  refererHost: string;
  duration: number;
  at: string;
  source: AlapiSource;
  /** 用户解析的原始链接（来自日志详情，可能需要单独拉一次） */
  url: string;
};

export type AlapiCallDetail = {
  logId: string;
  /** request_payload 里的 url 字段，即用户提交解析的链接 */
  url: string;
  /** request_payload 里的 token（alapi 自己脱敏过） */
  tokenMasked: string;
  /** 格式化后的请求参数，用于弹窗展示 */
  payload: string;
};

export type AlapiQuotaApi = {
  id: number;
  name: string;
  /** 今日已用（含失败） */
  used: number;
  success: number;
  fail: number;
  /** 今日剩余可用次数 */
  remain: number;
  /** 每日上限 */
  limit: number;
};

export type AlapiQuota = {
  ok: boolean;
  error?: string;
  apis: AlapiQuotaApi[];
  planName: string;
  planEndAt: string;
  fetchedAt: string;
};

export type AlapiTokenMeta = {
  configured: boolean;
  tail: string;
  expiresAt: string | null;
  expired: boolean;
};

let cachedSvc: SupabaseClient | null = null;

async function serviceClient(): Promise<SupabaseClient | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (cachedSvc) return cachedSvc;
  const { createClient } = await import("@supabase/supabase-js");
  cachedSvc = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return cachedSvc;
}

function jwtExpMs(token: string): number | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const payload = JSON.parse(json);
    return typeof payload?.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function tokenMeta(token: string): AlapiTokenMeta {
  if (!token) return { configured: false, tail: "", expiresAt: null, expired: false };
  const exp = jwtExpMs(token);
  return {
    configured: true,
    tail: token.slice(-6),
    expiresAt: exp ? new Date(exp).toISOString() : null,
    expired: exp ? Date.now() > exp : false,
  };
}

export async function readAlapiToken(): Promise<string> {
  const sb = await serviceClient();
  if (!sb) return "";
  const { data, error } = await sb.from("app_settings").select("value").eq("key", TOKEN_KEY).maybeSingle();
  if (error) throw new Error(error.message);
  const v: any = data?.value;
  if (typeof v === "string") return v.trim();
  if (v && typeof v === "object" && typeof v.token === "string") return v.token.trim();
  return "";
}

export async function saveAlapiToken(token: string): Promise<void> {
  const sb = await serviceClient();
  if (!sb) throw new Error("服务端缺少 SUPABASE_SERVICE_ROLE_KEY");
  const { error } = await sb
    .from("app_settings")
    .upsert({ key: TOKEN_KEY, value: token as any, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  cache.clear();
  quotaCache = null;
}

export async function clearAlapiToken(): Promise<void> {
  const sb = await serviceClient();
  if (!sb) return;
  await sb.from("app_settings").delete().eq("key", TOKEN_KEY);
  cache.clear();
  quotaCache = null;
}

// 一键同步用的密钥：浏览器书签带着它把最新 token POST 回来。
// 只存在 app_settings（authenticated 全禁读），后台页面可见，泄露最坏结果是 ALAPI 日志看不了。
const SYNC_KEY = "alapi_sync_key";

export async function readAlapiSyncKey(): Promise<string> {
  const sb = await serviceClient();
  if (!sb) return "";
  const { data } = await sb.from("app_settings").select("value").eq("key", SYNC_KEY).maybeSingle();
  return typeof data?.value === "string" ? data.value : "";
}

export async function ensureAlapiSyncKey(): Promise<string> {
  const existing = await readAlapiSyncKey();
  if (existing) return existing;
  const sb = await serviceClient();
  if (!sb) return "";
  const { randomBytes } = await import("node:crypto");
  const key = randomBytes(16).toString("hex");
  const { error } = await sb
    .from("app_settings")
    .upsert({ key: SYNC_KEY, value: key as any, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  return key;
}

/** 北京时间当天 */
function bjYmd(offsetDays = 0): string {
  const t = new Date(Date.now() + 8 * 3600_000 - offsetDays * 86_400_000);
  return t.toISOString().slice(0, 10);
}

function refererHost(referer: string): string {
  if (!referer) return "";
  try {
    return new URL(referer).host;
  } catch {
    return referer.slice(0, 40);
  }
}

function sourceOf(ip: string, referer: string): AlapiSource {
  if (ip === SELF_SERVER_IP) return "本站";
  if (/servicewechat\.com|weixin\.qq\.com/i.test(referer)) return "微信小程序";
  return "外部";
}

type RawLog = {
  log_id: string;
  api_id: number;
  api_node_id: number;
  response_code: number;
  client_ip: string;
  request_timestamp: string;
  referer_url?: string;
  duration_ms: number;
};

async function alapiGet(token: string, url: string): Promise<any> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": UA,
      Referer: "https://www.alapi.cn/",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401 || res.status === 403) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error(`ALAPI 接口错误 HTTP ${res.status}`);
  const json: any = await res.json();
  if (json?.success === false) {
    if (json.code === 401 || json.code === 403) throw new Error("UNAUTHORIZED");
    throw new Error(json.message || `ALAPI 接口错误 code=${json.code}`);
  }
  return json;
}

/** api_id → 接口名，10 分钟缓存 */
let apiNamesCache: { at: number; map: Map<number, string> } | null = null;

async function apiNames(token: string): Promise<Map<number, string>> {
  if (apiNamesCache && Date.now() - apiNamesCache.at < 10 * 60_000) return apiNamesCache.map;
  const map = new Map<number, string>();
  try {
    const json = await alapiGet(token, `${APIS_URL}?current=1&pageSize=100`);
    const rows: any[] = Array.isArray(json?.data) ? json.data : json?.data?.data || [];
    for (const r of rows) {
      if (r?.id != null) map.set(Number(r.id), String(r.name || `接口 ${r.id}`));
    }
  } catch {
    // 名称拿不到不影响主流程，UI 退化成「接口 68」
  }
  if (map.size) apiNamesCache = { at: Date.now(), map };
  return map;
}

// ============ 日志详情（解析链接） ============
// 列表接口不带请求参数，链接要单独查 /api/log/detail/<log_id>。
// 详情是只读的历史数据，一个 log_id 永远不会变，所以缓存可以无限期，只做容量上限。
const detailCache = new Map<string, AlapiCallDetail>();
const DETAIL_CACHE_MAX = 4000;

/** 简单的并发闸门：ALAPI 账户 QPS 只有个位数，别一次打太多 */
async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await fn(item).catch(() => undefined);
    }
  });
  await Promise.all(workers);
}

type PayloadObj = { url?: unknown; token?: unknown };

function parsePayload(raw: unknown): PayloadObj | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw as PayloadObj;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === "object" ? (parsed as PayloadObj) : null;
  } catch {
    return null;
  }
}

export async function fetchAlapiCallDetail(
  token: string,
  logId: string,
): Promise<AlapiCallDetail | null> {
  const key = String(logId || "").trim();
  if (!key || !token) return null;
  const cached = detailCache.get(key);
  if (cached) return cached;

  const json = await alapiGet(token, `${DETAIL_URL}${encodeURIComponent(key)}`);
  const d = json?.data;
  if (!d) return null;

  const obj = parsePayload(d.request_payload);
  const detail: AlapiCallDetail = {
    logId: String(d.log_id || key),
    url: typeof obj?.url === "string" ? obj.url : "",
    tokenMasked: typeof obj?.token === "string" ? obj.token : "",
    payload: obj ? JSON.stringify(obj, null, 2) : String(d.request_payload || ""),
  };
  if (detailCache.size > DETAIL_CACHE_MAX) detailCache.clear();
  detailCache.set(key, detail);
  return detail;
}

/** 批量补链接；已缓存的直接命中，不发请求 */
export async function fetchAlapiCallDetails(
  logIds: string[],
): Promise<{ ok: boolean; error?: string; details: AlapiCallDetail[]; failed: number }> {
  const ids = Array.from(new Set(logIds.map((s) => String(s || "").trim()).filter(Boolean))).slice(0, 80);
  if (!ids.length) return { ok: true, details: [], failed: 0 };

  const token = await readAlapiToken().catch(() => "");
  if (!token) return { ok: false, error: "未配置 ALAPI 凭据", details: [], failed: ids.length };

  const details: AlapiCallDetail[] = [];
  let failed = 0;
  const pending: string[] = [];
  for (const id of ids) {
    const hit = detailCache.get(id);
    if (hit) details.push(hit);
    else pending.push(id);
  }

  let unauthorized = false;
  await runPool(pending, 4, async (id) => {
    if (unauthorized) return;
    try {
      const d = await fetchAlapiCallDetail(token, id);
      if (d) details.push(d);
      else failed++;
    } catch (err: any) {
      if (String(err?.message || err) === "UNAUTHORIZED") unauthorized = true;
      failed++;
    }
  });

  if (unauthorized && !details.length) {
    return { ok: false, error: "ALAPI 凭据已失效，请用书签同步一次", details, failed };
  }
  return { ok: true, details, failed };
}

// ============ 今日额度（剩余次数） ============
let quotaCache: { at: number; data: AlapiQuota } | null = null;
const QUOTA_TTL = 60_000;

export async function fetchAlapiQuota(): Promise<AlapiQuota> {
  if (quotaCache && Date.now() - quotaCache.at < QUOTA_TTL) return quotaCache.data;

  const empty = (error: string): AlapiQuota => ({
    ok: false,
    error,
    apis: [],
    planName: "",
    planEndAt: "",
    fetchedAt: new Date().toISOString(),
  });

  const token = await readAlapiToken().catch(() => "");
  if (!token) return empty("未配置 ALAPI 凭据");

  try {
    const [list, profile] = await Promise.all([
      alapiGet(token, QUOTA_URL),
      alapiGet(token, PROFILE_URL).catch(() => null),
    ]);
    const rows: any[] = Array.isArray(list?.data?.data) ? list.data.data : [];
    const apis: AlapiQuotaApi[] = rows.map((r) => ({
      id: Number(r?.api_id ?? r?.api?.id ?? 0),
      name: String(r?.api?.name || `接口 ${r?.api_id}`),
      used: Number(r?.request?.num ?? 0),
      success: Number(r?.request?.success_num ?? 0),
      fail: Number(r?.request?.fail_num ?? 0),
      remain: Number(r?.request?.can_use_num ?? 0),
      limit: Number(r?.request?.daily_limit ?? 0),
    }));
    const p = profile?.data || {};
    const data: AlapiQuota = {
      ok: true,
      apis,
      planName: String(p?.plan?.name || ""),
      planEndAt: String(p?.plan_end_at || ""),
      fetchedAt: new Date().toISOString(),
    };
    quotaCache = { at: Date.now(), data };
    return data;
  } catch (err: any) {
    const msg = String(err?.message || err);
    const data = empty(
      msg === "UNAUTHORIZED" ? "ALAPI 凭据已失效，额度暂时读不到" : `读取额度失败：${msg}`,
    );
    // 失败也缓存 15 秒，避免前端轮询把失败打爆
    quotaCache = { at: Date.now() - QUOTA_TTL + 15_000, data };
    return data;
  }
}

export type AlapiLogResult = {
  ok: boolean;
  error?: string;
  needsToken?: boolean;
  token: AlapiTokenMeta;
  calls: AlapiCall[];
  total: number;
  fetchedAt: string;
  days: number;
};

const cache = new Map<string, { at: number; ttl: number; result: AlapiLogResult }>();
// 比前端的 60 秒轮询略长，保证轮询大多命中缓存、不会每秒都打 ALAPI
const CACHE_TTL = 90_000;

export async function fetchAlapiCalls(days: number): Promise<AlapiLogResult> {
  const d = Math.min(Math.max(Math.trunc(days) || 3, 1), 7);
  const hit = cache.get(String(d));
  if (hit && Date.now() - hit.at < hit.ttl) return hit.result;

  const token = await readAlapiToken().catch(() => "");
  const meta = tokenMeta(token);
  if (!meta.configured) {
    return {
      ok: false,
      error: "还没有配置 ALAPI 凭据，点右上角「配置凭据」粘贴 alapi_access_token 即可",
      needsToken: true,
      token: meta,
      calls: [],
      total: 0,
      fetchedAt: new Date().toISOString(),
      days: d,
    };
  }
  if (meta.expired) {
    return {
      ok: false,
      error: `ALAPI 凭据已于 ${new Date(meta.expiresAt!).toLocaleString("zh-CN")} 过期，请重新登录 alapi 后更新`,
      needsToken: true,
      token: meta,
      calls: [],
      total: 0,
      fetchedAt: new Date().toISOString(),
      days: d,
    };
  }

  const start = bjYmd(d - 1);
  const end = bjYmd(0);
  const all: RawLog[] = [];
  let total = 0;
  let names = new Map<number, string>();

  const pageUrl = (page: number) =>
    `${LOG_URL}?current=${page}&pageSize=100&start_time=${start}+00:00&end_time=${end}+23:59`;

  try {
    // 接口名映射和第一页并行取；拿到总页数后其余页也并行
    const [nameMap, first] = await Promise.all([apiNames(token), alapiGet(token, pageUrl(1))]);
    names = nameMap;
    const payload = first?.data || {};
    const firstRows: RawLog[] = Array.isArray(payload.data) ? payload.data : [];
    total = Number(payload.total ?? payload.pageInfo?.total ?? firstRows.length);
    all.push(...firstRows);

    const totalPage = Math.min(
      Number(payload.pageInfo?.totalPage ?? Math.ceil(total / 100) ?? 1) || 1,
      10,
    );
    if (totalPage > 1) {
      const rest = await Promise.all(
        Array.from({ length: totalPage - 1 }, (_, i) =>
          alapiGet(token, pageUrl(i + 2)).catch(() => null),
        ),
      );
      for (const json of rest) {
        const rows: RawLog[] = Array.isArray(json?.data?.data) ? json.data.data : [];
        all.push(...rows);
      }
    }
  } catch (err: any) {
    const msg = String(err?.message || err);
    const unauthorized = msg === "UNAUTHORIZED";
    const result: AlapiLogResult = {
      ok: false,
      error: unauthorized
        ? "ALAPI 凭据已失效（可能在其他设备退出登录或改过密码），请重新登录 alapi 更新凭据"
        : msg === "The operation was aborted due to timeout" || /aborted/i.test(msg)
          ? "连接 ALAPI 超时，稍后重试"
          : msg,
      needsToken: unauthorized,
      token: meta,
      calls: [],
      total: 0,
      fetchedAt: new Date().toISOString(),
      days: d,
    };
    cache.set(String(d), { at: Date.now(), ttl: 15_000, result });
    return result;
  }

  const calls: AlapiCall[] = all.map((r) => ({
    logId: String(r.log_id),
    apiId: Number(r.api_id || 0),
    apiName: names.get(Number(r.api_id)) || `接口 ${r.api_id}`,
    nodeId: Number(r.api_node_id || 0),
    status: Number(r.response_code || 0),
    ip: r.client_ip || "",
    referer: r.referer_url || "",
    refererHost: refererHost(r.referer_url || ""),
    duration: Number(r.duration_ms || 0),
    at: r.request_timestamp || "",
    source: sourceOf(r.client_ip || "", r.referer_url || ""),
    url: detailCache.get(String(r.log_id))?.url || "",
  }));

  // 时间倒序（接口本来就倒序，双保险）
  calls.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  const result: AlapiLogResult = {
    ok: true,
    token: meta,
    calls,
    total: total || calls.length,
    fetchedAt: new Date().toISOString(),
    days: d,
  };
  cache.set(String(d), { at: Date.now(), ttl: CACHE_TTL, result });
  return result;
}

/** 配置凭据前先验一下：能不能拉到日志 */
export async function verifyAlapiToken(token: string): Promise<{ ok: boolean; message: string }> {
  const t = token.replace(/^Bearer\s+/i, "").trim();
  if (t.length < 40 || !t.includes(".")) return { ok: false, message: "这不像是一个有效的 alapi_access_token" };
  const meta = tokenMeta(t);
  if (meta.expired) return { ok: false, message: "该凭据已经过期，请重新登录 alapi 后再复制" };
  try {
    const url = `${LOG_URL}?current=1&pageSize=1&start_time=${bjYmd(0)}+00:00&end_time=${bjYmd(0)}+23:59`;
    await alapiGet(t, url);
    return { ok: true, message: "凭据有效" };
  } catch (err: any) {
    const msg = String(err?.message || err);
    return { ok: false, message: msg === "UNAUTHORIZED" ? "凭据无效或已失效" : msg };
  }
}
