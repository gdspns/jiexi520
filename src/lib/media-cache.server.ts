// 媒体落盘缓存的「清理服务」。
//
// 为什么单独一层：
//  - media-stream 里的 yt-dlp 落盘缓存是资源消耗点（磁盘/内存），清理逻辑要能被
//    后台（/admin → 系统维护 → 定时清理）看到状态、改间隔、手动触发；
//  - 定时器要跟着服务进程走，部署完成即自动开始跑，换服务器不需要额外装 crontab；
//  - 后台页面上那个「安装 / 重新启用」按钮，本质是把配置写回数据库并确保调度器在跑。
//
// 配置存在 Supabase app_settings（key = media_cleanup），所以整站部署在哪台服务器都一致。

const SWEEP_TIMER_KEY = Symbol.for("jiexi520.mediaCleanup.timer");
const STATE_KEY = "media_cleanup_state";
const CONFIG_KEY = "media_cleanup";

// —— 资源上限。容器 /tmp 挂在 overlay（不是 tmpfs），下载不占内存；
//    真正要防的是并发 OOM 与磁盘写满，所以这里的阈值都偏保守。
export const MEDIA_CACHE_DIR = process.env.MEDIA_CACHE_DIR || "/tmp/media-cache";
export const CACHE_TTL_MS = 20 * 60_000;
export const CACHE_SWEEP_AGE_MS = 25 * 60_000;
export const MAX_CACHE_BYTES = Number(process.env.MEDIA_CACHE_MAX_MB || 1536) * 1024 * 1024;
export const MAX_CACHE_FILES = Number(process.env.MEDIA_CACHE_MAX_FILES || 60);
export const MAX_VIDEO_BYTES = Number(process.env.MEDIA_MAX_VIDEO_MB || 200) * 1024 * 1024;
export const MAX_AUDIO_BYTES = Number(process.env.MEDIA_MAX_AUDIO_MB || 40) * 1024 * 1024;
export const MIN_FREE_BYTES = Number(process.env.MEDIA_MIN_FREE_MB || 2048) * 1024 * 1024;

export const DEFAULT_INTERVAL_MINUTES = 60;
export const MIN_INTERVAL_MINUTES = 5;
export const MAX_INTERVAL_MINUTES = 24 * 60;

export type CleanupConfig = { enabled: boolean; intervalMinutes: number };

export type CleanupRun = {
  at: string | null;
  trigger: string;
  status: "ok" | "failed" | "skipped" | "never";
  freedBytes: number;
  bytes: number;
  files: number;
  message: string;
  durationMs: number;
};

export type CleanupStatus = {
  config: CleanupConfig;
  scheduler: { running: boolean; startedAt: string | null; tickSeconds: number };
  lastRun: CleanupRun;
  nextRunAt: string | null;
  cache: {
    dir: string;
    bytes: number;
    files: number;
    budgetBytes: number;
    maxFiles: number;
    sweepAgeMinutes: number;
  };
  disk: { freeBytes: number; minFreeBytes: number };
  downloads: { active: number; max: number };
  running: boolean;
};

export function failWith(status: number, message: string): Error {
  const err = new Error(message) as Error & { statusCode?: number };
  err.statusCode = status;
  return err;
}

// media-stream 里的 bufferedFiles / 并发计数需要跟着清理结果更新，
// 但那个模块被清理模块反向依赖会成环，所以用钩子注册。
type RemovalHook = (removedPaths: Set<string>) => void;
const removalHooks: RemovalHook[] = [];
export function onCacheRemoved(hook: RemovalHook) {
  removalHooks.push(hook);
}

type DownloadStatsHook = () => { active: number; max: number };
let downloadStats: DownloadStatsHook = () => ({ active: 0, max: 0 });
export function reportDownloadStats(hook: DownloadStatsHook) {
  downloadStats = hook;
}

let lastRun: CleanupRun = {
  at: null,
  trigger: "never",
  status: "never",
  freedBytes: 0,
  bytes: 0,
  files: 0,
  message: "",
  durationMs: 0,
};
let stateLoaded = false;
let runningTask: Promise<CleanupRun> | null = null;

