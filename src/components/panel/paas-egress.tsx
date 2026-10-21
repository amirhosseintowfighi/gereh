"use client";
/* Gereh Apps outbound proxy: the app's setting (runtime tab) and the platform's shared proxy (staff). */
import { useEffect, useState } from "react";
import { BTN_G, BTN_MD, BTN_P, INPUT, TEXTAREA } from "@/lib/cls";
import { type EgressMode, noProxyError, parseNoProxy, proxyError } from "@/lib/paas-egress";
import { api, type PaasEgressView } from "@/lib/store";
import type { PaasApp } from "@/lib/types";
import { useApp } from "../app-context";
import { Badge, Card, Field } from "../ui";
import { AsyncButton, Tabs } from "../ui-client";

export function EgressCard({ app }: { app: PaasApp }) {
  const { notify } = useApp();
  const [view, setView] = useState<PaasEgressView | null>(null);
  const [mode, setMode] = useState<EgressMode>("off");
  const [url, setUrl] = useState("");
  const [noProxy, setNoProxy] = useState("");
  useEffect(() => {
    let live = true;
    api.paas.egress(app.id).then((v) => { if (!live) return; setView(v); setMode(v.mode); setNoProxy(v.noProxy.join("\n")); }, () => {});
    return () => { live = false; };
  }, [app.id]);
  if (!view) return null;
  const list = parseNoProxy(noProxy);
  const error = (url && proxyError(url)) || noProxyError(list) || (mode === "custom" && !url && !view.url ? "نشانی پروکسی را وارد کنید." : null);
  const options = [{ id: "off", label: "خاموش" }, { id: "custom", label: "پروکسی خودم" }, ...(view.platform || view.mode === "platform" ? [{ id: "platform", label: "پروکسی گره" }] : [])];
  return (
    <Card title="پروکسی خروجی" icon="network" className="lg:col-span-2">
      <p className="text-sm text-white/60 leading-7 mb-3">برای سرویس‌هایی که از ایران در دسترس نیستند (API تلگرام و…) ترافیک خروجی اپ از یک پروکسی HTTP یا SOCKS5 می‌گذرد. متغیرهای HTTP_PROXY، HTTPS_PROXY، ALL_PROXY و NO_PROXY (و NODE_USE_ENV_PROXY برای Node.js) تنظیم می‌شوند؛ شبکه داخلی کلاستر، پایگاه‌های داده و سرویس‌های گره مستقیم می‌مانند.</p>
      <Tabs size="sm" value={mode} onChange={(v) => setMode(v as EgressMode)} label="حالت پروکسی" options={options} />
      {mode === "custom" && (
        <Field label="نشانی پروکسی" hint={view.url ? "فعلی: " + view.url + " — برای تغییر، نشانی جدید را وارد کنید" : "مثل http://user:pass@1.2.3.4:3128 یا socks5h://1.2.3.4:1080؛ رمز آن مثل متغیرهای محرمانه ذخیره می‌شود"} className="mt-3">
          <input dir="ltr" type="password" autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value.trim())} placeholder="http://1.2.3.4:3128" className={INPUT + " font-mono text-left"} />
        </Field>
      )}
      {mode === "platform" && <p className="text-[11px] text-white/55 leading-6 mt-3">پروکسی مشترک گره؛ اگر مدیریت آن را عوض کند، در استقرار بعدی اپ اعمال می‌شود.</p>}
      {mode !== "off" && (
        <Field label="بدون پروکسی (NO_PROXY)" hint={"هر خط یک نام، ‎.دامنه، IP یا CIDR؛ این‌ها همیشه افزوده می‌شوند: " + view.defaults.join("، ")} className="mt-3">
          <textarea dir="ltr" rows={2} value={noProxy} onChange={(e) => setNoProxy(e.target.value)} placeholder={"api.example.ir\n.local.example"} className={TEXTAREA + " font-mono text-xs text-left"} />
        </Field>
      )}
      {view.extraKeys.length > 0 && mode !== "off" && <p className="text-[11px] text-white/55 mt-2">این متغیرها هم نشانی پروکسی را می‌گیرند: <span dir="ltr">{view.extraKeys.join(", ")}</span></p>}
      {error && (url || mode === "custom") && <p role="alert" className="text-xs text-rose-300 mt-2">{error}</p>}
      <div className="flex items-center gap-3 mt-3">
        <AsyncButton disabled={!!error} className={BTN_P + BTN_MD} onClick={async () => {
          const dep = await api.paas.setEgress(app.id, { mode, url: url || null, noProxy: list });
          const v = await api.paas.egress(app.id);
          setView(v); setUrl("");
          notify(dep ? "ذخیره شد؛ اپ با پروکسی جدید دوباره اجرا می‌شود" : "ذخیره شد؛ در استقرار بعدی اعمال می‌شود", "network");
        }}>ذخیره</AsyncButton>
        {view.mode !== "off" && <Badge tone="green" dot>{view.mode === "platform" ? "پروکسی گره فعال" : "پروکسی اختصاصی فعال"}</Badge>}
      </div>
    </Card>
  );
}

