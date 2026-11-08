// 直链刷新票据：平台给的 CDN 直链带时效，播放/下载中途会过期（403/410）。
// 允许前端用「解析成功时拿到的票据」重新解析同一条分享链接换取新直链，
// 而不重复扣积分。票据用 HMAC 绑定 userId + 目标链接 + 过期时间，
// 所以既不能跨用户用，也不能改链接白嫖别的视频，更不能无限续期。

export const REFRESH_TTL_MS = 6 * 60 * 60 * 1000;

function secret(): string {
  return (
    process.env.MEDIA_REFRESH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    "jiexi520-refresh-fallback"
  );
}

export async function signRefreshToken(userId: string, url: string, exp: number): Promise<string> {
  const { createHmac } = await import("node:crypto");
  const sig = createHmac("sha256", secret()).update(`${userId}|${exp}|${url}`).digest("base64url");
  return `${exp}.${sig}`;
}

export async function verifyRefreshToken(token: string, userId: string, url: string): Promise<boolean> {
  const [expRaw, sig] = String(token || "").split(".");
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Date.now() || !sig) return false;
  const expected = (await signRefreshToken(userId, url, exp)).split(".")[1] || "";
  if (sig.length !== expected.length) return false;
  const { timingSafeEqual } = await import("node:crypto");
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}
