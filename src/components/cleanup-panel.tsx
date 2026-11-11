import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getMediaCleanup,
  installMediaCleanup,
  runMediaCleanup,
  saveMediaCleanup,
} from "@/lib/admin.functions";

type CleanupStatus = {
  config: { enabled: boolean; intervalMinutes: number };
  scheduler: { running: boolean; startedAt: string | null; tickSeconds: number };
  lastRun: {
    at: string | null;
    trigger: string;
    status: string;
    freedBytes: number;
    bytes: number;
    files: number;
    message: string;
    durationMs: number;
  };
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

const mb = (bytes: number) => (bytes / 1048576).toFixed(1);
const gb = (bytes: number) => (bytes / 1073741824).toFixed(2);

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const TRIGGER_LABEL: Record<string, string> = {
  auto: "自动",
  manual: "手动",
  install: "安装时",
  never: "尚未执行",
};

export function CleanupPanel() {
  const fetchStatus = useServerFn(getMediaCleanup);
  const save = useServerFn(saveMediaCleanup);
  const runNow = useServerFn(runMediaCleanup);
  const install = useServerFn(installMediaCleanup);

  const [status, setStatus] = useState<CleanupStatus | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [interval, setIntervalMinutes] = useState(60);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = (await fetchStatus()) as unknown as CleanupStatus;
      setStatus(next);
      setEnabled(next.config.enabled);
      setIntervalMinutes(next.config.intervalMinutes);
      setError(null);
    } catch (err) {
      setError((err as Error)?.message || "读取状态失败");
    }
  }, [fetchStatus]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  const flash = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast((prev) => (prev === text ? null : prev)), 4000);
  };

  const onSave = async () => {
    setBusy("save");
    try {
      const res = (await save({ data: { enabled, intervalMinutes: interval } })) as unknown as {
        status: CleanupStatus;
      };
      setStatus(res.status);
      flash(enabled ? `已保存，每 ${interval} 分钟自动清理一次` : "已保存，自动清理已关闭");
    } catch (err) {
      setError((err as Error)?.message || "保存失败");
    } finally {
      setBusy(null);
    }
  };

  const onRun = async () => {
    setBusy("run");
    try {
      const res = (await runNow()) as unknown as { run: CleanupStatus["lastRun"]; status: CleanupStatus };
      setStatus(res.status);
      flash(res.run.message || "清理完成");
    } catch (err) {
      setError((err as Error)?.message || "清理失败");
    } finally {
      setBusy(null);
    }
  };

  const onInstall = async () => {
    setBusy("install");
    try {
      const res = (await install({ data: { intervalMinutes: interval } })) as unknown as {
        status: CleanupStatus;
      };
      setStatus(res.status);
      flash(`已安装并启用：每 ${res.status.config.intervalMinutes} 分钟自动清理一次`);
    } catch (err) {
      setError((err as Error)?.message || "安装失败");
    } finally {
      setBusy(null);
    }
  };

  const cache = status?.cache;
  const disk = status?.disk;
  const last = status?.lastRun;

  const card = "rounded-xl border border-slate-800 bg-slate-900/40 p-4";
  const label = "text-xs text-slate-400";
  const value = "text-lg font-bold text-slate-100 mt-1";

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-base font-bold">媒体缓存定时清理</h2>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
              TikTok / Instagram 这类必须由服务器下载后再转发的视频，会先落到服务器磁盘。
              定时清理按「过期时间 + 总量预算」回收，避免占满磁盘。清理任务跟着网站进程运行，
              部署完成即自动开始，不需要登录服务器装 crontab。
            </p>
          </div>
          <span
            className={`px-2.5 py-1 rounded-full text-xs ${
              status?.scheduler.running
                ? status.config.enabled
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-amber-500/15 text-amber-300"
                : "bg-slate-700 text-slate-300"
            }`}
          >
            {status?.scheduler.running
              ? status.config.enabled
                ? "调度器运行中"
                : "调度器已暂停"
              : "调度器未启动"}
          </span>
        </div>

        {error && <p className="text-sm text-red-400 mt-3">加载失败：{error}</p>}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <div className={card}>
            <p className={label}>已存视频</p>
            <p className={value}>{cache ? `${mb(cache.bytes)} MB` : "—"}</p>
            <p className="text-xs text-slate-500 mt-1">
              {cache ? `${cache.files} 个文件` : "—"}
              {cache ? ` · 上限 ${mb(cache.budgetBytes)}MB` : ""}
            </p>
          </div>
          <div className={card}>
            <p className={label}>服务器剩余空间</p>
            <p className={value}>{disk ? `${gb(disk.freeBytes)} GB` : "—"}</p>
            <p className="text-xs text-slate-500 mt-1">
              {disk ? `低于 ${gb(disk.minFreeBytes)}GB 会拒绝下载` : "—"}
            </p>
          </div>
          <div className={card}>
            <p className={label}>上次回收</p>
            <p className={value}>{last && last.status === "ok" ? `${mb(last.freedBytes)} MB` : "—"}</p>
            <p className="text-xs text-slate-500 mt-1">{fmtTime(last?.at ?? null)}</p>
          </div>
          <div className={card}>
            <p className={label}>下次执行</p>
            <p className={value}>{status?.config.enabled ? fmtTime(status.nextRunAt) : "已停用"}</p>
            <p className="text-xs text-slate-500 mt-1">
              {status ? `每 ${status.config.intervalMinutes} 分钟` : "—"}
              {status ? ` · 正在下载 ${status.downloads.active}/${status.downloads.max}` : ""}
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-lg bg-slate-950/60 border border-slate-800 px-4 py-3 text-xs text-slate-400 space-y-1">
          <p>
            上次执行：
            {last && last.at
              ? `${fmtTime(last.at)}（${TRIGGER_LABEL[last.trigger] || last.trigger}）${last.message}，耗时 ${
                  last.durationMs
                }ms`
              : "尚未执行"}
          </p>
          <p>
            清理范围：{cache?.dir || "/tmp/media-cache"} · 超过 {cache?.sweepAgeMinutes ?? 25} 分钟未使用的文件直接删除 ·
            总量不超过 {mb(cache?.budgetBytes ?? 0)}MB / {cache?.maxFiles ?? 60} 个文件（超了从最旧的删）
          </p>
          <p>
            调度器：{status?.scheduler.running ? `已运行（启动于 ${fmtTime(status.scheduler.startedAt)}）` : "未运行"}
            ，每 {status?.scheduler.tickSeconds ?? 30} 秒检查一次是否到点
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 sm:p-5">
        <h3 className="text-base font-bold mb-1">清理设置</h3>
        <p className="text-xs text-slate-400 mb-4">
          间隔越短越省磁盘，但清理本身也要遍历目录；一般 60 分钟足够，磁盘紧张可以调到 10~30 分钟。
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="w-4 h-4 accent-pink-500"
            />
            启用自动清理
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            每
            <input
              type="number"
              min={5}
              max={1440}
              value={interval}
              onChange={(e) => setIntervalMinutes(e.target.value === "" ? 60 : parseInt(e.target.value, 10))}
              className="w-24 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:border-pink-500"
            />
            分钟清理一次
          </label>
          <button
            onClick={onSave}
            disabled={busy !== null}
            className="px-4 py-2 rounded-lg bg-pink-600 hover:bg-pink-500 text-white text-sm font-semibold disabled:opacity-50"
          >
            {busy === "save" ? "保存中…" : "保存设置"}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={onInstall}
            disabled={busy !== null}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50"
          >
            {busy === "install" ? "安装中…" : "安装 / 重新启用"}
          </button>
          <button
            onClick={onRun}
            disabled={busy !== null}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-sm disabled:opacity-50"
          >
            {busy === "run" ? "清理中…" : "立即清理"}
          </button>
          <span className="text-xs text-slate-500">
            换新服务器或重装后，点「安装 / 重新启用」即可：启用定时器、写入配置并立刻清一次。
          </span>
        </div>

        {toast && <p className="text-sm text-emerald-400 mt-3">{toast}</p>}
      </section>
    </div>
  );
}
