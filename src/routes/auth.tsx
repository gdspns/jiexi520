import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({ meta: [{ title: "登录 / 注册 - 音影无损" }] }),
  component: AuthPage,
});

type Mode = "login" | "signup" | "forgot";
type Step = "email" | "code" | "password";

// 注册仅开放腾讯 / 网易 163 / 新浪邮箱，挡掉临时邮箱与垃圾注册。
// 服务端还有一层 Before User Created Hook（数据库函数）做硬校验，这里只负责提前给提示。
const ALLOWED_EMAIL_DOMAINS = [
  "qq.com",
  "foxmail.com",
  "vip.qq.com",
  "163.com",
  "126.com",
  "sina.com",
  "sina.cn",
  "vip.sina.com",
];

function isAllowedEmail(email: string) {
  const domain = email.split("@")[1]?.trim().toLowerCase() || "";
  return ALLOWED_EMAIL_DOMAINS.includes(domain);
}

const STEP_LABEL = { email: "邮箱", code: "验证码", password: "密码" } as const;
const STEP_ORDER = { email: 0, code: 1, password: 2 } as const;

function AuthPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>("email");
  const [cooldown, setCooldown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  // 拉新邀请：链接形如 /auth?ref=ABCD1234，注册成功后给双方加次数
  const [refCode, setRefCode] = useState("");
  const claimedRef = useRef(false);

  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const r = (sp.get("ref") || sp.get("invite") || "").trim().toUpperCase();
      if (r) {
        setRefCode(r);
        setMode("signup");
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    timerRef.current = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [cooldown]);

  const isSignup = mode === "signup";
  const isForgot = mode === "forgot";
  const isFlow = isSignup || isForgot;

  const resetCodeFlow = () => {
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
    resetCodeFlow();
  };

  // 发送验证码：注册走 signInWithOtp（新用户），找回密码走 resetPasswordForEmail（已有用户）
  const sendCode = async () => {
    setErr(null);
    setMsg(null);
    const addr = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(addr)) {
      setErr("请输入正确的邮箱地址");
      return;
    }
    if (isSignup && !isAllowedEmail(addr)) {
      setErr("仅支持 QQ 邮箱、163 邮箱、新浪邮箱注册，请更换邮箱后再试");
      return;
    }
    setLoading(true);
    try {
      if (isSignup) {
        const { error } = await supabase.auth.signInWithOtp({
          email: addr,
          options: { shouldCreateUser: true },
        });
        if (error) throw error;
        setMsg(`验证码已发送到 ${addr}，请查收（含垃圾箱），10 分钟内有效。`);
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(addr, {
          redirectTo: window.location.origin + "/auth",
        });
        if (error) throw error;
        setMsg(`如果 ${addr} 已注册，重置验证码已发送，请查收（含垃圾箱），10 分钟内有效。`);
      }
      setStep("code");
      setCooldown(60);
    } catch (e: any) {
      const text = String(e?.message || "");
      if (/仅支持/.test(text)) setErr(text);
      else if (/rate limit|too many/i.test(text)) setErr("发送太频繁，请稍后再试（同一邮箱 60 秒内只能发一次）");
      else if (/smtp|email.*not.*configured/i.test(text)) setErr("邮件服务未配置，请联系管理员配置发信 SMTP");
      else setErr(text || "验证码发送失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  // 校验验证码：注册用 email 类型，找回密码用 recovery 类型
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
        email: email.trim().toLowerCase(),
        token,
        type: isSignup ? "email" : "recovery",
      });
      if (error) throw error;

      // 带邀请码注册：此时已登录，立即领取新人奖励（失败不影响注册）
      let rewardText = "";
      if (isSignup && refCode && !claimedRef.current) {
        claimedRef.current = true;
        try {
          const { data } = await (supabase as any).rpc("claim_invite", { p_code: refCode });
          const res = data || {};
          if (res.ok) rewardText = ` 邀请奖励已到账：你获得 ${res.invitee_credits} 次解析次数。`;
          else if (res.reason === "already") rewardText = " 该邀请奖励此前已领取过。";
          else if (res.message) rewardText = ` 邀请奖励未发放：${res.message}。`;
        } catch (e) {
          console.warn("claim_invite failed", e);
        }
      }

      setStep("password");
      setMsg(
        (isSignup
          ? "邮箱验证成功！再设置一个密码即可用密码登录（已有账号可直接跳过）。"
          : "验证成功！请设置新密码。") + rewardText,
      );
    } catch (e: any) {
      const text = String(e?.message || "");
      if (/expired|invalid|token/i.test(text)) setErr("验证码错误或已过期，请重新获取");
      else setErr(text || "验证失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  const goHome = async (text: string) => {
    const sp = new URLSearchParams(window.location.search);
    const redirect = sp.get("redirect") || "/index.html";
    setMsg(text);
    await new Promise((r) => window.setTimeout(r, 700));
    window.location.replace(redirect);
  };

  // 注册第三步：设置密码（可跳过）；找回密码第三步：必须设置新密码
  const finishPassword = async (skip = false) => {
    setErr(null);
    setMsg(null);
    if (!skip) {
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
      if (isForgot) {
        // 重置完直接以新密码登录，省一次输入
        await goHome("密码已重置，正在进入站点…");
        return;
      }
    }
    await goHome(isSignup ? "注册完成，即将进入站点…" : "密码已重置，正在进入站点…");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    if (isFlow) {
      if (step === "email") return sendCode();
      if (step === "code") return verifyCode();
      return finishPassword();
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) throw error;
      await goHome("登录成功，即将返回首页…");
    } catch (e: any) {
      setErr(e?.message || "操作失败");
    } finally {
      setLoading(false);
    }
  };

  const submitLabel = loading
    ? "处理中..."
    : mode === "login"
      ? "登录"
      : step === "email"
        ? "发送验证码"
        : step === "code"
          ? isForgot
            ? "验证并重置"
            : "验证并注册"
          : isForgot
            ? "保存新密码"
            : "完成注册";

  const stepHint =
    mode === "login"
      ? "登录以使用解析与本地转换功能"
      : isSignup
        ? step === "email"
          ? "输入邮箱，我们会发送 6 位验证码"
          : step === "code"
            ? "填写邮箱收到的验证码"
            : "设置登录密码"
        : step === "email"
          ? "输入注册邮箱，我们会发送重置验证码"
          : step === "code"
            ? "填写邮箱收到的重置验证码"
            : "设置新密码";

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "linear-gradient(135deg,#0f172a,#1e1b4b)" }}>
      <div className="w-full max-w-md bg-slate-900/70 border border-slate-700 rounded-2xl p-8 shadow-2xl backdrop-blur">
        <h1 className="text-2xl font-bold text-white text-center mb-1">音影无损</h1>
        <p className="text-sm text-slate-400 text-center mb-2">{stepHint}</p>

        {isSignup && refCode && (
          <div className="mt-3 text-[12px] leading-relaxed text-pink-200 bg-pink-500/10 border border-pink-500/30 rounded-lg px-3 py-2 text-center">
            🎁 好友邀请你加入（邀请码 <span className="font-mono text-pink-300">{refCode}</span>），注册成功即得额外解析次数
          </div>
        )}

        {/* 进度：邮箱 → 验证码 → 密码 */}
        {isFlow && (
          <div className="mb-6 flex items-center justify-center gap-2 text-[11px]">
            {(["email", "code", "password"] as Step[]).map((s, i) => {
              const done = STEP_ORDER[step] > i;
              const active = STEP_ORDER[step] === i;
              return (
                <div key={s} className="flex items-center gap-2">
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
                    {STEP_LABEL[s]}
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
              disabled={isFlow && step !== "email"}
              className="mt-1 w-full px-4 py-3 rounded-lg bg-slate-800 border border-slate-700 text-white focus:outline-none focus:border-pink-500 disabled:opacity-60"
              placeholder={isSignup ? "QQ / 163 / 新浪 邮箱" : "you@example.com"}
            />
            {isSignup && step === "email" && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                仅支持 <span className="text-slate-300">QQ 邮箱（qq.com / foxmail.com）</span>、
                <span className="text-slate-300">163 邮箱</span>、
                <span className="text-slate-300">新浪邮箱</span>，临时邮箱无法注册
              </p>
            )}
          </div>

          {/* 选填邀请码：注册邮箱步骤填写，留空不影响注册 */}
          {isSignup && step === "email" && (
            <div>
              <label className="text-xs text-slate-400">邀请码（选填）</label>
              <input
                type="text"
                autoCapitalize="characters"
                autoComplete="off"
                maxLength={8}
                value={refCode}
                onChange={(e) => setRefCode(e.target.value.trim().toUpperCase())}
                className="mt-1 w-full px-4 py-3 rounded-lg bg-slate-800 border border-slate-700 text-white font-mono tracking-widest focus:outline-none focus:border-amber-500"
                placeholder="8 位好友邀请码"
              />
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                有好友邀请码？填上注册成功双方都能得解析次数；没有可留空
              </p>
            </div>
          )}

          {isForgot && step === "email" && (
            <div className="text-[11px] leading-relaxed text-slate-500">
              忘记密码只需邮箱验证码，验证通过后可直接设置新密码，无需原密码。
            </div>
          )}

          {/* 验证码步骤 */}
          {isFlow && step === "code" && (
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
                <button type="button" onClick={resetCodeFlow} className="text-slate-400 hover:text-slate-200">
                  换个邮箱
                </button>
              </div>
            </div>
          )}

          {/* 密码步骤（注册/重置）或普通登录密码 */}
          {mode === "login" ? (
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-400">密码</label>
                <button
                  type="button"
                  onClick={() => switchMode("forgot")}
                  className="text-xs text-pink-400 hover:underline"
                >
                  忘记密码？
                </button>
              </div>
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
          ) : (
            step === "password" && (
              <div>
                <label className="text-xs text-slate-400">
                  {isForgot ? "新密码" : "密码（可选，跳过则用验证码登录）"}
                </label>
                <input
                  type="password"
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 w-full px-4 py-3 rounded-lg bg-slate-800 border border-slate-700 text-white focus:outline-none focus:border-pink-500"
                  placeholder="至少 6 位"
                />
              </div>
            )
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
              onClick={() => finishPassword(true)}
              disabled={loading}
              className="w-full py-2.5 rounded-lg text-sm text-slate-300 border border-slate-700 hover:bg-slate-800 disabled:opacity-60 transition"
            >
              跳过，先进入站点
            </button>
          )}
        </form>

        <div className="mt-6 text-center text-sm text-slate-400">
          {mode === "login" ? (
            <>还没有账号？ <button onClick={() => switchMode("signup")} className="text-pink-400 hover:underline">立即注册</button></>
          ) : mode === "signup" ? (
            <>已有账号？ <button onClick={() => switchMode("login")} className="text-pink-400 hover:underline">去登录</button></>
          ) : (
            <>想起来了？ <button onClick={() => switchMode("login")} className="text-pink-400 hover:underline">返回登录</button></>
          )}
        </div>
        <div className="mt-4 text-center">
          <a href="/index.html" className="text-xs text-slate-500 hover:text-slate-300">← 返回首页</a>
        </div>
      </div>
    </div>
  );
}