/** staff: the platform's shared proxy that one-click apps (Hermes, n8n…) can use */
export function AdminEgress() {
  const { notify } = useApp();
  const [cur, setCur] = useState<{ url: string; source: "admin" | "env" | ""; noProxy: string[] } | null>(null);
  const [url, setUrl] = useState("");
  const [noProxy, setNoProxy] = useState("");
  useEffect(() => { void api.paas.adminEgress().then((c) => { setCur(c); setNoProxy(c.noProxy.join("\n")); }).catch(() => setCur({ url: "", source: "", noProxy: [] })); }, []);
  if (!cur) return null;
  const list = parseNoProxy(noProxy);
  const error = (url && proxyError(url)) || noProxyError(list);
  const reload = async () => { const c = await api.paas.adminEgress(); setCur(c); setUrl(""); };
  return (
    <Card title="پروکسی خروجی گره (برای تلگرام و سرویس‌های خارجی)" icon="network" className="lg:col-span-2">
      <p className="text-sm text-white/65 leading-7">اپ‌هایی که مشتری برایشان گزینه «پروکسی گره» را بزند (Hermes، n8n، Agent Zero…) ترافیک خروجی را از این پروکسی می‌فرستند. پروکسی باید از داخل کلاستر در دسترس باشد و به اینترنت بین‌الملل برسد؛ مثلاً یک سرور خارج با squid/3proxy/dante، یا inbound HTTP/SOCKS یک کلاینت V2Ray/Xray که داخل کلاستر اجرا می‌شود. بدون احراز هویت آن را روی اینترنت باز نگذارید.</p>
      <p className="text-sm mt-3 flex flex-wrap items-center gap-2">وضعیت: {cur.url ? <><Badge tone="green" dot>فعال</Badge><span dir="ltr" className="font-mono text-xs">{cur.url}</span>{cur.source === "env" && <span className="text-[11px] text-white/50">(از متغیر PAAS_EGRESS_PROXY)</span>}</> : <Badge tone="gray">تنظیم نشده</Badge>}</p>
      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        <Field label="نشانی پروکسی" hint="http://user:pass@host:3128 یا socks5h://host:1080؛ رمزنگاری‌شده ذخیره می‌شود">
          <input dir="ltr" type="password" autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value.trim())} placeholder={cur.url ? "(بدون تغییر)" : "http://10.0.0.5:3128"} className={INPUT + " font-mono text-left"} />
        </Field>
        <Field label="بدون پروکسی (افزون بر شبکه داخلی)">
          <textarea dir="ltr" rows={2} value={noProxy} onChange={(e) => setNoProxy(e.target.value)} placeholder=".ir" className={TEXTAREA + " font-mono text-xs text-left"} />
        </Field>
      </div>
      {error && <p role="alert" className="text-xs text-rose-300 mt-2">{error}</p>}
      <div className="flex gap-2 mt-3">
        <AsyncButton disabled={!!error} className={BTN_P + BTN_MD} onClick={async () => { await api.paas.adminSetEgress({ url: url || null, noProxy: list }); await reload(); notify("پروکسی گره ذخیره شد؛ در استقرار بعدی اپ‌ها اعمال می‌شود", "network"); }}>ذخیره</AsyncButton>
        {cur.source === "admin" && <AsyncButton className={BTN_G + BTN_MD} confirmText="پروکسی گره حذف شود؟ اپ‌هایی که از آن استفاده می‌کنند پس از استقرار بعدی بدون پروکسی اجرا می‌شوند." onClick={async () => { await api.paas.adminSetEgress({ url: "", noProxy: list }); await reload(); notify("پروکسی گره حذف شد"); }}>حذف</AsyncButton>}
      </div>
    </Card>
  );
}