function supabaseUrl() {
  return process.env.SUPABASE_URL || "";
}
function supabaseKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

async function withTimeout<T>(task: Promise<T>, ms: number, label: string): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      console.log(`[media-cleanup] timeout(${ms}ms) ${label}`);
      resolve(null);
    }, ms);
    try {
      (timer as unknown as { unref?: () => void }).unref?.();
    } catch {
      /* ignore */
    }
  });
  try {
    return await Promise.race([task, guard]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function getClient() {
  const url = supabaseUrl();
  const key = supabaseKey();
  if (!url || !key) return null;
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function readSetting(key: string): Promise<string> {
  const started = Date.now();
  try {
    const sb = await withTimeout(getClient(), 8000, "getClient");
    if (!sb) return "";
    const result = await withTimeout(
      Promise.resolve(sb.from("app_settings").select("value").eq("key", key).maybeSingle() as never),
      8000,
      `read ${key}`,
    );
    const data = (result as { data?: { value?: unknown } | null } | null)?.data;
    const value = data?.value;
    if (Date.now() - started > 3000) console.log(`[media-cleanup] slow read ${key} ${Date.now() - started}ms`);
    return typeof value === "string" ? value : value == null ? "" : String(value);
  } catch (err) {
    console.error("[media-cleanup] read setting failed", key, (err as Error)?.message);
    return "";
  }
}

async function writeSetting(key: string, value: string): Promise<void> {
  const sb = await getClient();
  if (!sb) return;
  try {
    await sb.from("app_settings").upsert([{ key, value, updated_at: new Date().toISOString() } as never]);
  } catch (err) {
    console.error("[media-cleanup] write setting failed", key, (err as Error)?.message);
  }
}

function parseConfig(raw: string): CleanupConfig {
  const fallback: CleanupConfig = { enabled: true, intervalMinutes: DEFAULT_INTERVAL_MINUTES };
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<CleanupConfig>;
    const interval = Number(parsed.intervalMinutes);
    return {
      enabled: parsed.enabled !== false,
      intervalMinutes: Number.isFinite(interval)
        ? Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, Math.round(interval)))
        : fallback.intervalMinutes,
    };
  } catch {
    return fallback;
  }
}

let configCache: { value: CleanupConfig; at: number } | null = null;
const CONFIG_TTL_MS = 20_000;

export async function loadCleanupConfig(force = false): Promise<CleanupConfig> {
  if (!force && configCache && Date.now() - configCache.at < CONFIG_TTL_MS) return configCache.value;
  const value = parseConfig(await readSetting(CONFIG_KEY));
  configCache = { value, at: Date.now() };
  return value;
}

export async function saveCleanupConfig(input: CleanupConfig): Promise<CleanupConfig> {
  const value: CleanupConfig = {
    enabled: input.enabled !== false,
    intervalMinutes: Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, Math.round(input.intervalMinutes))),
  };
  configCache = { value, at: Date.now() };
  await writeSetting(CONFIG_KEY, JSON.stringify(value));
  return value;
}

async function loadPersistedRun(): Promise<void> {
  if (stateLoaded) return;
  stateLoaded = true;
  const raw = await readSetting(STATE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as CleanupRun;
    if (parsed && typeof parsed.at === "string") lastRun = { ...lastRun, ...parsed };
  } catch {
    /* 状态坏了不影响清理 */
  }
}

async function persistRun(run: CleanupRun): Promise<void> {
  await writeSetting(STATE_KEY, JSON.stringify(run));
}

