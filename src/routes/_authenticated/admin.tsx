import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useRef, useState } from "react";
import { listUsers, setBanned, deleteUser, adjustCredits, getSignupBonus, setSignupBonus, getApiConfig, setApiConfig, listParseLogs, getAlapiLogs, setAlapiCredential, clearAlapiCredential, getAlapiSyncKey, getAlapiQuota, getAlapiCallDetails, getInviteReport, getInviteConfig, setInviteRewards } from "@/lib/admin.functions";
import { deleteOrder, getPaymentConfig, listOrdersAdmin, listProductsAdmin, setPaymentConfig, upsertProduct, deleteProduct } from "@/lib/payment.functions";
import type { AlapiCallDetail } from "@/lib/alapi-log.server";
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
                        <tr><td colSpan={8} className="text-center text-slate-500 py-8">暂无订单</td></tr>
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
  const [view, setView] = useState<"parse" | "alapi">("parse");
  const [group, setGroup] = useState<"all" | "domestic" | "overseas">("all");
  const [limit, setLimit] = useState(200);
  const [keyword, setKeyword] = useState("");
  const { data, isLoading, refetch, isFetching, error } = useQuery({
    queryKey: ["parse_logs", group, limit],
    queryFn: () => fetchLogs({ data: { group, limit } }),
    refetchInterval: 10_000,
  });
  const allRows = data?.rows ?? [];
  const counts = data?.counts ?? { all: 0, domestic: 0, overseas: 0 };
  const kw = keyword.trim().toLowerCase();
  const logs = kw
    ? allRows.filter((l) =>
        [l.url, l.platform, l.status, l.type, l.message].some((v) => String(v || "").toLowerCase().includes(kw)),
      )
    : allRows;

  const statusStyle = (s: string) =>
    s === "ok" ? "bg-emerald-500/20 text-emerald-300" :
    s === "start" ? "bg-slate-500/20 text-slate-300" :
    s === "need_cookies" ? "bg-amber-500/20 text-amber-300" :
    "bg-red-500/20 text-red-300";
  const typeLabel = (t: string) =>
    t === "parse" ? "解析" : t === "audio" ? "音频" : t === "video" ? "视频" : t || "—";
  // /api/parse 写入的备注形如「用户 a@b.com · 国内接口 · 1820ms」，把邮箱单独拎出来展示
  const userOf = (m: string) => (m.match(/^用户\s+(\S+)\s·/) || [])[1] || "";
  const noteOf = (m: string) => m.replace(/^用户\s+\S+\s·\s?/, "");

  const groups: Array<{ key: "all" | "domestic" | "overseas"; label: string; n: number }> = [
    { key: "all", label: "全部", n: counts.all },
    { key: "domestic", label: "国内视频", n: counts.domestic },
    { key: "overseas", label: "国外视频", n: counts.overseas },
  ];

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-bold">解析日志</h2>
          <p className="text-xs text-slate-400 mt-1">
            {view === "parse"
              ? "每次用户解析都会记一条（含链接、用户、线路、耗时），海外平台的播放/下载请求也会记 start / ok / failed。每 10 秒自动刷新。"
              : "直接读取 ALAPI 控制台的调用记录：本站后端、微信小程序、其他接入方用同一个 token 的每一次调用都在这里，含来源 IP 与耗时。"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-slate-700 overflow-hidden text-xs font-semibold">
            <button
              onClick={() => setView("parse")}
              className={view === "parse" ? "px-3 py-1.5 bg-indigo-500/25 text-indigo-200" : "px-3 py-1.5 text-slate-300 hover:bg-slate-800"}
            >
              本站解析
            </button>
            <button
              onClick={() => setView("alapi")}
              className={view === "alapi" ? "px-3 py-1.5 bg-indigo-500/25 text-indigo-200" : "px-3 py-1.5 text-slate-300 hover:bg-slate-800"}
            >
              ALAPI 调用
            </button>
          </div>
          {view === "parse" && (
            <>
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索链接 / 平台 / 用户"
                className="w-52 rounded-md bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
              />
              <button
                onClick={() => refetch()}
                disabled={isFetching}
                className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold disabled:opacity-50"
              >
                {isFetching ? "刷新中..." : "🔄 刷新"}
              </button>
            </>
          )}
        </div>
      </div>

      {view === "alapi" ? (
        <AlapiCallsBody />
      ) : (
        <>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {groups.map((g) => (
          <button
            key={g.key}
            onClick={() => { setGroup(g.key); setLimit(200); }}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors ${
              group === g.key
                ? "bg-indigo-500/20 border-indigo-500/60 text-indigo-200"
                : "bg-slate-950/60 border-slate-700 text-slate-300 hover:border-slate-500"
            }`}
          >
            {g.label}
            <span className={`ml-1.5 ${group === g.key ? "text-indigo-300/80" : "text-slate-500"}`}>{g.n}</span>
          </button>
        ))}
        {kw && (
          <span className="text-xs text-slate-400">
            已加载 {allRows.length} 条，命中 {logs.length} 条
          </span>
        )}
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
                <th className="text-left px-3 py-2 whitespace-nowrap">时间</th>
                <th className="text-left px-3 py-2">平台</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">类型</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">线路</th>
                <th className="text-left px-3 py-2">状态</th>
                <th className="text-left px-3 py-2">用户</th>
                <th className="text-left px-3 py-2">链接</th>
                <th className="text-left px-3 py-2">备注</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-t border-slate-800 hover:bg-slate-900/50 align-top">
                  <td className="px-3 py-2 text-slate-400 text-xs whitespace-nowrap">
                    {new Date(l.created_at).toLocaleString("zh-CN")}
                  </td>
                  <td className="px-3 py-2 text-slate-200 whitespace-nowrap">{l.platform || "—"}</td>
                  <td className="px-3 py-2 text-slate-300 text-xs whitespace-nowrap">{typeLabel(l.type)}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded text-xs ${l.proxy_on ? "bg-blue-500/20 text-blue-300" : "bg-slate-500/20 text-slate-400"}`}>
                      {l.proxy_on ? "代理" : "直连"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded text-xs ${statusStyle(l.status)}`}>{l.status}</span>
                  </td>
                  <td className="px-3 py-2 text-slate-300 text-xs whitespace-nowrap">{userOf(l.message) || "—"}</td>
                  <td className="px-3 py-2 text-xs max-w-[420px]">
                    {l.url ? (
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-300 hover:text-indigo-200 hover:underline break-all"
                        title={l.url}
                      >
                        {l.url}
                      </a>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td
                    className="px-3 py-2 text-slate-400 text-xs max-w-[320px] break-words"
                    title={noteOf(l.message)}
                  >
                    <div className="max-h-[3.2rem] overflow-hidden">{noteOf(l.message) || "—"}</div>
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-slate-500 py-8">
                    {kw ? "当前筛选条件下没有匹配记录" : "暂无日志"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between mt-3">
        <span className="text-xs text-slate-500">
          已显示 {logs.length} 条{data?.hasMore ? "（还有更早的记录）" : "（已到最早）"}
        </span>
        {data?.hasMore && (
          <button
            onClick={() => setLimit((n) => Math.min(n + 200, 2000))}
            className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
          >
            加载更多
          </button>
        )}
      </div>
        </>
      )}
    </section>
  );
}

function AlapiCallsBody() {
  const fetchCalls = useServerFn(getAlapiLogs);
  const fetchQuota = useServerFn(getAlapiQuota);
  const fetchDetails = useServerFn(getAlapiCallDetails);
  const saveCred = useServerFn(setAlapiCredential);
  const clearCred = useServerFn(clearAlapiCredential);
  const fetchSyncKey = useServerFn(getAlapiSyncKey);

  const syncKeyQ = useQuery({
    queryKey: ["alapi_sync_key"],
    queryFn: () => fetchSyncKey(),
    staleTime: 600_000,
  });
  const syncKey = syncKeyQ.data?.key || "";

  const [days, setDays] = useState(3);
  const [kw, setKw] = useState("");
  const [editing, setEditing] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [tip, setTip] = useState("");

  // 日志详情（解析链接）单独拉：详情接口一条一次请求，全量拉太慢，
  // 所以只自动补当前可见的前 N 条，剩下的点「补全更多链接」再往前推。
  const [details, setDetails] = useState<Record<string, AlapiCallDetail>>({});
  const [triedIds, setTriedIds] = useState<Record<string, true>>({});
  const [detailWindow, setDetailWindow] = useState(24);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["alapi_logs", days],
    queryFn: () => fetchCalls({ data: { days } }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const quotaQ = useQuery({
    queryKey: ["alapi_quota"],
    queryFn: () => fetchQuota(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const calls = data?.calls ?? [];
  const kwl = kw.trim().toLowerCase();
  const rows = kwl
    ? calls.filter((c) =>
        [
          c.apiName,
          c.ip,
          c.refererHost,
          c.source,
          String(c.status),
          details[c.logId]?.url || c.url || "",
        ].some((v) => String(v || "").toLowerCase().includes(kwl)),
      )
    : calls;

  // ALAPI 的「日志详情」接口单条约 1~5 秒，且服务端只能串行取（并发会被判「日志不存在」），
  // 所以做成队列：每批 3 条，取到一批立刻渲染，链接在列表里逐行出现。
  const queueRef = useRef<string[]>([]);
  const runningRef = useRef(false);
  const rowsKey = `${days}|${rows.length}|${rows[0]?.logId || ""}|${detailWindow}`;

  const pumpDetails = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setLoadingDetails(true);
    try {
      while (queueRef.current.length) {
        const chunk = queueRef.current.splice(0, 3);
        try {
          const r = await fetchDetails({ data: { logIds: chunk } });
          if (r?.details?.length) {
            setDetails((prev) => {
              const next = { ...prev };
              for (const d of r.details) next[d.logId] = d;
              return next;
            });
          }
        } catch {
          // 单批失败不影响后面的批次
        }
        // 记下已尝试过的，避免取不到参数的日志被反复重试
        setTriedIds((prev) => {
          const next = { ...prev };
          for (const id of chunk) next[id] = true;
          return next;
        });
      }
    } finally {
      runningRef.current = false;
      setLoadingDetails(false);
    }
  };

  useEffect(() => {
    const todo = rows
      .slice(0, detailWindow)
      .filter((c) => !details[c.logId] && !c.url && !triedIds[c.logId] && !queueRef.current.includes(c.logId))
      .map((c) => c.logId);
    if (!todo.length) return;
    queueRef.current.push(...todo);
    void pumpDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsKey, details, triedIds]);

  let selfN = 0,
    miniN = 0,
    extN = 0,
    failN = 0,
    msSum = 0;
  for (const c of calls) {
    if (c.source === "本站") selfN++;
    else if (c.source === "微信小程序") miniN++;
    else extN++;
    if (c.status !== 200) failN++;
    msSum += c.duration || 0;
  }
  const avgMs = calls.length ? Math.round(msSum / calls.length) : 0;

  const srcStyle = (s: string) =>
    s === "本站"
      ? "bg-emerald-500/20 text-emerald-300"
      : s === "微信小程序"
        ? "bg-sky-500/20 text-sky-300"
        : "bg-slate-500/20 text-slate-300";

  const onSave = async () => {
    const t = tokenInput.trim();
    if (!t) {
      setTip("请先粘贴 alapi_access_token");
      return;
    }
    setSaving(true);
    setTip("");
    try {
      const r = await saveCred({ data: { token: t } });
      setTip(r.message);
      if (r.ok) {
        setEditing(false);
        setTokenInput("");
        await refetch();
      }
    } catch (e: any) {
      setTip(e?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const onClear = async () => {
    if (!confirm("清除 ALAPI 凭据后，「ALAPI 调用」将无法查看，确定？")) return;
    await clearCred();
    setTip("已清除凭据");
    await refetch();
  };

  // 书签：在 alapi 页面读取当前 token 并 POST 回本后台（alapi 每次打开控制台都会轮换 token，
  // 所以「点一下书签」比手工复制粘贴省事得多）
  const bookmarklet = syncKey
    ? "javascript:(async()=>{try{const t=(document.cookie.match(/alapi_access_token=([^;]+)/)||[])[1]||'';if(!t){alert('没读到登录态，请先登录 alapi.cn');return}const r=await fetch('https://www.jx521.top/api/public/alapi-token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:t,key:'" +
      syncKey +
      "'})}).then(x=>x.json());alert(r.ok?'✅ 已同步到解析后台':'❌ '+(r.message||'同步失败'))}catch(e){alert('❌ '+e.message)}})()"
    : "";

  const tk = data?.token;

  // React 19 会把 href="javascript:..." 直接拦掉，只能用 ref 手工写属性
  const bmRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (bmRef.current && bookmarklet) bmRef.current.setAttribute("href", bookmarklet);
  }, [bookmarklet]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
        <span className={tk?.configured && !tk?.expired ? "text-emerald-400" : "text-amber-400"}>●</span>
        {!tk ? (
          <span className="text-slate-400">读取凭据状态…</span>
        ) : !tk.configured ? (
          <span className="text-amber-300">未配置 ALAPI 凭据，暂时看不到调用记录</span>
        ) : (
          <span className="text-slate-300">
            凭据 …{tk.tail}
            {tk.expiresAt ? ` · 有效期至 ${new Date(tk.expiresAt).toLocaleDateString("zh-CN")}` : ""}
            {tk.expired ? " · 已过期" : ""}
          </span>
        )}
        {data?.fetchedAt && (
          <span className="text-slate-500">
            · 数据更新于 {new Date(data.fetchedAt).toLocaleTimeString("zh-CN")}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setEditing((v) => !v)}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold"
          >
            {tk?.configured ? "更新凭据" : "配置凭据"}
          </button>
          {tk?.configured && (
            <button onClick={onClear} className="px-2.5 py-1 rounded bg-slate-900 hover:bg-red-500/20 text-slate-400 hover:text-red-300">
              清除
            </button>
          )}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold disabled:opacity-50"
          >
            {isFetching ? "刷新中..." : "🔄 刷新"}
          </button>
        </div>
      </div>

      {editing && (
        <div className="rounded-lg border border-indigo-500/40 bg-indigo-500/5 p-3 space-y-3">
          <div className="rounded-md border border-slate-700 bg-slate-950/60 p-2.5 space-y-2">
            <p className="text-xs text-slate-300 leading-relaxed">
              <b className="text-emerald-300">方式一（推荐，以后一劳永逸）</b>：把下面这个按钮<b>拖到浏览器书签栏</b>。
              以后在 alapi 任何页面点一下书签，就会把最新的登录凭据同步到本后台 —— 因为 alapi 每次打开控制台都会换新 token，
              这也是唯一不用反复复制粘贴的办法。
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <a
                ref={bmRef}
                draggable
                onClick={(e) => {
                  e.preventDefault();
                  alert("请把这个按钮拖到浏览器书签栏，然后在 alapi 页面点击它");
                }}
                className="inline-block px-3 py-1.5 rounded-md bg-emerald-600/20 border border-emerald-500/50 text-emerald-300 text-xs font-semibold cursor-grab active:cursor-grabbing select-none"
              >
                🔗 同步 ALAPI 凭据
              </a>
              <button
                onClick={async () => {
                  if (!bookmarklet) return;
                  try {
                    await navigator.clipboard.writeText(bookmarklet);
                    alert("书签代码已复制。到浏览器书签管理器新建一个书签，名称随意，网址粘贴进去即可。");
                  } catch {
                    alert("复制失败，请手动选中下方代码复制");
                  }
                }}
                className="px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
              >
                复制书签代码
              </button>
              {!syncKey && <span className="text-xs text-slate-500">正在生成密钥…</span>}
            </div>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed">
            <b>方式二</b>：先在浏览器登录{" "}
            <a href="https://www.alapi.cn/" target="_blank" rel="noreferrer" className="text-indigo-300 hover:underline">
              alapi.cn
            </a>
            ，按 <b>F12</b> 打开控制台 → <b>Console</b> → 粘贴下面这行回车，token 会自动进剪贴板，再粘到下面输入框：
          </p>
          <code className="block select-all break-all rounded bg-slate-950 border border-slate-800 px-2 py-1.5 text-[11px] text-emerald-300">
            {'copy(document.cookie.match(/alapi_access_token=([^;]+)/)?.[1]||"")'}
          </code>
          <textarea
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="把复制到的 eyJ0eXAiOiJKV1Qi... 粘贴到这里"
            rows={3}
            className="w-full rounded-md bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={onSave}
              disabled={saving}
              className="px-3 py-1.5 rounded-md bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-semibold disabled:opacity-50"
            >
              {saving ? "校验中..." : "校验并保存"}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setTip("");
              }}
              className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
            >
              取消
            </button>
            {tip && <span className="text-xs text-slate-400">{tip}</span>}
          </div>
        </div>
      )}

      {!editing && tip && <p className="text-xs text-slate-400">{tip}</p>}

      {error ? (
        <p className="text-sm text-red-400">{(error as Error).message}</p>
      ) : isLoading ? (
        <p className="text-slate-400 text-sm">正在从 ALAPI 拉取调用记录（首次约 3~5 秒）…</p>
      ) : (
        <>
          {data && !data.ok && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              {data.error}
            </div>
          )}

          {quotaQ.data && !quotaQ.data.ok && quotaQ.data.apis.length === 0 && (
            <p className="text-xs text-amber-300/80">额度读取失败：{quotaQ.data.error}</p>
          )}

          {quotaQ.data?.ok && quotaQ.data.apis.length > 0 && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2.5 space-y-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="font-semibold text-slate-200">💰 我的接口 · 今日剩余次数</span>
                {quotaQ.data.planName && (
                  <span className="text-slate-400">
                    {quotaQ.data.planName}
                    {quotaQ.data.planEndAt ? ` · 到期 ${quotaQ.data.planEndAt.slice(0, 10)}` : ""}
                  </span>
                )}
                <span className="ml-auto text-slate-500">
                  每 60 秒刷新{quotaQ.data.fetchedAt ? ` · 更新于 ${new Date(quotaQ.data.fetchedAt).toLocaleTimeString("zh-CN")}` : ""}
                </span>
              </div>
              {quotaQ.data.apis.map((a) => {
                const usedByQuota = Math.max(a.limit - a.remain, 0);
                const pct = a.limit > 0 ? Math.min(usedByQuota / a.limit, 1) : 0;
                const low = a.remain <= 0;
                const warn = !low && a.limit > 0 && a.remain / a.limit <= 0.1;
                return (
                  <div key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="w-40 truncate text-xs text-slate-300" title={a.name}>
                      {a.name}
                    </span>
                    <span
                      className={`text-lg font-bold leading-none ${
                        low ? "text-red-300" : warn ? "text-amber-300" : "text-emerald-300"
                      }`}
                    >
                      {a.remain.toLocaleString()}
                    </span>
                    <span className="text-xs text-slate-400">/ {a.limit.toLocaleString()} 次</span>
                    <div className="h-1.5 min-w-[120px] flex-1 overflow-hidden rounded bg-slate-800">
                      <div
                        className={`h-full rounded ${low ? "bg-red-400" : warn ? "bg-amber-400" : "bg-indigo-400"}`}
                        style={{ width: `${Math.round(pct * 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-400 whitespace-nowrap">
                      今日已用 {a.used} · 成功 {a.success} · 失败 {a.fail}
                    </span>
                  </div>
                );
              })}
              <p className="text-[11px] text-slate-500 leading-relaxed">
                失败调用不扣次数（剩余 = 每日上限 − 成功次数）。次数每天 0 点重置，与 ALAPI 控制台「我的接口」同源。
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {[1, 3, 7].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors ${
                  days === d
                    ? "bg-indigo-500/20 border-indigo-500/60 text-indigo-200"
                    : "bg-slate-950/60 border-slate-700 text-slate-300 hover:border-slate-500"
                }`}
              >
                {d === 1 ? "今天" : `最近 ${d} 天`}
              </button>
            ))}
            <span className="text-xs text-slate-400 ml-1">
              共 <b className="text-slate-200">{data?.total ?? 0}</b> 次 · 本站{" "}
              <b className="text-emerald-300">{selfN}</b> · 小程序 <b className="text-sky-300">{miniN}</b> · 外部{" "}
              <b className="text-slate-200">{extN}</b>
              {failN > 0 && (
                <>
                  {" "}
                  · 失败 <b className="text-red-300">{failN}</b>
                </>
              )}{" "}
              · 平均 <b className="text-slate-200">{avgMs}ms</b>
            </span>
            <input
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              placeholder="搜索接口 / IP / 来源"
              className="ml-auto w-44 rounded-md bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-800 max-h-[62vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-slate-400 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 whitespace-nowrap">调用时间</th>
                  <th className="text-left px-3 py-2">接口</th>
                  <th className="text-left px-3 py-2 whitespace-nowrap">来源</th>
                  <th className="text-left px-3 py-2 whitespace-nowrap">客户端 IP</th>
                  <th className="text-left px-3 py-2 whitespace-nowrap">状态</th>
                  <th className="text-left px-3 py-2 whitespace-nowrap">耗时</th>
                  <th className="text-left px-3 py-2">解析链接</th>
                  <th className="text-left px-3 py-2">Referer</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c, idx) => {
                  const d = details[c.logId];
                  const link = d?.url || c.url || "";
                  return (
                    <tr key={c.logId} className="border-t border-slate-800 hover:bg-slate-900/50">
                      <td className="px-3 py-2 text-slate-400 text-xs whitespace-nowrap">
                        {c.at ? new Date(c.at).toLocaleString("zh-CN") : "—"}
                      </td>
                      <td className="px-3 py-2 text-slate-200 whitespace-nowrap">{c.apiName}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block whitespace-nowrap px-2 py-0.5 rounded text-xs ${srcStyle(c.source)}`}
                        >
                          {c.source}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-300 text-xs font-mono whitespace-nowrap">{c.ip || "—"}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block whitespace-nowrap px-2 py-0.5 rounded text-xs ${
                            c.status === 200 ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"
                          }`}
                        >
                          {c.status || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-300 text-xs whitespace-nowrap">{c.duration}ms</td>
                      <td className="px-3 py-2 text-xs max-w-[460px] min-w-[220px]">
                        {link ? (
                          <a
                            href={link}
                            target="_blank"
                            rel="noreferrer"
                            className="block break-all leading-snug text-indigo-300 hover:text-indigo-200 hover:underline"
                            title={link}
                          >
                            {link}
                          </a>
                        ) : (
                          <span className="text-slate-600">
                            {d ? "无链接参数" : idx < detailWindow ? "读取中…" : "待补全"}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-500 text-xs max-w-[200px] truncate" title={c.referer}>
                        {c.refererHost || "—"}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-center text-slate-500 py-8">
                      {kwl ? "当前筛选条件下没有匹配记录" : data?.ok ? "这段时间没有调用记录" : "暂无数据"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 mt-1">
            <p className="text-xs text-slate-500">
              已显示 {rows.length} 条
              {data?.ok && data.calls.length < data.total
                ? `（本次取回 ${data.calls.length} 条，共 ${data.total} 条，缩小时间范围可看更细）`
                : ""}
              。解析链接来自每条日志的详情接口
              {loadingDetails ? "，正在补全…" : ""}
              。来源判定：客户端 IP 是本站服务器即为「本站」，Referer 带 servicewechat 的是「微信小程序」，其余归为「外部」。
              数据每 60 秒自动刷新，与 ALAPI 控制台同源。
            </p>
            {detailWindow < rows.length && (
              <button
                onClick={() => setDetailWindow((n) => n + 50)}
                className="shrink-0 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
              >
                补全更多链接（+50）
              </button>
            )}
          </div>

        </>
      )}
    </div>
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
