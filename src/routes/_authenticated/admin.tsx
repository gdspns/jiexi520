import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { listUsers, setBanned, deleteUser, adjustCredits, getSignupBonus, setSignupBonus, getApiConfig, setApiConfig } from "@/lib/admin.functions";
import {
  getPaymentConfig,
  setPaymentConfig,
  listProductsAdmin,
  upsertProduct,
  deleteProduct,
} from "@/lib/payment.functions";
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
  const getPayCfg = useServerFn(getPaymentConfig);
  const savePayCfg = useServerFn(setPaymentConfig);
  const listProds = useServerFn(listProductsAdmin);
  const saveProd = useServerFn(upsertProduct);
  const removeProd = useServerFn(deleteProduct);
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

  const reloadProducts = async () => {
    setLoadingProds(true);
    try {
      const rows = await listProds();
      setProducts(rows as any);
    } finally {
      setLoadingProds(false);
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
    })).catch(() => {});
    reloadProducts().catch(() => {});
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
      // 写回 id（新增情况），避免重新拉取整列表导致页面闪动
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

        <section className="mb-6 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
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
          <div className="mt-4">
            <button onClick={onSavePay} disabled={savingPay}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white text-sm font-semibold disabled:opacity-50">
              {savingPay ? "保存中..." : "保存支付配置"}
            </button>
          </div>
        </section>

        <section className="mb-6 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-base font-bold">充值商品管理</h2>
              <p className="text-xs text-slate-400 mt-1">价格与折扣价以分(cent)为单位。例如 990 = 9.90 元。次数为该商品支付成功后赠送的解析次数。</p>
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
                    <th className="text-left px-3 py-2 w-24">原价(分)</th>
                    <th className="text-left px-3 py-2 w-24">折扣价(分)</th>
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
                      <td className="px-3 py-2"><input type="number" value={p.price} onChange={(e) => setProducts((arr) => arr.map((x, i) => i === idx ? { ...x, price: parseInt(e.target.value) || 0 } : x))} className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-100 font-mono" /></td>
                      <td className="px-3 py-2"><input type="number" value={p.discount_price ?? ""} placeholder="可空" onChange={(e) => setProducts((arr) => arr.map((x, i) => i === idx ? { ...x, discount_price: e.target.value === "" ? null : (parseInt(e.target.value) || 0) } : x))} className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-100 font-mono" /></td>
                      <td className="px-3 py-2"><input type="number" value={p.credits} onChange={(e) => setProducts((arr) => arr.map((x, i) => i === idx ? { ...x, credits: parseInt(e.target.value) || 0 } : x))} className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-100 font-mono" /></td>
                      <td className="px-3 py-2"><input type="number" value={p.sort_order} onChange={(e) => setProducts((arr) => arr.map((x, i) => i === idx ? { ...x, sort_order: parseInt(e.target.value) || 0 } : x))} className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-100 font-mono" /></td>
                      <td className="px-3 py-2 text-center"><input type="checkbox" checked={p.enabled} onChange={(e) => setProducts((arr) => arr.map((x, i) => i === idx ? { ...x, enabled: e.target.checked } : x))} /></td>
                      <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
                        <button onClick={() => onSaveProduct(p)} className="px-3 py-1 rounded bg-green-600/80 hover:bg-green-600 text-white text-xs">保存</button>
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
      </main>
    </div>
  );
}