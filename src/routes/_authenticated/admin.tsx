import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useState } from "react";
import { listUsers, setBanned, deleteUser, adjustCredits, getSignupBonus, setSignupBonus, getApiConfig, setApiConfig, listParseLogs, getInviteReport, getInviteConfig, setInviteRewards } from "@/lib/admin.functions";
import { deleteOrder, getPaymentConfig, listOrdersAdmin, listProductsAdmin, setPaymentConfig, upsertProduct, deleteProduct } from "@/lib/payment.functions";
import { supabase } from "@/integrations/supabase/client";
import { CleanupPanel } from "@/components/cleanup-panel";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    const { data: roles, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id);
    const allowed = data.user.email === "3075554556@qq.com" || roles?.some((item) => item.role === "admin");
    if (roleError || !allowed) throw redirect({ href: "/index.html", statusCode: 302 });
  },
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

type MenuKey = "users" | "settings" | "products" | "orders" | "logs" | "invites" | "maintenance";

function AdminPage() {
  const navigate = useNavigate();
  const [activeMenu, setActiveMenu] = useState<MenuKey>("users");
  const [productMenuOpen, setProductMenuOpen] = useState(false);
  const [maintMenuOpen, setMaintMenuOpen] = useState(true);

  const list = useServerFn(listUsers);
  const ban = useServerFn(setBanned);
  const del = useServerFn(deleteUser);
  const adj = useServerFn(adjustCredits);
  const getBonus = useServerFn(getSignupBonus);
  const saveBonus = useServerFn(setSignupBonus);
  const getCfg = useServerFn(getApiConfig);
  const saveCfg = useServerFn(setApiConfig);
  const getPayCfg = useServerFn(getPaymentConfig);
  const savePayCfg = useServerFn(setPaymentConfig);
  const listProds = useServerFn(listProductsAdmin);
  const saveProd = useServerFn(upsertProduct);
  const removeProd = useServerFn(deleteProduct);
  const listOrders = useServerFn(listOrdersAdmin);
  const removeOrder = useServerFn(deleteOrder);

  const [busy, setBusy] = useState<string | null>(null);
  const [bonus, setBonus] = useState<number | "">("");
  const [savingBonus, setSavingBonus] = useState(false);
  const [apiEndpoint, setApiEndpoint] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [apiProxy, setApiProxy] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [showProxy, setShowProxy] = useState(false);
  const [savingCfg, setSavingCfg] = useState(false);
  const [defaults, setDefaults] = useState<{ endpoint: string; token: string; proxy: string } | null>(null);

  // 支付配置
  const [payCfg, setPayCfg] = useState({
    wechat_appid: "", wechat_appsecret: "", wechat_enabled: false,
    alipay_appid: "", alipay_appsecret: "", alipay_enabled: false,
    api_endpoint: "https://api.xunhupay.com/payment/do.html",
    notify_base_url: "",
    wechat_provider: "xunhu" as "xunhu" | "official", alipay_provider: "xunhu" as "xunhu" | "official",
    official_wechat_app_id: "", official_wechat_mch_id: "", official_wechat_serial_no: "",
    official_wechat_private_key: "", official_wechat_api_v3_key: "", official_wechat_platform_public_key: "",
    official_alipay_app_id: "", official_alipay_private_key: "", official_alipay_public_key: "",
  });
  const [showWxSecret, setShowWxSecret] = useState(false);
  const [showAliSecret, setShowAliSecret] = useState(false);
  const [savingPay, setSavingPay] = useState(false);

  // 商品
  type Product = {
    id?: string;
    name: string;
    price: number;
    credits: number;
    discount_price: number | null;
    enabled: boolean;
    sort_order: number;
    _editing?: boolean;
  };
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProds, setLoadingProds] = useState(false);
  const [savingProdIdx, setSavingProdIdx] = useState<number | null>(null);
  const [savedProdIdx, setSavedProdIdx] = useState<number | null>(null);

  // 订单
  type Order = {
    id: string;
    order_no: string;
    user_id: string;
    product_name: string;
    amount: number;
    credits: number;
    channel: string;
    status: string;
    created_at: string;
    paid_at: string | null;
  };
  const [orders, setOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  // 确认对话框状态
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; orderNo: string } | null>(null);

  const reloadProducts = async () => {
    setLoadingProds(true);
    try {
      const rows = await listProds();
      setProducts(rows as any);
    } finally {
      setLoadingProds(false);
    }
  };

  const reloadOrders = async () => {
    setLoadingOrders(true);
    try {
      const rows = await listOrders();
      setOrders(rows as any);
    } finally {
      setLoadingOrders(false);
    }
  };

  useEffect(() => {
    getBonus().then((r) => setBonus(r.value)).catch(() => {});
    getCfg()
      .then((r) => {
        setApiEndpoint(r.endpoint);
        setApiToken(r.token);
        setApiProxy(r.proxy || "");
        setDefaults(r.defaults);
      })
      .catch(() => {});
    getPayCfg().then((r: any) => setPayCfg({
      wechat_appid: r.wechat_appid || "",
      wechat_appsecret: r.wechat_appsecret || "",
      wechat_enabled: !!r.wechat_enabled,
      alipay_appid: r.alipay_appid || "",
      alipay_appsecret: r.alipay_appsecret || "",
      alipay_enabled: !!r.alipay_enabled,
      api_endpoint: r.api_endpoint || "https://api.xunhupay.com/payment/do.html",
      notify_base_url: r.notify_base_url || "",
      wechat_provider: r.wechat_provider === "official" ? "official" : "xunhu",
      alipay_provider: r.alipay_provider === "official" ? "official" : "xunhu",
      official_wechat_app_id: r.official_wechat_app_id || "",
      official_wechat_mch_id: r.official_wechat_mch_id || "",
      official_wechat_serial_no: r.official_wechat_serial_no || "",
      official_wechat_private_key: r.official_wechat_private_key || "",
      official_wechat_api_v3_key: r.official_wechat_api_v3_key || "",
      official_wechat_platform_public_key: r.official_wechat_platform_public_key || "",
      official_alipay_app_id: r.official_alipay_app_id || "",
      official_alipay_private_key: r.official_alipay_private_key || "",
      official_alipay_public_key: r.official_alipay_public_key || "",
    })).catch(() => {});
    reloadProducts().catch(() => {});
    reloadOrders().catch(() => {});
  }, []);

  const onSavePay = async () => {
    if (!/^https?:\/\//i.test(payCfg.api_endpoint)) return alert("接口地址必须以 http(s):// 开头");
    setSavingPay(true);
    try {
      await savePayCfg({ data: payCfg });
      alert("支付配置已保存");
    } catch (e: any) {
      alert(e?.message || "保存失败");
    } finally {
      setSavingPay(false);
    }
  };

  const onSaveProduct = async (p: Product, idx: number) => {
    if (!p.name.trim()) return alert("请填写商品名称");
    if (!Number.isFinite(p.price) || p.price < 0) return alert("价格非法");
    if (!Number.isFinite(p.credits) || p.credits < 0) return alert("次数非法");
    setSavingProdIdx(idx);
    try {
      const res = await saveProd({ data: {
        id: p.id,
        name: p.name.trim(),
        price: Math.round(p.price),
        credits: Math.round(p.credits),
        discount_price: p.discount_price == null || isNaN(p.discount_price as any) ? null : Math.round(p.discount_price),
        enabled: p.enabled,
        sort_order: Math.round(p.sort_order || 0),
      }});
      if (!p.id && res?.id) {
        setProducts((arr) => arr.map((x, i) => i === idx ? { ...x, id: res.id, _editing: false } : x));
      }
      setSavedProdIdx(idx);
      setTimeout(() => setSavedProdIdx((cur) => (cur === idx ? null : cur)), 1500);
    } catch (e: any) {
      alert(e?.message || "保存失败");
    } finally {
      setSavingProdIdx((cur) => (cur === idx ? null : cur));
    }
  };

  const onDeleteProduct = async (id?: string) => {
    if (!id) { setProducts((arr) => arr.filter((x) => x.id)); return; }
    if (!confirm("确定删除该商品？")) return;
    try { await removeProd({ data: { id } }); await reloadProducts(); }
    catch (e: any) { alert(e?.message || "删除失败"); }
  };

  const onDeleteOrder = (id: string, orderNo: string) => {
    setConfirmTarget({ id, orderNo });
    setConfirmOpen(true);
  };

  const executeDeleteOrder = async () => {
    if (!confirmTarget) return;
    setBusy(confirmTarget.id);
    try {
      await removeOrder({ data: { id: confirmTarget.id } });
      setOrders((arr) => arr.filter((o) => o.id !== confirmTarget.id));
    } catch (e: any) {
      alert(e?.message || "删除失败");
    } finally {
      setBusy(null);
      setConfirmOpen(false);
      setConfirmTarget(null);
    }
  };

  const addNewProduct = () => {
    setProducts((arr) => [
      ...arr,
      { name: "", price: 0, credits: 0, discount_price: null, enabled: true, sort_order: 0, _editing: true },
    ]);
  };

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
    const px = apiProxy.trim();
    if (!/^https?:\/\//i.test(ep)) return alert("接口地址必须以 http(s):// 开头");
    if (px && !/^https?:\/\//i.test(px)) return alert("代理地址必须以 http(s):// 开头（例如 http://user:pass@ip:port）");
    setSavingCfg(true);
    try {
      await saveCfg({ data: { endpoint: ep, token: tk, proxy: px } });
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
    setApiProxy(defaults.proxy || "");
  };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => list(),
    refetchInterval: activeMenu === "users" ? 3_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
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

  const menuItems: { key: MenuKey; label: string; icon: string }[] = [
    { key: "users", label: "用户管理", icon: "👤" },
    { key: "settings", label: "系统配置", icon: "⚙️" },
    { key: "logs", label: "解析日志", icon: "📜" },
    { key: "invites", label: "邀请拉新", icon: "🎁" },
  ];

  const switchMenu = (key: MenuKey) => {
    setActiveMenu(key);
    if (key === "products" || key === "orders") {
      setProductMenuOpen(true);
    }
  };

  const sidebarItemClass = (key: MenuKey) =>
    `w-full text-left px-4 py-2.5 rounded-lg text-sm flex items-center gap-2 transition-colors ${
      activeMenu === key ? "bg-pink-600/20 text-pink-300 font-semibold" : "text-slate-300 hover:bg-slate-800"
    }`;

  const subItemClass = (key: MenuKey) =>
    `w-full text-left pl-10 pr-4 py-2 rounded-lg text-sm transition-colors ${
      activeMenu === key ? "bg-pink-600/10 text-pink-300 font-medium" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
    }`;

  return (
    <div className="notranslate min-h-screen bg-slate-950 text-slate-100 flex" translate="no">
      {/* Sidebar */}
      <aside className="w-56 border-r border-slate-800 bg-slate-900/60 flex flex-col shrink-0">
        <div className="px-4 py-5 border-b border-slate-800">
          <h1 className="text-base font-bold text-slate-100">管理员后台</h1>
          <p className="text-xs text-slate-500 mt-0.5">音影无损</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {menuItems.map((m) => (
            <button key={m.key} onClick={() => switchMenu(m.key)} className={sidebarItemClass(m.key)}>
              <span>{m.icon}</span>
              <span>{m.label}</span>
            </button>
          ))}

          {/* 商品管理 可展开 */}
          <div>
            <button
              onClick={() => setProductMenuOpen((v) => !v)}
              className={`w-full text-left px-4 py-2.5 rounded-lg text-sm flex items-center justify-between transition-colors ${
                activeMenu === "products" || activeMenu === "orders"
                  ? "bg-pink-600/20 text-pink-300 font-semibold"
                  : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              <span className="flex items-center gap-2">
                <span>🛒</span>
                <span>商品管理</span>
              </span>
              <span className="text-xs transition-transform duration-200" style={{ transform: productMenuOpen ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
            </button>
            {productMenuOpen && (
              <div className="mt-1 space-y-0.5">
                <button onClick={() => switchMenu("products")} className={subItemClass("products")}>
                  充值商品管理
                </button>
                <button onClick={() => switchMenu("orders")} className={subItemClass("orders")}>
                  订单管理
                </button>
              </div>
            )}
          </div>

          {/* 系统维护 可展开 */}
          <div>
            <button
              onClick={() => setMaintMenuOpen((v) => !v)}
              className={`w-full text-left px-4 py-2.5 rounded-lg text-sm flex items-center justify-between transition-colors ${
                activeMenu === "maintenance"
                  ? "bg-pink-600/20 text-pink-300 font-semibold"
                  : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              <span className="flex items-center gap-2">
                <span>🧹</span>
                <span>系统维护</span>
              </span>
              <span className="text-xs transition-transform duration-200" style={{ transform: maintMenuOpen ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
            </button>
            {maintMenuOpen && (
              <div className="mt-1 space-y-0.5">
                <button onClick={() => switchMenu("maintenance")} className={subItemClass("maintenance")}>
                  定时清理
                </button>
              </div>
            )}
          </div>
        </nav>
        <div className="px-3 py-4 border-t border-slate-800 space-y-1">
          <a href="/index.html" className="block text-center text-sm px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200">
            返回应用
          </a>
          <button onClick={logout} className="w-full text-center text-sm px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200">
            退出登录
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0">
        <header className="border-b border-slate-800 bg-slate-900/40 px-6 py-4 sticky top-0 z-10">
          <h2 className="text-lg font-bold">
            {activeMenu === "users" && "用户管理"}
            {activeMenu === "settings" && "系统配置"}
            {activeMenu === "products" && "充值商品管理"}
            {activeMenu === "orders" && "订单管理"}
            {activeMenu === "logs" && "解析日志"}
            {activeMenu === "invites" && "邀请拉新"}
            {activeMenu === "maintenance" && "系统维护 / 定时清理"}
          </h2>
        </header>

        <div className="px-6 py-6 max-w-6xl">
          {/* ========== 用户管理 ========== */}
          {activeMenu === "users" && (
            <>
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
                              <input
                                type="number"
                                min={0}
                                defaultValue={u.credits}
                                key={`${u.id}-${u.credits}`}
                                disabled={busy === u.id}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                }}
                                onBlur={(e) => {
                                  const v = parseInt(e.target.value, 10);
                                  if (!Number.isFinite(v) || v < 0) {
                                    e.target.value = String(u.credits);
                                    return;
                                  }
                                  const delta = v - u.credits;
                                  if (delta === 0) return;
                                  onAdjust(u.id, delta);
                                }}
                                className={`w-16 px-2 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-sm text-center focus:outline-none focus:border-pink-500 ${u.credits === 0 ? "text-red-400" : "text-slate-200"}`}
                              />
                              <button
                                disabled={busy === u.id}
                                onClick={() => onAdjust(u.id, 1)}
                                className="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 text-xs disabled:opacity-50"
                              >+</button>
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
            </>
          )}

          {/* ========== 系统配置 ========== */}
          {activeMenu === "settings" && (
            <div className="space-y-6">
              <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
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

              <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
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
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      海外代理 (Proxy) — 用于 TikTok / YouTube 等海外平台
                    </label>
                    <div className="flex gap-2">
                      <input
                        type={showProxy ? "text" : "password"}
                        value={apiProxy}
                        onChange={(e) => setApiProxy(e.target.value)}
                        placeholder="http://user:pass@ip:port （留空则不使用代理）"
                        className="flex-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm font-mono focus:outline-none focus:border-pink-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowProxy((s) => !s)}
                        className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
                      >
                        {showProxy ? "隐藏" : "显示"}
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      支持 ISP 静态住宅代理。海外平台解析将通过此代理由 yt-dlp 抓取，需 Node.js 部署环境（Zeabur）。
                    </p>
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

              <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
                <h2 className="text-base font-bold mb-1">支付配置（虎皮椒 / 官方商户）</h2>
                <p className="text-xs text-slate-400 mb-3">微信、支付宝可分别选择虎皮椒或官方商户，保留原虎皮椒配置随时切换。</p>
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="rounded-lg border border-slate-800 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-bold text-green-300">微信支付</h3>
                      <label className="flex items-center gap-2 text-xs text-slate-300">
                        <input type="checkbox" checked={payCfg.wechat_enabled} onChange={(e) => setPayCfg({ ...payCfg, wechat_enabled: e.target.checked })} />
                        启用
                      </label>
                    </div>
                    <label className="block text-xs text-slate-400 mb-1">支付渠道</label>
                    <select value={payCfg.wechat_provider} onChange={(e) => setPayCfg({ ...payCfg, wechat_provider: e.target.value as "xunhu" | "official" })} className="w-full mb-3 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm">
                      <option value="xunhu">虎皮椒</option><option value="official">微信支付官方商户（Native）</option>
                    </select>
                    {payCfg.wechat_provider === "xunhu" ? <>
                    <label className="block text-xs text-slate-400 mb-1">商户号 (appid)</label>
                    <input value={payCfg.wechat_appid} onChange={(e) => setPayCfg({ ...payCfg, wechat_appid: e.target.value })}
                      placeholder="微信 appid" className="w-full mb-2 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm font-mono focus:outline-none focus:border-pink-500" />
                    <label className="block text-xs text-slate-400 mb-1">密钥 (appsecret)</label>
                    <div className="flex gap-2">
                      <input type={showWxSecret ? "text" : "password"} value={payCfg.wechat_appsecret} onChange={(e) => setPayCfg({ ...payCfg, wechat_appsecret: e.target.value })}
                        placeholder="微信 appsecret" className="flex-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm font-mono focus:outline-none focus:border-pink-500" />
                      <button type="button" onClick={() => setShowWxSecret((s) => !s)} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs">{showWxSecret ? "隐藏" : "显示"}</button>
                    </div>
                    </> : <div className="space-y-2">
                      <input value={payCfg.official_wechat_app_id} onChange={e => setPayCfg({...payCfg, official_wechat_app_id:e.target.value})} placeholder="公众号/应用 AppID" className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm font-mono" />
                      <input value={payCfg.official_wechat_mch_id} onChange={e => setPayCfg({...payCfg, official_wechat_mch_id:e.target.value})} placeholder="微信支付商户号 mchid" className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm font-mono" />
                      <input value={payCfg.official_wechat_serial_no} onChange={e => setPayCfg({...payCfg, official_wechat_serial_no:e.target.value})} placeholder="商户 API 证书序列号" className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm font-mono" />
                      <input type="password" value={payCfg.official_wechat_api_v3_key} onChange={e => setPayCfg({...payCfg, official_wechat_api_v3_key:e.target.value})} placeholder="API v3 密钥（32位）" className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm font-mono" />
                      <textarea rows={4} value={payCfg.official_wechat_private_key} onChange={e => setPayCfg({...payCfg, official_wechat_private_key:e.target.value})} placeholder="商户私钥 PEM" className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs font-mono" />
                      <textarea rows={4} value={payCfg.official_wechat_platform_public_key} onChange={e => setPayCfg({...payCfg, official_wechat_platform_public_key:e.target.value})} placeholder="微信支付公钥/平台证书公钥 PEM" className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs font-mono" />
                    </div>}
                  </div>

                  <div className="rounded-lg border border-slate-800 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-bold text-blue-300">支付宝</h3>
                      <label className="flex items-center gap-2 text-xs text-slate-300">
                        <input type="checkbox" checked={payCfg.alipay_enabled} onChange={(e) => setPayCfg({ ...payCfg, alipay_enabled: e.target.checked })} />
                        启用
                      </label>
                    </div>
                    <label className="block text-xs text-slate-400 mb-1">支付渠道</label>
                    <select value={payCfg.alipay_provider} onChange={(e) => setPayCfg({ ...payCfg, alipay_provider: e.target.value as "xunhu" | "official" })} className="w-full mb-3 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm">
                      <option value="xunhu">虎皮椒</option><option value="official">支付宝官方商户（当面付）</option>
                    </select>
                    {payCfg.alipay_provider === "xunhu" ? <>
                    <label className="block text-xs text-slate-400 mb-1">商户号 (appid)</label>
                    <input value={payCfg.alipay_appid} onChange={(e) => setPayCfg({ ...payCfg, alipay_appid: e.target.value })}
                      placeholder="支付宝 appid" className="w-full mb-2 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm font-mono focus:outline-none focus:border-pink-500" />
                    <label className="block text-xs text-slate-400 mb-1">密钥 (appsecret)</label>
                    <div className="flex gap-2">
                      <input type={showAliSecret ? "text" : "password"} value={payCfg.alipay_appsecret} onChange={(e) => setPayCfg({ ...payCfg, alipay_appsecret: e.target.value })}
                        placeholder="支付宝 appsecret" className="flex-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm font-mono focus:outline-none focus:border-pink-500" />
                      <button type="button" onClick={() => setShowAliSecret((s) => !s)} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs">{showAliSecret ? "隐藏" : "显示"}</button>
                    </div>
                    </> : <div className="space-y-2">
                      <input value={payCfg.official_alipay_app_id} onChange={e => setPayCfg({...payCfg, official_alipay_app_id:e.target.value})} placeholder="支付宝开放平台 AppID" className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm font-mono" />
                      <textarea rows={5} value={payCfg.official_alipay_private_key} onChange={e => setPayCfg({...payCfg, official_alipay_private_key:e.target.value})} placeholder="应用私钥 PEM（不是应用公钥）" className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs font-mono" />
                      <textarea rows={5} value={payCfg.official_alipay_public_key} onChange={e => setPayCfg({...payCfg, official_alipay_public_key:e.target.value})} placeholder="支付宝公钥 PEM（不是应用公钥）" className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs font-mono" />
                    </div>}
                  </div>
                </div>
                <div className="mt-3">
                  <label className="block text-xs text-slate-400 mb-1">虎皮椒接口地址</label>
                  <input value={payCfg.api_endpoint} onChange={(e) => setPayCfg({ ...payCfg, api_endpoint: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm font-mono focus:outline-none focus:border-pink-500" />
                  <p className="text-[11px] text-slate-500 mt-1">仅在支付渠道选「虎皮椒」时使用。选官方商户后请忽略此项。回调地址会自动设为 /api/public/xunhupay-notify。</p>
                </div>
                <div className="mt-3">
                  <label className="block text-xs text-slate-400 mb-1">异步回调域名（重要）</label>
                  <input value={payCfg.notify_base_url} onChange={(e) => setPayCfg({ ...payCfg, notify_base_url: e.target.value })}
                    placeholder="https://www.你的域名.com"
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm font-mono focus:outline-none focus:border-pink-500" />
                  <p className="text-[11px] text-yellow-400/80 mt-1">⚠ 只能填一个：填你的<span className="text-slate-200">主域名</span>（正式、公网可访问、不要预览域名）。留空则每笔订单自动使用用户当时访问的域名。虎皮椒和官方支付都用这一项。</p>
                  {(() => {
                    const origin = typeof window !== "undefined" ? window.location.origin : "";
                    const configured = (payCfg.notify_base_url || "").replace(/\/+$/, "");
                    const base = configured || origin;
                    const diff = Boolean(configured && origin && configured !== origin);
                    return (
                      <div className="mt-2 rounded-lg bg-slate-800/60 border border-slate-700 p-2">
                        <p className="text-[11px] text-slate-400 mb-1">当前生效的回调地址（支付宝和微信用同一个，可用浏览器直接打开自检）：</p>
                        <p className="text-[11px] font-mono text-slate-300 break-all">{base}/api/public/official-payment-notify</p>
                        <p className="text-[11px] text-slate-500 mt-1">⚠ 支付宝/微信都禁止 notify_url 携带参数，所以这里是干净路径；两个渠道由接口按报文体自动识别，不需要你区分。</p>
                        <p className="text-[11px] text-slate-500 mt-2">
                          现在是：{configured ? "固定发往上面这个域名" : `跟随访问域名（当前为 ${origin || "未知"}）`}。
                          {diff ? `注意：你正从 ${origin} 访问，但回调会发往 ${configured}，只要两个域名指向同一个站点就没问题。` : ""}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-1">多个域名指向同一站点时：填主域名即可，用户从任意域名下单，通知都会发到主域名；订单存在数据库里，跟域名无关，不会串单。付款后的页面跳转始终用用户自己访问的域名。</p>
                        <p className="text-[11px] text-yellow-400/80 mt-2">⚠ 若站点前面套了 Cloudflare：必须关闭 Bot Fight Mode / 对该路径放行 POST，否则支付宝、微信的异步通知会被质询页拦掉（表现为“付了钱不到账、页面不跳转”）。即使通知被拦，系统也会在轮询时主动查单补单，不会漏单。</p>
                      </div>
                    );
                  })()}
                </div>
                <div className="mt-4">
                  <button onClick={onSavePay} disabled={savingPay}
                    className="px-4 py-2 rounded-lg bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white text-sm font-semibold disabled:opacity-50">
                    {savingPay ? "保存中..." : "保存支付配置"}
                  </button>
                </div>
              </section>
            </div>
          )}

          {/* ========== 充值商品管理 ========== */}
          {activeMenu === "products" && (
            <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h2 className="text-base font-bold">充值商品管理</h2>
                  <p className="text-xs text-slate-400 mt-1">价格与折扣价以元为单位，支持两位小数（如 9.90）。次数为该商品支付成功后赠送的解析次数。</p>
                </div>
                <button onClick={addNewProduct} className="px-3 py-1.5 rounded-md bg-pink-600 hover:bg-pink-500 text-white text-xs font-semibold">+ 新增商品</button>
              </div>
              {loadingProds ? (
                <p className="text-slate-400 text-sm">加载中...</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-800">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-900 text-slate-400">
                      <tr>
                        <th className="text-left px-3 py-2">名称</th>
                        <th className="text-left px-3 py-2 w-24">原价(元)</th>
                        <th className="text-left px-3 py-2 w-24">折扣价(元)</th>
                        <th className="text-left px-3 py-2 w-20">次数</th>
                        <th className="text-left px-3 py-2 w-20">排序</th>
                        <th className="text-left px-3 py-2 w-16">启用</th>
                        <th className="text-right px-3 py-2 w-44">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.map((p, idx) => (
                        <tr key={p.id ?? `new-${idx}`} className="border-t border-slate-800">
                          <td className="px-3 py-2"><input value={p.name} onChange={(e) => setProducts((arr) => arr.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))} className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-100" /></td>
                          <td className="px-3 py-2"><input type="number" step="0.01" min="0" value={(p.price / 100).toString()} onChange={(e) => setProducts((arr) => arr.map((x, i) => i === idx ? { ...x, price: Math.round((parseFloat(e.target.value) || 0) * 100) } : x))} className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-100 font-mono" /></td>
                          <td className="px-3 py-2"><input type="number" step="0.01" min="0" value={p.discount_price == null ? "" : (p.discount_price / 100).toString()} placeholder="可空" onChange={(e) => setProducts((arr) => arr.map((x, i) => i === idx ? { ...x, discount_price: e.target.value === "" ? null : Math.round((parseFloat(e.target.value) || 0) * 100) } : x))} className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-100 font-mono" /></td>
                          <td className="px-3 py-2"><input type="number" value={p.credits} onChange={(e) => setProducts((arr) => arr.map((x, i) => i === idx ? { ...x, credits: parseInt(e.target.value) || 0 } : x))} className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-100 font-mono" /></td>
                          <td className="px-3 py-2"><input type="number" value={p.sort_order} onChange={(e) => setProducts((arr) => arr.map((x, i) => i === idx ? { ...x, sort_order: parseInt(e.target.value) || 0 } : x))} className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-100 font-mono" /></td>
                          <td className="px-3 py-2 text-center"><input type="checkbox" checked={p.enabled} onChange={(e) => setProducts((arr) => arr.map((x, i) => i === idx ? { ...x, enabled: e.target.checked } : x))} /></td>
                          <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
                            <button
                              onClick={() => onSaveProduct(p, idx)}
                              disabled={savingProdIdx === idx}
                              className={`px-3 py-1 rounded text-white text-xs transition-colors ${
                                savedProdIdx === idx
                                  ? "bg-emerald-500"
                                  : savingProdIdx === idx
                                    ? "bg-slate-600 cursor-wait"
                                    : "bg-green-600/80 hover:bg-green-600"
                              }`}
                            >
                              {savingProdIdx === idx ? "保存中..." : savedProdIdx === idx ? "✓ 已保存" : "保存"}
                            </button>
                            <button onClick={() => onDeleteProduct(p.id)} className="px-3 py-1 rounded bg-red-600/80 hover:bg-red-600 text-white text-xs">删除</button>
                          </td>
                        </tr>
                      ))}
                      {products.length === 0 && (
                        <tr><td colSpan={7} className="text-center text-slate-500 py-6">暂无商品，点击右上角"新增商品"添加</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* ========== 订单管理 ========== */}
          {activeMenu === "orders" && (
            <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-bold">订单管理</h2>
                  <p className="text-xs text-slate-400 mt-1">查看所有用户的充值订单，金额单位为分。</p>
                </div>
                <button
                  onClick={reloadOrders}
                  disabled={loadingOrders}
                  className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold disabled:opacity-50"
                >
                  {loadingOrders ? "刷新中..." : "🔄 刷新"}
                </button>
              </div>
              {loadingOrders ? (
                <p className="text-slate-400 text-sm">加载中...</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-800">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-900 text-slate-400">
                      <tr>
                        <th className="text-left px-3 py-2">订单号</th>
                        <th className="text-left px-3 py-2">商品</th>
                        <th className="text-left px-3 py-2">金额</th>
                        <th className="text-left px-3 py-2">次数</th>
                        <th className="text-left px-3 py-2">渠道</th>
                        <th className="text-left px-3 py-2">状态</th>
                        <th className="text-left px-3 py-2">创建时间</th>
                        <th className="text-left px-3 py-2">支付时间</th>
                        <th className="text-right px-3 py-2">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((o) => (
                        <tr key={o.id} className="border-t border-slate-800 hover:bg-slate-900/50">
                          <td className="px-3 py-2 font-mono text-xs text-slate-300">{o.order_no}</td>
                          <td className="px-3 py-2 text-slate-200">{o.product_name}</td>
                          <td className="px-3 py-2 font-mono text-slate-300">{(o.amount / 100).toFixed(2)}</td>
                          <td className="px-3 py-2 font-mono text-slate-300">{o.credits}</td>
                          <td className="px-3 py-2">
                            <span className={`px-2 py-0.5 rounded text-xs ${
                              o.channel === "wechat" ? "bg-green-500/20 text-green-300" : "bg-blue-500/20 text-blue-300"
                            }`}>
                              {o.channel === "wechat" ? "微信" : "支付宝"}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`px-2 py-0.5 rounded text-xs ${
                              o.status === "paid" ? "bg-emerald-500/20 text-emerald-300" :
                              o.status === "pending" ? "bg-amber-500/20 text-amber-300" :
                              o.status === "expired" ? "bg-slate-500/20 text-slate-400" :
                              "bg-red-500/20 text-red-300"
                            }`}>
                              {o.status === "paid" ? "已支付" :
                               o.status === "pending" ? "待支付" :
                               o.status === "expired" ? "已过期" : "失败"}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-400 text-xs">{new Date(o.created_at).toLocaleString("zh-CN")}</td>
                          <td className="px-3 py-2 text-slate-400 text-xs">{o.paid_at ? new Date(o.paid_at).toLocaleString("zh-CN") : "—"}</td>
                          <td className="px-3 py-2 text-right">
                            <button
                              disabled={busy === o.id}
                              onClick={() => onDeleteOrder(o.id, o.order_no)}
                              className="px-3 py-1 rounded bg-red-600/80 hover:bg-red-600 text-white text-xs disabled:opacity-50"
                            >删除</button>
                          </td>
                        </tr>
                      ))}
                      {orders.length === 0 && (
                        <tr><td colSpan={9} className="text-center text-slate-500 py-8">暂无订单</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* ========== 解析日志 ========== */}
          {activeMenu === "logs" && <ParseLogsPanel />}

          {/* ========== 邀请拉新 ========== */}
          {activeMenu === "invites" && <InvitesPanel />}

          {/* ========== 系统维护 ========== */}
          {activeMenu === "maintenance" && <CleanupPanel />}
        </div>
      </main>

      {/* 删除确认对话框 */}
      {confirmOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => { setConfirmOpen(false); setConfirmTarget(null); }} />
          <div className="relative z-10 w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-100 mb-2">确认删除</h3>
            <p className="text-sm text-slate-400 mb-6">
              确定删除订单 <span className="font-mono text-pink-300">{confirmTarget?.orderNo}</span>？此操作无法撤销。
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setConfirmOpen(false); setConfirmTarget(null); }}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium"
              >
                取消
              </button>
              <button
                onClick={executeDeleteOrder}
                disabled={busy === confirmTarget?.id}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold disabled:opacity-50"
              >
                {busy === confirmTarget?.id ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ParseLogsPanel() {
  const fetchLogs = useServerFn(listParseLogs);
  const { data, isLoading, refetch, isFetching, error } = useQuery({
    queryKey: ["parse_logs"],
    queryFn: () => fetchLogs(),
    refetchInterval: 10_000,
  });
  const logs = (data || []) as Array<{
    id: string; platform: string; type: string; proxy_on: boolean;
    url: string; status: string; message: string; created_at: string;
  }>;
  const statusStyle = (s: string) =>
    s === "ok" ? "bg-emerald-500/20 text-emerald-300" :
    s === "start" ? "bg-slate-500/20 text-slate-300" :
    s === "need_cookies" ? "bg-amber-500/20 text-amber-300" :
    "bg-red-500/20 text-red-300";
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-bold">解析日志</h2>
          <p className="text-xs text-slate-400 mt-1">
            最近 200 条国外平台解析记录（每 10 秒自动刷新）。proxy=on 表示通过后台代理；status 包含 start / ok / failed / need_cookies。
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold disabled:opacity-50"
        >
          {isFetching ? "刷新中..." : "🔄 刷新"}
        </button>
      </div>
      {error ? (
        <p className="text-sm text-red-400">{(error as Error).message}</p>
      ) : isLoading ? (
        <p className="text-slate-400 text-sm">加载中...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="text-left px-3 py-2">时间</th>
                <th className="text-left px-3 py-2">平台</th>
                <th className="text-left px-3 py-2">类型</th>
                <th className="text-left px-3 py-2">代理</th>
                <th className="text-left px-3 py-2">状态</th>
                <th className="text-left px-3 py-2">URL</th>
                <th className="text-left px-3 py-2">备注</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-t border-slate-800 hover:bg-slate-900/50 align-top">
                  <td className="px-3 py-2 text-slate-400 text-xs whitespace-nowrap">
                    {new Date(l.created_at).toLocaleString("zh-CN")}
                  </td>
                  <td className="px-3 py-2 text-slate-200">{l.platform || "—"}</td>
                  <td className="px-3 py-2 text-slate-300">{l.type || "—"}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${l.proxy_on ? "bg-blue-500/20 text-blue-300" : "bg-slate-500/20 text-slate-400"}`}>
                      {l.proxy_on ? "on" : "off"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${statusStyle(l.status)}`}>{l.status}</span>
                  </td>
                  <td className="px-3 py-2 text-slate-300 text-xs max-w-[280px] truncate" title={l.url}>{l.url}</td>
                  <td className="px-3 py-2 text-slate-400 text-xs max-w-[320px] truncate" title={l.message}>{l.message || "—"}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr><td colSpan={7} className="text-center text-slate-500 py-8">暂无日志</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type InviteReportRow = {
  inviter_id: string;
  inviter_email: string | null;
  invite_code: string | null;
  invitee_count: number;
  credits_granted: number;
  credits_to_invitees: number;
  recharge_credits?: number;
  recharge_count?: number;
  last_invited_at: string | null;
  invitees: Array<{
    email: string | null;
    created_at: string;
    inviter_credits: number;
    invitee_credits: number;
    first_recharge_credits?: number;
    first_recharge_at?: string | null;
  }>;
};

function InvitesPanel() {
  const fetchReport = useServerFn(getInviteReport);
  const fetchConfig = useServerFn(getInviteConfig);
  const saveRewards = useServerFn(setInviteRewards);

  const report = useQuery({ queryKey: ["admin-invites"], queryFn: () => fetchReport(), refetchInterval: 15_000 });
  const cfg = useQuery({ queryKey: ["admin-invite-config"], queryFn: () => fetchConfig() });

  const [rewardInviter, setRewardInviter] = useState<number | "">("");
  const [rewardInvitee, setRewardInvitee] = useState<number | "">("");
  const [dailyLimit, setDailyLimit] = useState<number | "">("");
  const [rechargeReward, setRechargeReward] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const c = cfg.data;
    if (!c) return;
    setRewardInviter(c.inviter);
    setRewardInvitee(c.invitee);
    setDailyLimit(c.dailyLimit);
    setRechargeReward(c.recharge);
  }, [cfg.data]);

  const rows = (report.data || []) as InviteReportRow[];
  const totalInvitees = rows.reduce((s, r) => s + (r.invitee_count || 0), 0);
  const totalGranted = rows.reduce((s, r) => s + (r.credits_granted || 0), 0);
  const totalRecharge = rows.reduce((s, r) => s + (r.recharge_credits || 0), 0);
  const todayStr = new Date().toDateString();
  const todayInvites = rows.reduce(
    (s, r) => s + (r.invitees || []).filter((i) => new Date(i.created_at).toDateString() === todayStr).length,
    0,
  );

  const onSave = async () => {
    const a = Number(rewardInviter);
    const b = Number(rewardInvitee);
    const c = Number(dailyLimit);
    const d = Number(rechargeReward);
    if (
      !Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(d) ||
      a < 0 || b < 0 || d < 0 || c < 1
    ) {
      alert("请填写有效数字：邀请人/被邀请人/首充奖励次数不能为负，每日上限至少 1");
      return;
    }
    setSaving(true);
    try {
      await saveRewards({ data: { inviter: a, invitee: b, dailyLimit: c, recharge: d } });
      await cfg.refetch();
      alert("邀请奖励已保存，立即生效");
    } catch (e: any) {
      alert(e?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const copyInviteLink = async (code: string | null) => {
    if (!code) return alert("该用户还没有邀请码");
    const link = `${window.location.origin}/auth?ref=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(link);
      alert("邀请链接已复制：" + link);
    } catch {
      alert(link);
    }
  };

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <div className="flex items-start justify-between mb-4 gap-4">
        <div>
          <h2 className="text-base font-bold">邀请拉新</h2>
          <p className="text-xs text-slate-400 mt-1">
            按邀请人分组统计。每邀请一位新用户注册，邀请人与新用户各自获得解析次数；
            被邀请的新人<strong className="text-amber-300">首次充值</strong>，再额外奖励邀请人 N 次。
          </p>
        </div>
        <button
          onClick={() => report.refetch()}
          disabled={report.isFetching}
          className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold disabled:opacity-50 shrink-0"
        >
          {report.isFetching ? "刷新中..." : "🔄 刷新"}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <p className="text-2xl font-bold text-pink-300">{rows.length}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">有邀请的用户</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <p className="text-2xl font-bold text-slate-100">{totalInvitees}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">被邀请注册人数</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <p className="text-2xl font-bold text-amber-300">{totalGranted}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">已发放邀请次数</p>
        </div>
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
          <p className="text-2xl font-bold text-emerald-300">{totalRecharge}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">首充奖励已发放</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <p className="text-2xl font-bold text-sky-300">{todayInvites}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">今日新增</p>
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 mb-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">邀请人得（次）</label>
            <input
              type="number"
              min={0}
              value={rewardInviter}
              onChange={(e) => setRewardInviter(e.target.value === "" ? "" : Number(e.target.value))}
              className="w-24 px-2 py-1.5 rounded-md bg-slate-800 border border-slate-700 text-slate-100 text-sm"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">新用户得（次）</label>
            <input
              type="number"
              min={0}
              value={rewardInvitee}
              onChange={(e) => setRewardInvitee(e.target.value === "" ? "" : Number(e.target.value))}
              className="w-24 px-2 py-1.5 rounded-md bg-slate-800 border border-slate-700 text-slate-100 text-sm"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">每人每日上限（人）</label>
            <input
              type="number"
              min={1}
              value={dailyLimit}
              onChange={(e) => setDailyLimit(e.target.value === "" ? "" : Number(e.target.value))}
              className="w-28 px-2 py-1.5 rounded-md bg-slate-800 border border-slate-700 text-slate-100 text-sm"
            />
          </div>
          <div className="ml-auto">
            <button
              onClick={onSave}
              disabled={saving || cfg.isLoading}
              className="px-3 py-1.5 rounded-md bg-pink-600 hover:bg-pink-500 text-white text-xs font-semibold disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存奖励设置"}
            </button>
          </div>
        </div>

        <div className="mt-3 rounded-lg border-2 border-amber-500/50 bg-gradient-to-r from-amber-500/15 to-rose-500/10 p-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-sm font-bold text-amber-200 mb-1">
              新人首次充值，奖励邀请人（次）
            </label>
            <input
              type="number"
              min={0}
              value={rechargeReward}
              onChange={(e) => setRechargeReward(e.target.value === "" ? "" : Number(e.target.value))}
              className="w-32 px-3 py-2 rounded-md bg-slate-900 border-2 border-amber-500/60 text-amber-200 text-xl font-bold text-center"
            />
          </div>
          <p className="text-[11px] leading-relaxed text-amber-100/70 max-w-md">
            被邀请人<strong className="text-amber-300">第一次充值成功</strong>时，给邀请人额外加这个次数；同一邀请只发一次，填 0 等于关闭。
          </p>
        </div>

        <p className="text-[11px] text-slate-500 mt-2">
          超出每日上限的邀请仍会记录关系（后台可见），但不再给邀请人发次数，防止刷号。
        </p>
      </div>

      {report.error ? (
        <p className="text-sm text-red-400">{(report.error as Error).message}</p>
      ) : report.isLoading ? (
        <p className="text-slate-400 text-sm">加载中...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="text-left px-3 py-2">邀请人（谁拉的）</th>
                <th className="text-left px-3 py-2">邀请码</th>
                <th className="text-left px-3 py-2">邀请人数</th>
                <th className="text-left px-3 py-2">邀请奖励</th>
                <th className="text-left px-3 py-2">首充奖励</th>
                <th className="text-left px-3 py-2">最近邀请</th>
                <th className="text-left px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.inviter_id}>
                  <tr className="border-t border-slate-800 hover:bg-slate-900/50">
                    <td className="px-3 py-2 text-slate-100">
                      <button
                        onClick={() => setExpanded(expanded === r.inviter_id ? null : r.inviter_id)}
                        className="text-left hover:text-pink-300"
                        title="点击展开被邀请人明细"
                      >
                        <span className="mr-1 text-xs text-slate-500">{expanded === r.inviter_id ? "▾" : "▸"}</span>
                        {r.inviter_email || "—"}
                      </button>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-300">{r.invite_code || "—"}</td>
                    <td className="px-3 py-2 text-slate-200 font-semibold">{r.invitee_count}</td>
                    <td className="px-3 py-2 text-amber-300">{r.credits_granted}</td>
                    <td className="px-3 py-2">
                      <span className={r.recharge_credits ? "text-emerald-300 font-semibold" : "text-slate-500"}>
                        {r.recharge_credits || 0}
                      </span>
                      <span className="text-[11px] text-slate-500 ml-1">（{r.recharge_count || 0} 人首充）</span>
                    </td>
                    <td className="px-3 py-2 text-slate-400 text-xs whitespace-nowrap">
                      {r.last_invited_at ? new Date(r.last_invited_at).toLocaleString("zh-CN") : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => copyInviteLink(r.invite_code)}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px]"
                      >
                        复制邀请链接
                      </button>
                    </td>
                  </tr>
                  {expanded === r.inviter_id && (
                    <tr key={r.inviter_id + "-detail"} className="border-t border-slate-800 bg-slate-950/60">
                      <td colSpan={7} className="px-3 py-2">
                        <div className="text-[11px] text-slate-400 mb-1.5">被邀请人明细</div>
                        <div className="space-y-1">
                          {(r.invitees || []).map((i, idx) => (
                            <div key={idx} className="flex items-center justify-between gap-3 text-xs">
                              <span className="text-slate-200 truncate">{i.email || "—"}</span>
                              <span className="text-slate-500 whitespace-nowrap">
                                {new Date(i.created_at).toLocaleString("zh-CN")}
                              </span>
                              <span className="text-amber-300 whitespace-nowrap">
                                邀请人 +{i.inviter_credits} / 新人 +{i.invitee_credits}
                              </span>
                              <span className={`whitespace-nowrap ${i.first_recharge_credits ? "text-emerald-300" : "text-slate-600"}`}>
                                {i.first_recharge_credits ? `首充 +${i.first_recharge_credits}` : "未首充"}
                              </span>
                            </div>
                          ))}
                          {(r.invitees || []).length === 0 && <p className="text-slate-500 text-xs">暂无明细</p>}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-slate-500 py-8">还没有任何邀请记录</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
