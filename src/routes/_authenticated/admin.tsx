import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { listUsers, setBanned, deleteUser, adjustCredits, getSignupBonus, setSignupBonus, getApiConfig, setApiConfig } from "@/lib/admin.functions";
import { deleteOrder, getPaymentConfig, listOrdersAdmin, listProductsAdmin, setPaymentConfig, upsertProduct, deleteProduct } from "@/lib/payment.functions";
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

type MenuKey = "users" | "settings" | "products" | "orders";

function AdminPage() {
  const navigate = useNavigate();
  const [activeMenu, setActiveMenu] = useState<MenuKey>("users");
  const [productMenuOpen, setProductMenuOpen] = useState(false);

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

  const onDeleteOrder = async (id: string, orderNo: string) => {
    if (!confirm(`确定删除订单 ${orderNo}？此操作无法撤销。`)) return;
    setBusy(id);
    try {
      await removeOrder({ data: { id } });
      setOrders((arr) => arr.filter((o) => o.id !== id));
    } catch (e: any) {
      alert(e?.message || "删除失败");
    } finally {
      setBusy(null);
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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex">
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
                <h2 className="text-base font-bold mb-1">支付配置（虎皮椒）</h2>
                <p className="text-xs text-slate-400 mb-3">填写虎皮椒商户号 (appid) 与密钥 (appsecret)，开启对应渠道后用户即可使用扫码 / H5 跳转支付。</p>
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="rounded-lg border border-slate-800 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-bold text-green-300">微信支付</h3>
                      <label className="flex items-center gap-2 text-xs text-slate-300">
                        <input type="checkbox" checked={payCfg.wechat_enabled} onChange={(e) => setPayCfg({ ...payCfg, wechat_enabled: e.target.checked })} />
                        启用
                      </label>
                    </div>
                    <label className="block text-xs text-slate-400 mb-1">商户号 (appid)</label>
                    <input value={payCfg.wechat_appid} onChange={(e) => setPayCfg({ ...payCfg, wechat_appid: e.target.value })}
                      placeholder="微信 appid" className="w-full mb-2 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm font-mono focus:outline-none focus:border-pink-500" />
                    <label className="block text-xs text-slate-400 mb-1">密钥 (appsecret)</label>
                    <div className="flex gap-2">
                      <input type={showWxSecret ? "text" : "password"} value={payCfg.wechat_appsecret} onChange={(e) => setPayCfg({ ...payCfg, wechat_appsecret: e.target.value })}
                        placeholder="微信 appsecret" className="flex-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm font-mono focus:outline-none focus:border-pink-500" />
                      <button type="button" onClick={() => setShowWxSecret((s) => !s)} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs">{showWxSecret ? "隐藏" : "显示"}</button>
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-800 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-bold text-blue-300">支付宝</h3>
                      <label className="flex items-center gap-2 text-xs text-slate-300">
                        <input type="checkbox" checked={payCfg.alipay_enabled} onChange={(e) => setPayCfg({ ...payCfg, alipay_enabled: e.target.checked })} />
                        启用
                      </label>
                    </div>
                    <label className="block text-xs text-slate-400 mb-1">商户号 (appid)</label>
                    <input value={payCfg.alipay_appid} onChange={(e) => setPayCfg({ ...payCfg, alipay_appid: e.target.value })}
                      placeholder="支付宝 appid" className="w-full mb-2 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm font-mono focus:outline-none focus:border-pink-500" />
                    <label className="block text-xs text-slate-400 mb-1">密钥 (appsecret)</label>
                    <div className="flex gap-2">
                      <input type={showAliSecret ? "text" : "password"} value={payCfg.alipay_appsecret} onChange={(e) => setPayCfg({ ...payCfg, alipay_appsecret: e.target.value })}
                        placeholder="支付宝 appsecret" className="flex-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm font-mono focus:outline-none focus:border-pink-500" />
                      <button type="button" onClick={() => setShowAliSecret((s) => !s)} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs">{showAliSecret ? "隐藏" : "显示"}</button>
                    </div>
                  </div>
                </div>
                <div className="mt-3">
                  <label className="block text-xs text-slate-400 mb-1">虎皮椒接口地址</label>
                  <input value={payCfg.api_endpoint} onChange={(e) => setPayCfg({ ...payCfg, api_endpoint: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm font-mono focus:outline-none focus:border-pink-500" />
                  <p className="text-[11px] text-slate-500 mt-1">默认 https://api.xunhupay.com/payment/do.html ，无特殊需求请勿修改。回调地址会自动设为 /api/public/xunhupay-notify。</p>
                </div>
                <div className="mt-3">
                  <label className="block text-xs text-slate-400 mb-1">异步回调域名（重要）</label>
                  <input value={payCfg.notify_base_url} onChange={(e) => setPayCfg({ ...payCfg, notify_base_url: e.target.value })}
                    placeholder="https://jiexi520.lovable.app"
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm font-mono focus:outline-none focus:border-pink-500" />
                  <p className="text-[11px] text-yellow-400/80 mt-1">⚠ 必须填写已发布的公网域名（如 https://jiexi520.lovable.app 或绑定的自定义域名）。预览域名 id-preview--*.lovable.app 会拦截外部回调导致付款后不到账。留空则使用当前请求域名。</p>
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
        </div>
      </main>
    </div>
  );
}