// 清理缓存目录：先删超过 25 分钟没动过的，再按「总量 / 文件数」预算从最旧的删。
export async function sweepCache(options: { verbose?: boolean; enforceBudget?: boolean } = {}): Promise<{
  bytes: number;
  files: number;
  freedBytes: number;
  removedPaths: Set<string>;
}> {
  const { verbose = false, enforceBudget = true } = options;
  const fsMod = await import("node:fs/promises");
  const pathMod = await import("node:path");
  const removedPaths = new Set<string>();
  const entries: Array<{ path: string; size: number; mtime: number }> = [];

  try {
    await fsMod.mkdir(MEDIA_CACHE_DIR, { recursive: true });
    for (const name of await fsMod.readdir(MEDIA_CACHE_DIR)) {
      const full = pathMod.join(MEDIA_CACHE_DIR, name);
      const st = await fsMod.stat(full).catch(() => null);
      if (!st || !st.isFile()) continue;
      entries.push({ path: full, size: st.size, mtime: st.mtimeMs });
    }
  } catch {
    return { bytes: 0, files: 0, freedBytes: 0, removedPaths };
  }

  const now = Date.now();
  const keep: typeof entries = [];
  let freed = 0;
  for (const e of entries) {
    if (now - e.mtime > CACHE_SWEEP_AGE_MS) {
      await fsMod.unlink(e.path).catch(() => {});
      removedPaths.add(e.path);
      freed += e.size;
    } else {
      keep.push(e);
    }
  }

  if (enforceBudget) {
    keep.sort((a, b) => a.mtime - b.mtime); // 最旧在前
    let total = keep.reduce((sum, e) => sum + e.size, 0);
    while ((total > MAX_CACHE_BYTES || keep.length > MAX_CACHE_FILES) && keep.length) {
      const victim = keep.shift()!;
      await fsMod.unlink(victim.path).catch(() => {});
      removedPaths.add(victim.path);
      total -= victim.size;
      freed += victim.size;
    }
  }

  const bytes = keep.reduce((sum, e) => sum + e.size, 0);
  if (removedPaths.size) {
    for (const hook of removalHooks) {
      try {
        hook(removedPaths);
      } catch {
        /* 钩子失败不影响清理 */
      }
    }
  }

  if (verbose || removedPaths.size) {
    console.log(
      `[media-cleanup] sweep removed=${removedPaths.size} freed=${(freed / 1048576).toFixed(1)}MB ` +
        `left=${(bytes / 1048576).toFixed(1)}MB files=${keep.length}`,
    );
  }
  return { bytes, files: keep.length, freedBytes: freed, removedPaths };
}

// 下载前确认还有空间：不够就先清一遍，仍不够就别下（宁可不播，也别写满根分区）。
export async function ensureDiskSpace(): Promise<boolean> {
  const fsMod = await import("node:fs/promises");
  const read = async () => {
    const st = await fsMod.statfs(MEDIA_CACHE_DIR).catch(() => null);
    if (!st) return Number.POSITIVE_INFINITY;
    return Number(st.bavail) * Number(st.bsize);
  };
  if ((await read()) >= MIN_FREE_BYTES) return true;
  await sweepCache({ verbose: true });
  return (await read()) >= MIN_FREE_BYTES;
}

export async function getCacheUsage(): Promise<{ bytes: number; files: number; freeBytes: number }> {
  const fsMod = await import("node:fs/promises");
  const pathMod = await import("node:path");
  let bytes = 0;
  let files = 0;
  try {
    for (const name of await fsMod.readdir(MEDIA_CACHE_DIR)) {
      const st = await fsMod.stat(pathMod.join(MEDIA_CACHE_DIR, name)).catch(() => null);
      if (!st || !st.isFile()) continue;
      bytes += st.size;
      files += 1;
    }
  } catch {
    /* 目录还不存在 */
  }
  const stat = await fsMod.statfs(MEDIA_CACHE_DIR).catch(() => null);
  const freeBytes = stat ? Number(stat.bavail) * Number(stat.bsize) : 0;
  return { bytes, files, freeBytes };
}

