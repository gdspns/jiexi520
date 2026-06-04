import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({ meta: [{ title: "登录 / 注册 - 音影无损" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        const sp = new URLSearchParams(window.location.search);
        window.location.replace(sp.get("redirect") || "/index.html");
      }
    });
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + "/auth" },
        });
        if (error) throw error;
        setMsg("注册成功！如开启了邮箱验证请先去邮箱验证，否则可直接登录。");
        setMode("login");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        const sp = new URLSearchParams(window.location.search);
        window.location.replace(sp.get("redirect") || "/index.html");
      }
    } catch (e: any) {
      setErr(e?.message || "操作失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "linear-gradient(135deg,#0f172a,#1e1b4b)" }}>
      <div className="w-full max-w-md bg-slate-900/70 border border-slate-700 rounded-2xl p-8 shadow-2xl backdrop-blur">
        <h1 className="text-2xl font-bold text-white text-center mb-1">音影无损</h1>
        <p className="text-sm text-slate-400 text-center mb-6">
          {mode === "login" ? "登录以使用解析与本地转换功能" : "创建账号"}
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-xs text-slate-400">邮箱</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full px-4 py-3 rounded-lg bg-slate-800 border border-slate-700 text-white focus:outline-none focus:border-pink-500"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">密码</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full px-4 py-3 rounded-lg bg-slate-800 border border-slate-700 text-white focus:outline-none focus:border-pink-500"
              placeholder="至少 6 位"
            />
          </div>
          {err && <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded p-2">{err}</div>}
          {msg && <div className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded p-2">{msg}</div>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg font-semibold text-white bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 disabled:opacity-60 transition"
          >
            {loading ? "处理中..." : mode === "login" ? "登录" : "注册"}
          </button>
        </form>
        <div className="mt-6 text-center text-sm text-slate-400">
          {mode === "login" ? (
            <>还没有账号？ <button onClick={() => setMode("signup")} className="text-pink-400 hover:underline">立即注册</button></>
          ) : (
            <>已有账号？ <button onClick={() => setMode("login")} className="text-pink-400 hover:underline">去登录</button></>
          )}
        </div>
        <div className="mt-4 text-center">
          <a href="/index.html" className="text-xs text-slate-500 hover:text-slate-300">← 返回首页</a>
        </div>
      </div>
    </div>
  );
}