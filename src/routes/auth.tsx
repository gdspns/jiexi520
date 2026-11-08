import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({ meta: [{ title: "登录 / 注册 - 音影无损" }] }),
  component: AuthPage,
});

type Mode = "login" | "signup";
type SignupStep = "email" | "code" | "password";

function AuthPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<SignupStep>("email");
  const [cooldown, setCooldown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    timerRef.current = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [cooldown]);

  const resetSignup = () => {
    setStep("email");
    setCode("");
    setPassword("");
    setCooldown(0);
    setErr(null);
    setMsg(null);
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setErr(null);
    setMsg(null);
    resetSignup();
  };

  // 注册第一步：给邮箱发送 6 位验证码（Supabase Auth OTP）
  const sendCode = async () => {
    setErr(null);
    setMsg(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setErr("请输入正确的邮箱地址");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: true },
      });
      if (error) throw error;
      setStep("code");
      setCooldown(60);
      setMsg(`验证码已发送到 ${email.trim()}，请查收（含垃圾箱），10 分钟内有效。`);
    } catch (e: any) {
      const text = String(e?.message || "");
      if (/rate limit|too many/i.test(text)) setErr("发送太频繁，请稍后再试（同一邮箱 60 秒内只能发一次）");
      else if (/smtp|email.*not.*configured/i.test(text)) setErr("邮件服务未配置，请联系管理员配置发信 SMTP");
      else setErr(text || "验证码发送失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  // 注册第二步：校验验证码，通过后即完成邮箱验证并登录
  const verifyCode = async () => {
    setErr(null);
    setMsg(null);
    const token = code.trim();
    if (!/^\d{6}$/.test(token)) {
      setErr("请输入邮件里的 6 位数字验证码");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token,
        type: "email",
      });
      if (error) throw error;
      setStep("password");
      setMsg("邮箱验证成功！再设置一个密码即可用密码登录（已有账号可直接跳过）。");
    } catch (e: any) {
      const text = String(e?.message || "");
      if (/expired|invalid|token/i.test(text)) setErr("验证码错误或已过期，请重新获取");
      else setErr(text || "验证失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  // 注册第三步：设置密码（可选），完成后进入站点
  const finishSignup = async (skipPassword = false) => {
    setErr(null);
    setMsg(null);
    if (!skipPassword) {
      if (password.length < 6) {
        setErr("密码至少 6 位");
        return;
      }
      setLoading(true);
      try {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
      } catch (e: any) {
        setErr(e?.message || "密码设置失败，请稍后重试");
        setLoading(false);
        return;
      }
      setLoading(false);
    }
    const sp = new URLSearchParams(window.location.search);
    const redirect = sp.get("redirect") || "/index.html";
    setMsg("注册完成，即将进入站点…");
    await new Promise((r) => window.setTimeout(r, 700));
    window.location.replace(redirect);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    if (mode === "signup") {
      if (step === "email") return sendCode();
      if (step === "code") return verifyCode();
      return finishSignup();
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      setMsg("登录成功，即将返回首页…");
      const sp = new URLSearchParams(window.location.search);
      const redirect = sp.get("redirect") || "/index.html";
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      window.location.replace(redirect);
    } catch (e: any) {
      setErr(e?.message || "操作失败");
    } finally {
      setLoading(false);
    }
  };

  const isSignup = mode === "signup";
  const submitLabel = loading
    ? "处理中..."
    : !isSignup
      ? "登录"
      : step === "email"
        ? "发送验证码"
        : step === "code"
          ? "验证并注册"
          : "完成注册";

  const stepHint = !isSignup
    ? "登录以使用解析与本地转换功能"
    : step === "email"
      ? "输入邮箱，我们会发送 6 位验证码"
      : step === "code"
        ? "填写邮箱收到的验证码"
        : "设置登录密码";

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "linear-gradient(135deg,#0f172a,#1e1b4b)" }}>
      <div className="w-full max-w-md bg-slate-900/70 border border-slate-700 rounded-2xl p-8 shadow-2xl backdrop-blur">
        <h1 className="text-2xl font-bold text-white text-center mb-1">音影无损</h1>
        <p className="text-sm text-slate-400 text-center mb-2">{stepHint}</p>

        {/* 注册进度：邮箱 → 验证码 → 密码 */}
        {isSignup && (
          <div className="mb-6 flex items-center justify-center gap-2 text-[11px]">
            {[
              { key: "email", label: "邮箱" },
              { key: "code", label: "验证码" },
              { key: "password", label: "密码" },
            ].map((s, i) => {
              const order = { email: 0, code: 1, password: 2 } as const;
              const done = order[step] > i;
              const active = order[step] === i;
              return (
                <div key={s.key} className="flex items-center gap-2">
                  <span
                    className={
                      "px-2.5 py-1 rounded-full border " +
                      (active
                        ? "border-pink-500 text-pink-400 bg-pink-500/10"
                        : done
                          ? "border-green-500/40 text-green-400 bg-green-500/10"
                          : "border-slate-700 text-slate-500")
                    }
                  >
                    {done ? "✓ " : ""}
                    {s.label}
                  </span>
                  {i < 2 && <span className="text-slate-600">→</span>}
                </div>
              );
            })}
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-xs text-slate-400">邮箱</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isSignup && step !== "email"}
              className="mt-1 w-full px-4 py-3 rounded-lg bg-slate-800 border border-slate-700 text-white focus:outline-none focus:border-pink-500 disabled:opacity-60"
              placeholder="you@example.com"
            />
          </div>

          {/* 验证码步骤 */}
          {isSignup && step === "code" && (
            <div>
              <label className="text-xs text-slate-400">验证码</label>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="mt-1 w-full px-4 py-3 rounded-lg bg-slate-800 border border-slate-700 text-white text-center text-xl tracking-[0.5em] font-mono focus:outline-none focus:border-pink-500"
                placeholder="000000"
              />
              <div className="mt-2 flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={sendCode}
                  disabled={cooldown > 0 || loading}
                  className="text-pink-400 hover:underline disabled:text-slate-500 disabled:no-underline"
                >
                  {cooldown > 0 ? `${cooldown}s 后可重新发送` : "重新发送验证码"}
                </button>
                <button type="button" onClick={resetSignup} className="text-slate-400 hover:text-slate-200">
                  换个邮箱
                </button>
              </div>
            </div>
          )}

          {/* 密码步骤（注册）或普通登录密码 */}
          {(!isSignup || step === "password") && (
            <div>
              <label className="text-xs text-slate-400">密码{isSignup ? "（可选，跳过则用验证码登录）" : ""}</label>
              <input
                type="password"
                required={!isSignup}
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full px-4 py-3 rounded-lg bg-slate-800 border border-slate-700 text-white focus:outline-none focus:border-pink-500"
                placeholder="至少 6 位"
              />
            </div>
          )}

          {err && <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded p-2">{err}</div>}
          {msg && <div className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded p-2">{msg}</div>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg font-semibold text-white bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 disabled:opacity-60 transition"
          >
            {submitLabel}
          </button>

          {isSignup && step === "password" && (
            <button
              type="button"
              onClick={() => finishSignup(true)}
              disabled={loading}
              className="w-full py-2.5 rounded-lg text-sm text-slate-300 border border-slate-700 hover:bg-slate-800 disabled:opacity-60 transition"
            >
              跳过，先进入站点
            </button>
          )}
        </form>

        <div className="mt-6 text-center text-sm text-slate-400">
          {!isSignup ? (
            <>还没有账号？ <button onClick={() => switchMode("signup")} className="text-pink-400 hover:underline">立即注册</button></>
          ) : (
            <>已有账号？ <button onClick={() => switchMode("login")} className="text-pink-400 hover:underline">去登录</button></>
          )}
        </div>
        <div className="mt-4 text-center">
          <a href="/index.html" className="text-xs text-slate-500 hover:text-slate-300">← 返回首页</a>
        </div>
      </div>
    </div>
  );
}