export async function runCleanup(trigger: string): Promise<CleanupRun> {
  if (runningTask) return runningTask;
  runningTask = (async () => {
    const startedAt = Date.now();
    try {
      const result = await sweepCache({ verbose: true });
      const run: CleanupRun = {
        at: new Date().toISOString(),
        trigger,
        status: "ok",
        freedBytes: result.freedBytes,
        bytes: result.bytes,
        files: result.files,
        message:
          result.freedBytes > 0
            ? `回收 ${(result.freedBytes / 1048576).toFixed(1)}MB，剩余 ${(result.bytes / 1048576).toFixed(1)}MB`
            : `无需清理，当前 ${(result.bytes / 1048576).toFixed(1)}MB`,
        durationMs: Date.now() - startedAt,
      };
      lastRun = run;
      void persistRun(run);
      return run;
    } catch (err) {
      const run: CleanupRun = {
        at: new Date().toISOString(),
        trigger,
        status: "failed",
        freedBytes: 0,
        bytes: 0,
        files: 0,
        message: (err as Error)?.message || "清理失败",
        durationMs: Date.now() - startedAt,
      };
      lastRun = run;
      void persistRun(run);
      console.error("[media-cleanup] run failed", run.message);
      return run;
    }
  })().finally(() => {
    runningTask = null;
  });
  return runningTask;
}

const TICK_MS = 30_000;

async function tick() {
  const config = await loadCleanupConfig();
  if (!config.enabled) return;
  await loadPersistedRun();
  const lastAt = lastRun.at ? Date.parse(lastRun.at) : 0;
  const due = Date.now() - lastAt >= config.intervalMinutes * 60_000;
  if (!due) return;
  console.log(`[media-cleanup] auto run (interval=${config.intervalMinutes}min)`);
  await runCleanup("auto");
}

// 幂等：多次调用只会有一个调度器（dev 热更新、多次 import 都不会重复起）。
export function startCleanupScheduler(): void {
  const host = globalThis as unknown as Record<symbol, { timer: unknown; startedAt: number }>;
  if (host[SWEEP_TIMER_KEY]) return;
  const timer = setInterval(() => {
    void tick().catch((err) => console.error("[media-cleanup] tick failed", (err as Error)?.message));
  }, TICK_MS);
  try {
    (timer as unknown as { unref?: () => void }).unref?.();
  } catch {
    /* 不支持的运行时忽略 */
  }
  host[SWEEP_TIMER_KEY] = { timer, startedAt: Date.now() };
  // 部署完成立刻清一次（不等满一个周期）：新容器 /tmp 是空的，但同机重启／热更新时
  // 可能留着上一轮文件，顺手收干净。失败不影响服务。
  void (async () => {
    await loadPersistedRun();
    await runCleanup("boot");
  })().catch((err) => console.error("[media-cleanup] boot run failed", (err as Error)?.message));
  console.log(`[media-cleanup] scheduler started tick=${TICK_MS / 1000}s dir=${MEDIA_CACHE_DIR}`);
}

export async function getCleanupStatus(): Promise<CleanupStatus> {
  await loadPersistedRun();
  const config = await loadCleanupConfig(true);
  const usage = await getCacheUsage();
  const host = globalThis as unknown as Record<symbol, { timer: unknown; startedAt: number } | undefined>;
  const scheduler = host[SWEEP_TIMER_KEY];
  const nextRunAt = config.enabled
    ? new Date((lastRun.at ? Date.parse(lastRun.at) : Date.now()) + config.intervalMinutes * 60_000).toISOString()
    : null;
  return {
    config,
    scheduler: {
      running: Boolean(scheduler),
      startedAt: scheduler ? new Date(scheduler.startedAt).toISOString() : null,
      tickSeconds: TICK_MS / 1000,
    },
    lastRun,
    nextRunAt,
    cache: {
      dir: MEDIA_CACHE_DIR,
      bytes: usage.bytes,
      files: usage.files,
      budgetBytes: MAX_CACHE_BYTES,
      maxFiles: MAX_CACHE_FILES,
      sweepAgeMinutes: Math.round(CACHE_SWEEP_AGE_MS / 60_000),
    },
    disk: { freeBytes: usage.freeBytes, minFreeBytes: MIN_FREE_BYTES },
    downloads: downloadStats(),
    running: Boolean(runningTask),
  };
}
