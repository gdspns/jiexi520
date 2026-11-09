/**
 * 域名判定工具。
 *
 * 为什么不用 `url.includes("x.com")` 这种写法：
 * 子串匹配会把 **pipix.com**（皮皮虾，`h5.pipix.com`）判成 X/Twitter，
 * 于是皮皮虾被当成海外链接丢给 yt-dlp，yt-dlp 不认识 → Unsupported URL → 502。
 * 同类风险还有 `fb.watch`、`b23.tv` 与短链域名的相互包含。
 * 这里统一按 hostname 精确匹配（域名本身或它的子域）。
 */

/** 取 hostname（小写、无端口）；非法输入返回空串 */
export function hostOf(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.hostname.toLowerCase();
  } catch {
    // 允许传入裸域名，如 "www.pipix.com/s/xxx"
    const m = raw.toLowerCase().match(/^([a-z0-9.-]+\.[a-z]{2,})(?:[:/?#]|$)/);
    return m ? m[1] : "";
  }
}

/** host 是否等于域名本身或是它的子域（pipix.com 不会被 x.com 命中） */
export function hostIs(host: string, domain: string): boolean {
  if (!host || !domain) return false;
  const d = domain.toLowerCase();
  return host === d || host.endsWith("." + d);
}

/** URL 是否属于给定域名列表中的任意一个 */
export function matchDomains(url: string, domains: string[]): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return domains.some((d) => hostIs(host, d));
}

/** 海外平台（需要走代理 / yt-dlp / 落盘转码） */
export const OVERSEAS_DOMAINS = [
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "instagram.com",
  "facebook.com",
  "fb.watch",
  "twitter.com",
  "x.com",
  "vimeo.com",
];
