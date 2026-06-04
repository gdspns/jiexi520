import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { listUsers, setBanned, deleteUser, adjustCredits, getSignupBonus, setSignupBonus, getApiConfig, setApiConfig } from "@/lib/admin.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "管理员后台 - 音影无损" }] }),
  component: AdminPage,
  errorComponent: ({ error }) => (
    <div className="min-h-screen flex items-center justify-center text-slate-200 bg-slate-950 p-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-bold mb-2">无法加载管理后台</h1>
        <p className="text-sm text-slate-400">{error.message}</p>
        <a href="/index.html" className="inline-block mt-4 text-pink-400 hover:underline">返回首页</a>
      </div>
    </div>
  ),
});

function AdminPage() {
  const navigate = useNavigate();
  const list = useServerFn(listUsers);
  const ban = useServerFn(setBanned);
  const del = useServerFn(deleteUser);
  const adj = useServerFn(adjustCredits);
  const getBonus = useServerFn(getSignupBonus);
  const saveBonus = useServerFn(setSignupBonus);
  const getCfg = useServerFn(getApiConfig);
  const saveCfg = useServerFn(setApiConfig);
  const [busy, setBusy] = useState<string | null>(null);
  const [bonus, setBonus] = useState<number | "">("");
  const [savingBonus, setSavingBonus] = useState(false);
  const [apiEndpoint, setApiEndpoint] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [savingCfg, setSavingCfg] = useState(false);
  const [defaults, setDefaults] = useState<{ endpoint: string; token: string } | null>(null);

  useEffect(() => {
    getBonus().then((r) => setBonus(r.value)).catch(() => {});
    getCfg()
      .then((r) => {
        setApiEndpoint(r.endpoint);
        setApiToken(r.token);
        setDefaults(r.defaults);
      })
      .catch(() => {});
  }, []);

  const onSaveBonus = async () => {
    const v = typeof bonus === "number" ? bonus : parseInt(String(bonus), 10);
    if (!Number.isFinite(v) || v < 0) return alert("请输入 0 或正整数");
    setSavingBonus(true);
    try {
      await saveBonus({ data: { value: v } });
      alert(`已保存：新用户注册赠送 ${v} 次`);
    } catch (e: any) {
      alert(e?.message || "保存失败");
    } finally {
      setSavingBonus(false);
    }
  };

  const onSaveCfg = async () => {
    const ep = apiEndpoint.trim();
    const tk = apiToken.trim();
    if (!/^https?:\/\//i.test(ep)) return alert("接口地址必须以 http(s):// 开头");
    setSavingCfg(true);
    try {
      await saveCfg({ data: { endpoint: ep, token: tk } });
      alert("API 配置已保存");
    } catch (e: any) {
      alert(e?.message || "保存失败");
    } finally {
      setSavingCfg(false);
    }
  };

  const onResetCfg = () => {
    if (!defaults) return;
    setApiEndpoint(defaults.endpoint);
    setApiToken(defaults.token);
  };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => list(),
  });

  const onBan = async (id: string, banned: boolean) => {
    setBusy(id);
    try {
      await ban({ data: { userId: id, banned } });
      await refetch();
    } catch (e: any) {
      alert(e?.message || "操作失败");
    } finally {
      setBusy(null);
    }
  };
  const onDelete = async (id: string, email: string) => {
    if (!confirm(`确定删除用户 ${email}？此操作无法撤销。`)) return;
    setBusy(id);
    try {
      await del({ data: { userId: id } });
      await refetch();
    } catch (e: any) {
      alert(e?.message || "操作失败");
    } finally {
      setBusy(null);
    }
  };

  const onAdjust = async (id: string, delta: number) => {
    let d = delta;
    if (delta === 0) {
      const v = prompt("输入增减次数（正数增加，负数减少）", "10");
      if (!v) return;
      d = parseInt(v, 10);
      if (!Number.isFinite(d) || d === 0) return;
    }
    setBusy(id);
    try {
      await adj({ data: { userId: id, delta: d } });
      await refetch();
    } catch (e: any) {
      alert(e?.message || "操作失败");
    } finally {
      setBusy(null);
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    window.location.replace("/index.html");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-lg font-bold">管理员后台 · 用户列表</h1>
          <div className="flex gap-2">
            <a href="/index.html" className="text-sm px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700">返回应用</a>
            <button onClick={logout} className="text-sm px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700">退出登录</button>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">
        <section className="mb-6 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <h2 className="text-base font-bold mb-1">注册赠送设置</h2>
          <p className="text-xs text-slate-400 mb-3">新用户注册成功后自动赠送的解析次数（管理员账号始终不限）。</p>
          <div className="flex items-center gap-3">
            <label className="text-sm text-slate-300">默认赠送：</label>
            <input
              type="number"
              min={0}
              value={bonus}
              onChange={(e) => setBonus(e.target.value === "" ? "" : parseInt(e.target.value, 10))}
              className="w-28 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:border-pink-500"
            />
            <span className="text-sm text-slate-400">次</span>
            <button
              onClick={onSaveBonus}
              disabled={savingBonus || bonus === ""}
              className="ml-2 px-4 py-2 rounded-lg bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white text-sm font-semibold disabled:opacity-50"
            >
              {savingBonus ? "保存中..." : "保存"}
            </button>
          </div>
        </section>

        <section className="mb-6 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <h2 className="text-base font-bold mb-1">解析 API 配置</h2>
          <p className="text-xs text-slate-400 mb-3">配置视频解析接口地址与密钥，保存后立即对所有用户生效。</p>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">API 接口地址</label>
              <input
                type="text"
                value={apiEndpoint}
                onChange={(e) => setApiEndpoint(e.target.value)}
                placeholder="https://v3.alapi.cn/api/video/url"
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm font-mono focus:outline-none focus:border-pink-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">API 密钥 (Token)</label>
              <div className="flex gap-2">
                <input
                  type={showToken ? "text" : "password"}
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  placeholder="（留空将使用模拟数据）"
                  className="flex-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm font-mono focus:outline-none focus:border-pink-500"
                />
                <button
                  type="button"
                  onClick={() => setShowToken((s) => !s)}
                  className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
                >
                  {showToken ? "隐藏" : "显示"}
                </button>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={onSaveCfg}
                disabled={savingCfg}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white text-sm font-semibold disabled:opacity-50"
              >
                {savingCfg ? "保存中..." : "保存配置"}
              </button>
              <button
                onClick={onResetCfg}
                disabled={!defaults}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm disabled:opacity-50"
              >
                恢复默认
              </button>
            </div>
          </div>
        </section>

        {isLoading && <p className="text-slate-400">加载中...</p>}
        {error && <p className="text-red-400">加载失败：{(error as Error).message}</p>}
        {data && (
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-slate-400">
                <tr>
                  <th className="text-left px-4 py-3">邮箱</th>
                  <th className="text-left px-4 py-3">角色</th>
                  <th className="text-left px-4 py-3">剩余次数</th>
                  <th className="text-left px-4 py-3">注册时间</th>
                  <th className="text-left px-4 py-3">最近登录</th>
                  <th className="text-left px-4 py-3">状态</th>
                  <th className="text-right px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.map((u) => (
                  <tr key={u.id} className="border-t border-slate-800 hover:bg-slate-900/50">
                    <td className="px-4 py-3 font-mono text-xs">{u.email}</td>
                    <td className="px-4 py-3">
                      {u.roles.includes("admin") ? (
                        <span className="px-2 py-0.5 rounded bg-pink-500/20 text-pink-300 text-xs">admin</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-slate-700 text-slate-300 text-xs">user</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          disabled={busy === u.id}
                          onClick={() => onAdjust(u.id, -1)}
                          className="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 text-xs disabled:opacity-50"
                        >−</button>
                        <span className={`px-2 font-mono text-sm ${u.credits === 0 ? "text-red-400" : "text-slate-200"}`}>{u.credits}</span>
                        <button
                          disabled={busy === u.id}
                          onClick={() => onAdjust(u.id, 1)}
                          className="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 text-xs disabled:opacity-50"
                        >+</button>
                        <button
                          disabled={busy === u.id}
                          onClick={() => onAdjust(u.id, 0)}
                          className="ml-1 px-2 h-6 rounded bg-slate-800 hover:bg-slate-700 text-xs disabled:opacity-50"
                        >自定义</button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-400">{new Date(u.created_at).toLocaleString("zh-CN")}</td>
                    <td className="px-4 py-3 text-slate-400">{u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString("zh-CN") : "—"}</td>
                    <td className="px-4 py-3">
                      {u.banned ? (
                        <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-300 text-xs">已封禁</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-green-500/20 text-green-300 text-xs">正常</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                      <button
                        disabled={busy === u.id}
                        onClick={() => onBan(u.id, !u.banned)}
                        className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs disabled:opacity-50"
                      >
                        {u.banned ? "解封" : "封禁"}
                      </button>
                      <button
                        disabled={busy === u.id}
                        onClick={() => onDelete(u.id, u.email)}
                        className="px-3 py-1 rounded bg-red-600/80 hover:bg-red-600 text-white text-xs disabled:opacity-50"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
                {data.length === 0 && (
                  <tr><td colSpan={7} className="text-center text-slate-500 py-8">暂无用户</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}