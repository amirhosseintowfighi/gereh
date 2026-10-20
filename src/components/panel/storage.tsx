"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BTN_D, BTN_G, BTN_MD, BTN_P, BTN_SM, INPUT } from "@/lib/cls";
import { fa, toman } from "@/lib/format";
import { hourlyOf } from "@/lib/paas";
import { BUCKET_STATUS, CORS_METHODS, DOMAIN_STATUS, GB, SDKS, SHARE_TTLS, SSL_STATUS, baseName, bucketNameError, bytes, crumbs, snippet, type SdkId } from "@/lib/storage";
import { api, useDB, useMyId, type StorageGrant, type StorageListing } from "@/lib/store";
import type { StorageBucket, StorageCors, StorageKey } from "@/lib/types";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field, Meter } from "../ui";
import { AsyncButton, Bars, CodeBlock, CopyText, Menu, Modal, PageTitle, Select, StatCard, Switch, Tabs, useCopy } from "../ui-client";

const Pill = ({ map, s }: { map: Record<string, [string, "green" | "blue" | "amber" | "red" | "gray"]>; s: string }) => { const [l, t] = map[s] ?? [s, "gray"]; return <Badge tone={t} dot>{l}</Badge>; };
const encKey = (k: string) => k.split("/").map(encodeURIComponent).join("/");
const abs = (u: string) => (u.startsWith("/") && typeof window !== "undefined" ? window.location.origin + u : u);
const when = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? "" : d.toLocaleString("fa-IR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); };
const PERM_LABEL: Record<string, string> = { none: "بدون دسترسی", read: "فقط خواندن", write: "خواندن و نوشتن" };

/* ================= list: buckets + access keys ================= */
export function UserStorage({ create = false }: { create?: boolean }) {
  const db = useDB(); const myId = useMyId();
  const buckets = db.storage.buckets.filter((b) => b.userId === myId);
  const [open, setOpen] = useState(create);
  const [tab, setTab] = useState("buckets");
  return (
    <div>
      <PageTitle title="فضای ذخیره‌سازی ابری" sub="ذخیره‌سازی سازگار با S3 برای فایل‌ها، تصاویر، بکاپ و استاتیک سایت؛ پرداخت ساعتی از کیف پول."
        action={<button type="button" onClick={() => setOpen(true)} className={BTN_P + BTN_MD}><Icon name="plus" size={16} />باکت جدید</button>} />
      <div className="mb-5"><Tabs size="sm" value={tab} onChange={setTab} label="بخش‌های فضای ذخیره‌سازی" options={[
        { id: "buckets", label: "باکت‌ها", icon: "hard-drive", badge: buckets.length ? fa(buckets.length) : undefined }, { id: "keys", label: "کلیدهای دسترسی", icon: "key-round" }, { id: "connect", label: "اتصال", icon: "plug" },
      ]} /></div>
      <div key={tab} className="fade-in" role="tabpanel">
        {tab === "buckets" && (buckets.length === 0 ? (
          <Card><Empty icon="hard-drive" title="هنوز باکتی ندارید" text="یک باکت بسازید، کلید دسترسی بگیرید و با هر ابزار سازگار با S3 (aws-cli، rclone، SDKها) فایل‌ها را مدیریت کنید."
            action={<div className="flex flex-wrap gap-2 justify-center"><button type="button" onClick={() => setOpen(true)} className={BTN_P + BTN_MD}>ساخت باکت</button><Link href={"/storage" as never} className={BTN_G + BTN_MD}>بیشتر بدانید</Link></div>} /></Card>
        ) : (
          <ul className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {buckets.map((b) => { const plan = db.storage.plans.find((p) => p.id === b.planId); return (
              <li key={b.id}>
                <Link href={("/panel/storage/" + b.id) as never} className="block rounded-[1.4rem] p-5 bg-white/[0.04] border border-white/[0.1] hover:border-white/25 transition">
                  <span className="flex items-center justify-between gap-2"><b dir="ltr" className="truncate">{b.name}</b><span className="flex gap-1.5 shrink-0">{b.access === "public" && <Badge tone="blue">عمومی</Badge>}<Pill map={BUCKET_STATUS} s={b.status} /></span></span>
                  <span className="block mt-4"><Meter value={b.usedBytes} max={(plan?.sizeGb ?? 1) * GB} label={fa(b.objects) + " فایل"} right={bytes(b.usedBytes) + " از " + (plan?.name ?? "")} /></span>
                  <span className="block text-[11px] text-white/50 mt-3">{toman(b.hourly)} در ساعت · ساخته‌شده {b.at}</span>
                </Link>
              </li>
            ); })}
          </ul>
        ))}
        {tab === "keys" && <Keys buckets={buckets} />}
        {tab === "connect" && <Connection bucket={buckets[0]?.name ?? "my-bucket"} />}
      </div>
      <NewBucket open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function NewBucket({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useDB(); const router = useRouter(); const { notify } = useApp();
  const plans = db.storage.plans;
  const [f, setF] = useState({ name: "", planId: "", access: "private" as "private" | "public" });
  const [error, setError] = useState("");
  const planId = f.planId || plans[0]?.id || "";
  const plan = plans.find((p) => p.id === planId);
  const nameErr = f.name ? bucketNameError(f.name) : null;
  return (
    <Modal open={open} onClose={onClose} title="باکت جدید" icon="hard-drive" size="max-w-3xl">
      <div className="space-y-5">
        <Field label="نام باکت" hint="یکتا در کل سرویس؛ حروف کوچک انگلیسی، عدد و خط تیره" error={nameErr ?? undefined}>
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value.trim().toLowerCase() })} dir="ltr" placeholder="my-app-media" className={INPUT + " text-left font-mono"} />
        </Field>
        <div role="radiogroup" aria-label="حجم" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {plans.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={planId === p.id} onClick={() => setF({ ...f, planId: p.id })}
              className={"text-right rounded-2xl p-3.5 border transition " + (planId === p.id ? "bg-sky-400/10 border-sky-300/50" : "bg-white/[0.03] border-white/[0.1] hover:border-white/25")}>
              <b>{p.name}</b>
              <span className="block text-sm tabular mt-1">{toman(p.price)}<span className="text-[11px] text-white/50"> / ماه</span></span>
              <span className="block text-[11px] text-white/50 mt-1">{toman(hourlyOf(p.price))} در ساعت</span>
            </button>
          ))}
        </div>
        <div className="rounded-2xl bg-white/[0.03] border border-white/[0.08] p-4 flex items-start justify-between gap-4">
          <div><b className="text-sm">دسترسی عمومی</b><p className="text-[11px] text-white/55 mt-1 leading-6">باکت عمومی: هر کس نشانی فایل را داشته باشد می‌تواند آن را ببیند (مناسب تصاویر و فایل‌های استاتیک سایت). فهرست فایل‌ها و نوشتن همیشه به کلید نیاز دارد.</p></div>
          <Switch on={f.access === "public"} onChange={(v) => setF({ ...f, access: v ? "public" : "private" })} label="دسترسی عمومی" />
        </div>
        <p className="text-[11px] text-white/55 leading-6">هزینه ساعتی از کیف پول کسر می‌شود؛ ترافیک و درخواست‌ها رایگان است. حجم را بعداً می‌توانید ارتقا دهید (کاهش ممکن نیست).</p>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-white/[0.08]">
          <span className="text-sm">{plan && <>هزینه: <b className="tabular">{toman(plan.price)}</b> در ماه</>}</span>
          <div className="flex flex-col items-end gap-2">
            {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
            <AsyncButton disabled={!f.name || !!nameErr || !planId} onClick={async () => {
              setError("");
              try { const id = await api.storage.create({ ...f, planId }); notify("باکت ساخته شد", "hard-drive"); onClose(); router.push(("/panel/storage/" + id) as never); }
              catch (e) { setError((e as Error).message); }
            }}><Icon name="hard-drive" size={16} />ساخت باکت</AsyncButton>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ================= access keys ================= */
function SecretModal({ secret, onClose }: { secret: { accessKey: string; secretKey: string } | null; onClose: () => void }) {
  const db = useDB(); const copy = useCopy();
  return (
    <Modal open={!!secret} onClose={onClose} title="کلید دسترسی" icon="key-round">
      {secret && <div className="space-y-4">
        <p role="alert" className="rounded-xl border border-amber-300/30 bg-amber-400/[0.07] px-3 py-2 text-sm leading-7">کلید مخفی فقط همین یک بار نمایش داده می‌شود؛ آن را در جای امنی ذخیره کنید.</p>
        {[["Access Key", secret.accessKey], ["Secret Key", secret.secretKey], ["Endpoint", db.storage.endpoint], ["Region", db.storage.region]].map(([l, v]) => (
          <Field key={l} label={l}><div className="rounded-xl bg-black/30 px-3 py-2.5 break-all"><CopyText text={v} className="font-mono text-sm" /></div></Field>
        ))}
        <div className="flex justify-end gap-2"><button type="button" className={BTN_G + BTN_MD} onClick={() => copy("AWS_ACCESS_KEY_ID=" + secret.accessKey + "\nAWS_SECRET_ACCESS_KEY=" + secret.secretKey + "\nAWS_ENDPOINT_URL=" + db.storage.endpoint + "\nAWS_REGION=" + db.storage.region, "متغیرها کپی شد")}><Icon name="copy" size={16} />کپی به‌صورت ‎.env</button><button type="button" className={BTN_P + BTN_MD} onClick={onClose}>ذخیره کردم</button></div>
      </div>}
    </Modal>
  );
}

function KeyModal({ edit, buckets, onClose, onSecret }: { edit: StorageKey | "new" | null; buckets: StorageBucket[]; onClose: () => void; onSecret: (s: { accessKey: string; secretKey: string }) => void }) {
  const { notify } = useApp();
  const [name, setName] = useState("");
  const [perms, setPerms] = useState<Record<string, string>>({});
  const [seen, setSeen] = useState<string>("");
  const k = edit === null ? "" : edit === "new" ? "new" : edit.id;
  if (k !== seen) { setSeen(k); setName(edit && edit !== "new" ? edit.name : ""); setPerms(Object.fromEntries((edit && edit !== "new" ? edit.grants : []).map((g) => [g.bucketId, g.perm]))); }
  const grants: StorageGrant[] = Object.entries(perms).filter(([, p]) => p === "read" || p === "write").map(([bucketId, p]) => ({ bucketId, perm: p as "read" | "write" }));
  return (
    <Modal open={edit !== null} onClose={onClose} title={edit === "new" ? "کلید دسترسی جدید" : "دسترسی کلید"} icon="key-round">
      <div className="space-y-4">
        <Field label="نام" hint="برای شناختن کلید؛ مثل «سرور اصلی» یا «CI»"><input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} /></Field>
        <div>
          <span className="text-sm font-bold">دسترسی به باکت‌ها</span>
          {buckets.length === 0 ? <p className="text-sm text-white/55 mt-2">اول یک باکت بسازید.</p> : (
            <ul className="mt-2 divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08]">
              {buckets.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <b dir="ltr" className="text-sm truncate">{b.name}</b>
                  <Select label={"دسترسی " + b.name} className="w-44" value={perms[b.id] ?? "none"} onChange={(v) => setPerms({ ...perms, [b.id]: v })} options={Object.entries(PERM_LABEL).map(([value, label]) => ({ value, label }))} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex justify-end">
          <AsyncButton disabled={!name.trim()} onClick={async () => {
            if (edit === "new") { const r = await api.storage.createKey({ name: name.trim(), grants }); onClose(); onSecret(r); }
            else if (edit) { await api.storage.updateKey(edit.id, { name: name.trim(), grants }); notify("دسترسی کلید به‌روز شد", "check"); onClose(); }
          }}><Icon name="key-round" size={16} />{edit === "new" ? "ساخت کلید" : "ذخیره"}</AsyncButton>
        </div>
      </div>
    </Modal>
  );
}

function Keys({ buckets }: { buckets: StorageBucket[] }) {
  const db = useDB(); const { confirm } = useApp();
  const [edit, setEdit] = useState<StorageKey | "new" | null>(null);
  const [secret, setSecret] = useState<{ accessKey: string; secretKey: string } | null>(null);
  const name = (id: string) => buckets.find((b) => b.id === id)?.name ?? id;
  return (
    <Card pad="p-3 sm:p-4" title="کلیدهای دسترسی" icon="key-round" action={<button type="button" onClick={() => setEdit("new")} className={BTN_P + BTN_SM}><Icon name="plus" size={14} />کلید جدید</button>}>
      {db.storage.keys.length === 0 ? <Empty icon="key-round" title="کلید دسترسی ندارید" text="هر برنامه یا سرور را با کلید جداگانه و فقط به باکت‌های لازم وصل کنید؛ هر وقت لازم شد کلید را باطل کنید." /> : (
        <ul className="divide-y divide-white/[0.06]">
          {db.storage.keys.map((k) => (
            <li key={k.id} className="py-3 px-1 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <b className="text-sm">{k.name}</b>
                <div className="mt-1"><CopyText text={k.accessKey} className="font-mono text-xs text-white/70" /></div>
                <div className="flex flex-wrap gap-1.5 mt-2">{k.grants.length ? k.grants.map((g) => <Badge key={g.bucketId} tone={g.perm === "write" ? "amber" : "gray"}><span dir="ltr">{name(g.bucketId)}</span> · {PERM_LABEL[g.perm]}</Badge>) : <span className="text-[11px] text-white/50">به هیچ باکتی دسترسی ندارد</span>}</div>
                <span className="block text-[11px] text-white/50 mt-1.5">ساخته‌شده {k.at}{k.rotated ? " · تعویض کلید مخفی " + k.rotated : ""}</span>
              </div>
              <Menu label={"عملیات " + k.name} trigger={<Icon name="sliders-horizontal" size={16} />} items={[
                { icon: "pencil", label: "ویرایش دسترسی", run: () => setEdit(k) },
                { icon: "refresh-cw", label: "تعویض کلید مخفی", run: async () => { if (await confirm("کلید مخفی فعلی «" + k.name + "» از کار می‌افتد و کلید تازه ساخته می‌شود. ادامه می‌دهید؟", { ok: "تعویض" })) setSecret(await api.storage.regenerateKey(k.id)); } },
                "-",
                { icon: "trash-2", label: "ابطال کلید", danger: true, run: async () => { if (await confirm("کلید «" + k.name + "» باطل شود؟ برنامه‌هایی که از آن استفاده می‌کنند قطع می‌شوند.", { danger: true, ok: "ابطال" })) await api.storage.revokeKey(k.id); } },
              ]} />
            </li>
          ))}
        </ul>
      )}
      <KeyModal edit={edit} buckets={buckets} onClose={() => setEdit(null)} onSecret={setSecret} />
      <SecretModal secret={secret} onClose={() => setSecret(null)} />
    </Card>
  );
}

/* ================= connection info ================= */
function Connection({ bucket }: { bucket: string }) {
  const db = useDB();
  const [sdk, setSdk] = useState<SdkId>("node");
  const code = snippet(sdk, { endpoint: db.storage.endpoint, region: db.storage.region, bucket });
  return (
    <div className="grid lg:grid-cols-[1fr_1.6fr] gap-4 items-start">
      <Card title="مشخصات اتصال" icon="plug">
        <dl className="space-y-3 text-sm">
          {[["Endpoint", db.storage.endpoint], ["Region", db.storage.region], ["Bucket", bucket]].map(([l, v]) => (
            <div key={l}><dt className="text-white/50 text-xs">{l}</dt><dd className="mt-1 rounded-xl bg-black/30 px-3 py-2"><CopyText text={v} className="font-mono" /></dd></div>
          ))}
        </dl>
        <p className="text-[11px] text-white/55 leading-6 mt-4">سازگار با API آمازون S3 (امضای نسخه ۴). آدرس‌دهی path-style را فعال کنید. کلید دسترسی را از تب «کلیدهای دسترسی» بسازید و فقط به باکت‌های لازم دسترسی بدهید.</p>
      </Card>
      <Card title="نمونه کد" icon="code-xml">
        <div className="mb-3"><Tabs size="sm" value={sdk} onChange={(v) => setSdk(v as SdkId)} label="زبان" options={SDKS.map((s) => ({ id: s.id, label: s.label }))} /></div>
        <CodeBlock code={code} label="نمونه کد" title={SDKS.find((s) => s.id === sdk)?.label} />
      </Card>
    </div>
  );
}

/* ================= bucket detail ================= */
export function StorageDetail({ id }: { id: string }) {
  const db = useDB(); const myId = useMyId();
  const b = db.storage.buckets.find((x) => x.id === id && x.userId === myId);
  const [tab, setTab] = useState("files");
  if (!b) return <Card><Empty icon="hard-drive" title="باکت پیدا نشد" action={<Link href={"/panel/storage" as never} className={BTN_G + BTN_MD}>بازگشت</Link>} /></Card>;
  const plan = db.storage.plans.find((p) => p.id === b.planId);
  return (
    <div>
      <PageTitle back={["/panel/storage", "فضای ذخیره‌سازی"]} title={<span dir="ltr" className="inline-block">{b.name}</span>}
        sub={<span className="flex flex-wrap items-center gap-x-4 gap-y-1"><Pill map={BUCKET_STATUS} s={b.status} />{b.access === "public" ? <Badge tone="blue">عمومی</Badge> : <Badge>خصوصی</Badge>}<span className="text-xs">پلن {plan?.name} · {bytes(b.usedBytes)} استفاده‌شده</span><span className="text-xs">{toman(b.hourly)} در ساعت</span></span>} />
      {b.status === "suspended" && <div role="alert" className="mb-4 rounded-2xl border border-rose-300/30 bg-rose-400/[0.07] px-4 py-3 text-sm leading-7">{b.suspendReason === "billing" ? "موجودی کیف پول تمام شده و دسترسی به این باکت متوقف است؛ فایل‌ها حفظ شده‌اند. با شارژ کیف پول باکت خودکار فعال می‌شود." : "این باکت توسط پشتیبانی معلق شده است؛ برای جزئیات تیکت بزنید."}</div>}
      <div className="mb-5"><Tabs size="sm" value={tab} onChange={setTab} label="بخش‌های باکت" options={[
        { id: "files", label: "فایل‌ها", icon: "folder-open" }, { id: "usage", label: "مصرف", icon: "chart-column" }, { id: "connect", label: "اتصال", icon: "plug" }, { id: "domains", label: "دامنه", icon: "globe" }, { id: "settings", label: "تنظیمات", icon: "settings-2" },
      ]} /></div>
      <div key={tab} className="fade-in" role="tabpanel">
        {tab === "files" && (b.status === "active" ? <Files b={b} /> : <Card><Empty icon="lock" title="فایل‌ها تا فعال شدن باکت در دسترس نیستند" /></Card>)}
        {tab === "usage" && <Usage b={b} />}
        {tab === "connect" && <Connection bucket={b.name} />}
        {tab === "domains" && <Domains b={b} />}
        {tab === "settings" && <Settings b={b} />}
      </div>
    </div>
  );
}

/* ---------- file browser ---------- */
type Up = { name: string; pct: number; error?: string };
function Files({ b }: { b: StorageBucket }) {
  const { notify, confirm } = useApp(); const copy = useCopy();
  const [prefix, setPrefix] = useState("");
  const [tick, setTick] = useState(0);
  const [res, setRes] = useState<{ key: string; list: StorageListing; more: StorageListing["objects"] } | null>(null);
  const [err, setErr] = useState("");
  const [ups, setUps] = useState<Up[]>([]);
  const [modal, setModal] = useState<{ kind: "mkdir" | "move" | "share"; key: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const want = prefix + "|" + tick;
  useEffect(() => {
    let alive = true;
    api.storage.objects(b.id, prefix).then((list) => { if (alive) { setRes({ key: prefix + "|" + tick, list, more: [] }); setErr(""); } }, (e: Error) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [b.id, prefix, tick]);
  const loading = res?.key !== want && !err;
  const reload = () => setTick((t) => t + 1);
  const objects = res ? [...res.list.objects, ...res.more] : [];

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files];
    setUps(list.map((f) => ({ name: f.name, pct: 0 })));
    for (const [i, f] of list.entries()) {
      const set = (p: Partial<Up>) => setUps((u) => u.map((x, j) => (j === i ? { ...x, ...p } : x)));
      try {
        const { url } = await api.storage.uploadUrl(b.id, prefix + f.name, f.size, f.type || "application/octet-stream");
        await new Promise<void>((resolve, reject) => {
          const x = new XMLHttpRequest();
          x.open("PUT", url);
          if (f.type) x.setRequestHeader("content-type", f.type);
          x.upload.onprogress = (e) => { if (e.lengthComputable) set({ pct: Math.round((e.loaded / e.total) * 100) }); };
          x.onload = () => (x.status < 300 ? resolve() : reject(new Error(x.status === 403 && /Quota/.test(x.responseText) ? "فضای باکت پر است" : "بارگذاری ناموفق (" + x.status + ")")));
          x.onerror = () => reject(new Error("ارتباط قطع شد"));
          x.send(f);
        });
        set({ pct: 100 });
      } catch (e) { set({ error: (e as Error).message }); }
    }
    if (fileRef.current) fileRef.current.value = "";
    reload();
  };
  const remove = async (key: string) => {
    const folder = key.endsWith("/");
    if (!(await confirm((folder ? "پوشه «" + baseName(key) + "» و همه فایل‌های داخلش" : "فایل «" + baseName(key) + "»") + " حذف شود؟" + (b.versioning ? " (نسخه‌بندی فعال است؛ نسخه‌های قبلی می‌مانند)" : ""), { danger: true, ok: "حذف" }))) return;
    try { const n = await api.storage.deleteObjects(b.id, [key]); notify(fa(n) + " مورد حذف شد", "trash-2"); reload(); } catch (e) { notify((e as Error).message, "circle-alert"); }
  };
  const download = async (key: string) => { try { window.location.assign(abs(await api.storage.downloadUrl(b.id, key))); } catch (e) { notify((e as Error).message, "circle-alert"); } };

  return (
    <Card pad="p-3 sm:p-4" title={
      <nav aria-label="مسیر پوشه" className="flex flex-wrap items-center gap-1 text-sm">
        <button type="button" onClick={() => setPrefix("")} className="hover:text-white text-white/70 inline-flex items-center gap-1"><Icon name="hard-drive" size={15} /><span dir="ltr">{b.name}</span></button>
        {crumbs(prefix).map((c) => <span key={c} className="inline-flex items-center gap-1"><Icon name="chevron-left" size={13} className="text-white/35" /><button type="button" onClick={() => setPrefix(c)} className="hover:text-white text-white/70" dir="ltr">{baseName(c)}</button></span>)}
      </nav>
    } action={
      <div className="flex gap-2">
        <button type="button" onClick={() => setModal({ kind: "mkdir", key: prefix })} className={BTN_G + BTN_SM}><Icon name="folder-open" size={14} />پوشه جدید</button>
        <button type="button" onClick={() => fileRef.current?.click()} className={BTN_P + BTN_SM}><Icon name="upload" size={14} />بارگذاری</button>
        <input ref={fileRef} type="file" multiple className="hidden" aria-label="انتخاب فایل" onChange={(e) => upload(e.target.files)} />
      </div>
    }>
      {ups.length > 0 && (
        <ul className="mb-3 space-y-2 rounded-2xl bg-white/[0.03] border border-white/[0.08] p-3">
          {ups.map((u, i) => <li key={i} className="text-xs"><div className="flex justify-between gap-2 mb-1"><span dir="ltr" className="truncate">{u.name}</span><span className={u.error ? "text-rose-300" : "tabular"}>{u.error ?? fa(u.pct) + "٪"}</span></div><Meter value={u.pct} /></li>)}
          {ups.every((u) => u.pct === 100 || u.error) && <li><button type="button" className="text-[11px] text-white/55 hover:text-white" onClick={() => setUps([])}>بستن</button></li>}
        </ul>
      )}
      {err ? <Empty icon="circle-alert" title="فهرست فایل‌ها بارگیری نشد" text={err} action={<button type="button" onClick={() => { setErr(""); reload(); }} className={BTN_G + BTN_SM}>تلاش دوباره</button>} />
        : loading && !res ? <div className="py-14 grid place-items-center" aria-busy="true"><Icon name="loader-circle" size={24} className="animate-spin text-white/50" /></div>
        : res && res.list.folders.length === 0 && objects.length === 0 ? <Empty icon="folder-open" title="این پوشه خالی است" text="فایل‌ها را بارگذاری کنید یا با aws-cli و rclone همگام کنید." />
        : res && (
          <ul className={"divide-y divide-white/[0.06] transition-opacity " + (loading ? "opacity-50" : "")}>
            {prefix && <li><button type="button" onClick={() => setPrefix(crumbs(prefix).slice(-2, -1)[0] ?? "")} className="w-full text-right py-2.5 px-1 text-sm text-white/60 hover:text-white flex items-center gap-2"><Icon name="chevron-right" size={15} />بازگشت به پوشه بالا</button></li>}
            {res.list.folders.map((f) => (
              <li key={f.prefix} className="flex items-center justify-between gap-2 py-1.5 px-1">
                <button type="button" onClick={() => setPrefix(f.prefix)} className="flex-1 min-w-0 text-right flex items-center gap-2 py-1 hover:text-white"><Icon name="folder-open" size={17} className="acc shrink-0" /><span dir="ltr" className="truncate text-sm">{f.name}</span></button>
                <Menu label={"عملیات " + f.name} trigger={<Icon name="sliders-horizontal" size={15} />} items={[
                  { icon: "pencil", label: "تغییر نام یا انتقال", run: () => setModal({ kind: "move", key: f.prefix }) },
                  { icon: "trash-2", label: "حذف پوشه", danger: true, run: () => remove(f.prefix) },
                ]} />
              </li>
            ))}
            {objects.map((o) => (
              <li key={o.key} className="flex items-center justify-between gap-2 py-2 px-1">
                <span className="flex-1 min-w-0 flex items-center gap-2"><Icon name="file-text" size={17} className="text-white/50 shrink-0" /><span className="min-w-0"><span dir="ltr" className="block truncate text-sm text-right">{o.name}</span><span className="block text-[11px] text-white/50">{bytes(o.size)} · {when(o.modified)}</span></span></span>
                <Menu label={"عملیات " + o.name} trigger={<Icon name="sliders-horizontal" size={15} />} items={[
                  { icon: "download", label: "دانلود", run: () => download(o.key) },
                  { icon: "share-2", label: "لینک اشتراک موقت", run: () => setModal({ kind: "share", key: o.key }) },
                  b.access === "public" && { icon: "globe", label: "کپی نشانی عمومی", run: () => copy(abs(b.publicBase + encKey(o.key)), "نشانی عمومی کپی شد") },
                  { icon: "pencil", label: "تغییر نام یا انتقال", run: () => setModal({ kind: "move", key: o.key }) },
                  "-",
                  { icon: "trash-2", label: "حذف", danger: true, run: () => remove(o.key) },
                ]} />
              </li>
            ))}
          </ul>
        )}
      {res?.list.next && <div className="text-center mt-3"><AsyncButton className={BTN_G + BTN_SM} onClick={async () => { const more = await api.storage.objects(b.id, prefix, res.list.next); setRes({ ...res, list: { ...res.list, next: more.next }, more: [...res.more, ...more.objects] }); }}>فایل‌های بیشتر</AsyncButton></div>}
      <FileModal b={b} modal={modal} onClose={() => setModal(null)} onDone={reload} />
    </Card>
  );
}

function FileModal({ b, modal, onClose, onDone }: { b: StorageBucket; modal: { kind: "mkdir" | "move" | "share"; key: string } | null; onClose: () => void; onDone: () => void }) {
  const { notify } = useApp();
  const [v, setV] = useState("");
  const [ttl, setTtl] = useState("86400");
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [seen, setSeen] = useState("");
  const k = modal ? modal.kind + modal.key : "";
  if (k !== seen) { setSeen(k); setV(modal?.kind === "move" ? modal.key : ""); setLink(null); }
  const title = modal?.kind === "mkdir" ? "پوشه جدید" : modal?.kind === "move" ? "تغییر نام یا انتقال" : "لینک اشتراک موقت";
  return (
    <Modal open={!!modal} onClose={onClose} title={title} icon={modal?.kind === "share" ? "share-2" : modal?.kind === "move" ? "pencil" : "folder-open"}>
      {modal?.kind === "mkdir" && <div className="space-y-4">
        <Field label="نام پوشه" hint={modal.key ? "داخل " + modal.key : "در ریشه باکت"}><input value={v} onChange={(e) => setV(e.target.value)} dir="ltr" className={INPUT + " text-left"} placeholder="images" /></Field>
        <div className="flex justify-end"><AsyncButton disabled={!v.trim()} onClick={async () => { await api.storage.mkdir(b.id, modal.key, v.trim()); onClose(); onDone(); }}>ساخت پوشه</AsyncButton></div>
      </div>}
      {modal?.kind === "move" && <div className="space-y-4">
        <Field label="مسیر کامل جدید" hint={modal.key.endsWith("/") ? "پوشه و همه فایل‌های داخلش منتقل می‌شوند؛ مسیر با / تمام شود" : "مثل images/2025/logo.png"}><input value={v} onChange={(e) => setV(e.target.value)} dir="ltr" className={INPUT + " text-left font-mono"} /></Field>
        <div className="flex justify-end"><AsyncButton disabled={!v.trim() || v === modal.key} onClick={async () => { const n = await api.storage.move(b.id, modal.key, v.trim()); notify(fa(n) + " فایل منتقل شد", "check"); onClose(); onDone(); }}>انتقال</AsyncButton></div>
      </div>}
      {modal?.kind === "share" && <div className="space-y-4">
        <p className="text-sm text-white/70 leading-7">هر کس این لینک را داشته باشد تا پایان مهلت می‌تواند <b dir="ltr">{baseName(modal.key)}</b> را دانلود کند؛ پس از آن لینک کار نمی‌کند.</p>
        <Field label="مدت اعتبار"><Select label="مدت اعتبار" value={ttl} onChange={setTtl} options={SHARE_TTLS.map((t) => ({ value: String(t.value), label: t.label }))} /></Field>
        {link && <div className="rounded-xl bg-black/30 px-3 py-2.5 break-all text-xs"><CopyText text={abs(link.url)} className="font-mono" /><span className="block text-[11px] text-white/50 mt-1">معتبر تا {when(link.expiresAt)}</span></div>}
        <div className="flex justify-end"><AsyncButton onClick={async () => setLink(await api.storage.share(b.id, modal.key, Number(ttl)))}><Icon name="share-2" size={16} />ساخت لینک</AsyncButton></div>
      </div>}
    </Modal>
  );
}

/* ---------- usage ---------- */
function Usage({ b }: { b: StorageBucket }) {
  const db = useDB();
  const plan = db.storage.plans.find((p) => p.id === b.planId);
  const [now] = useState(() => Date.now());
  const days = Array.from({ length: 7 }, (_, i) => new Date(now - (6 - i) * 86400_000).toISOString().slice(0, 10));
  const row = (d: string) => b.usage.find((u) => u.day === d);
  const labels = days.map((d) => new Date(d + "T12:00:00Z").toLocaleDateString("fa-IR", { month: "short", day: "numeric" }));
  const sum = (k: "requests" | "bytesIn" | "bytesOut") => b.usage.reduce((s, u) => s + u[k], 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon="hard-drive" label="فضای استفاده‌شده" value={bytes(b.usedBytes)} sub={"از " + (plan?.name ?? "")} />
        <StatCard icon="file-text" label="تعداد فایل" value={b.objects} />
        <StatCard icon="activity" label="درخواست‌ها (۷ روز)" value={sum("requests")} />
        <StatCard icon="arrow-down-up" label="ترافیک ورودی / خروجی (۷ روز)" value={bytes(sum("bytesIn")) + " / " + bytes(sum("bytesOut"))} />
      </div>
      <Card><Meter value={b.usedBytes} max={(plan?.sizeGb ?? 1) * GB} label="حجم پلن" right={bytes(b.usedBytes) + " از " + (plan?.name ?? "")} /><p className="text-[11px] text-white/50 mt-3">{b.usageAt ? "آخرین به‌روزرسانی: " + b.usageAt + " (هر ساعت)" : "آمار مصرف هر ساعت به‌روز می‌شود."}</p></Card>
      <div className="grid lg:grid-cols-3 gap-4">
        <Card title="حجم ذخیره‌شده" icon="hard-drive"><Bars data={days.map((d) => row(d)?.sizeBytes ?? 0)} labels={labels} fmt={bytes} /></Card>
        <Card title="درخواست‌ها" icon="activity"><Bars data={days.map((d) => row(d)?.requests ?? 0)} labels={labels} /></Card>
        <Card title="ترافیک خروجی" icon="download"><Bars data={days.map((d) => row(d)?.bytesOut ?? 0)} labels={labels} fmt={bytes} /></Card>
      </div>
    </div>
  );
}

/* ---------- custom domains ---------- */
function Domains({ b }: { b: StorageBucket }) {
  const { notify, confirm } = useApp();
  const [host, setHost] = useState("");
  return (
    <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4 items-start">
      <Card title="دامنه‌های اختصاصی" icon="globe">
        {b.domains.length === 0 ? <p className="text-sm text-white/55">هنوز دامنه‌ای متصل نکرده‌اید.</p> : (
          <ul className="divide-y divide-white/[0.06]">
            {b.domains.map((d) => (
              <li key={d.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                <span className="min-w-0"><b dir="ltr" className="text-sm break-all">{d.host}</b><span className="flex flex-wrap gap-1.5 mt-1.5"><Pill map={DOMAIN_STATUS} s={d.status} />{d.status === "active" && <span className="inline-flex items-center gap-1 text-[11px]">SSL: <Pill map={SSL_STATUS} s={d.ssl} /></span>}</span>{d.checked && <span className="block text-[11px] text-white/50 mt-1">بررسی: {d.checked}</span>}</span>
                <span className="flex gap-2">
                  <AsyncButton className={BTN_G + BTN_SM} onClick={async () => { const r = await api.storage.verifyDomain(b.id, d.id); notify(r.status === "active" ? "CNAME درست است" : "CNAME هنوز به باکت اشاره نمی‌کند", r.status === "active" ? "circle-check" : "clock"); }}><Icon name="refresh-cw" size={14} />بررسی</AsyncButton>
                  <AsyncButton className={BTN_D + BTN_SM} onClick={async () => { if (await confirm("دامنه " + d.host + " جدا شود؟", { danger: true, ok: "حذف" })) await api.storage.removeDomain(b.id, d.id); }}><Icon name="trash-2" size={14} /></AsyncButton>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2 mt-4 pt-4 border-t border-white/[0.08]">
          <input value={host} onChange={(e) => setHost(e.target.value.trim().toLowerCase())} dir="ltr" placeholder="cdn.example.ir" aria-label="دامنه" className={INPUT + " text-left"} />
          <AsyncButton disabled={!host || b.status !== "active"} onClick={async () => { await api.storage.addDomain(b.id, host); setHost(""); notify("دامنه اضافه شد؛ رکورد CNAME را بسازید", "globe"); }}>افزودن</AsyncButton>
        </div>
      </Card>
      <Card title="راه‌اندازی" icon="list-checks">
        <ol className="space-y-3 text-sm text-white/70 leading-7 list-decimal pr-5">
          <li>در DNS دامنه یک رکورد <b>CNAME</b> بسازید:<div className="mt-2 rounded-lg bg-black/30 px-3 py-2 text-xs"><span className="text-white/50">مقصد: </span><CopyText text={b.cname} className="font-mono" /></div></li>
          <li>پس از اعمال رکورد (چند دقیقه تا چند ساعت)، «بررسی» را بزنید. تا ۷۲ ساعت خودکار هم بررسی می‌شود.</li>
          <li>گواهی SSL پس از تأیید CNAME خودکار صادر می‌شود.</li>
        </ol>
        <p className="text-[11px] text-white/50 mt-3 leading-6">{b.access === "public" ? "فایل‌ها با نشانی https://دامنه/مسیر-فایل در دسترس خواهند بود." : "باکت خصوصی است: روی دامنه فقط لینک‌های امضاشده کار می‌کنند. برای نمایش عمومی، دسترسی باکت را عمومی کنید."}</p>
      </Card>
    </div>
  );
}

/* ---------- settings ---------- */
const EMPTY_RULE: StorageCors = { origins: ["https://example.com"], methods: ["GET"], headers: ["*"], maxAge: 3600 };
function Settings({ b }: { b: StorageBucket }) {
  const db = useDB(); const router = useRouter(); const { notify, confirm } = useApp();
  const plan = db.storage.plans.find((p) => p.id === b.planId);
  const bigger = db.storage.plans.filter((p) => p.sizeGb > (plan?.sizeGb ?? 0));
  const [up, setUp] = useState("");
  const [life, setLife] = useState({ on: !!b.lifecycle, days: String(b.lifecycle?.days ?? 30), prefix: b.lifecycle?.prefix ?? "" });
  const [rules, setRules] = useState<StorageCors[]>(b.cors);
  const [confirmName, setConfirmName] = useState("");
  const active = b.status === "active";
  const setRule = (i: number, p: Partial<StorageCors>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const upTo = bigger.find((p) => p.id === up);
  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      <div className="space-y-4">
        <Card title="دسترسی و نسخه‌بندی" icon="shield">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4"><div><b className="text-sm">دسترسی عمومی</b><p className="text-[11px] text-white/55 mt-1 leading-6">هر کس نشانی فایل را داشته باشد بدون کلید آن را می‌بیند. فهرست فایل‌ها و نوشتن همچنان کلید می‌خواهد.</p></div>
              <Switch disabled={!active} on={b.access === "public"} label="دسترسی عمومی" onChange={async (v) => { if (v && !(await confirm("همه فایل‌های این باکت برای عموم قابل خواندن می‌شوند. ادامه می‌دهید؟", { ok: "عمومی کن" }))) return; try { await api.storage.setAccess(b.id, v ? "public" : "private"); } catch (e) { notify((e as Error).message, "circle-alert"); } }} /></div>
            <div className="flex items-start justify-between gap-4"><div><b className="text-sm">نسخه‌بندی (Versioning)</b><p className="text-[11px] text-white/55 mt-1 leading-6">با هر بازنویسی یا حذف، نسخه قبلی نگه داشته می‌شود و حجم مصرف می‌کند. نسخه‌ها با SDK یا aws-cli بازیابی می‌شوند.</p></div>
              <Switch disabled={!active} on={b.versioning} label="نسخه‌بندی" onChange={async (v) => { try { await api.storage.setVersioning(b.id, v); } catch (e) { notify((e as Error).message, "circle-alert"); } }} /></div>
          </div>
        </Card>
        <Card title="حذف خودکار (Lifecycle)" icon="timer">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4"><span className="text-sm">فایل‌ها پس از چند روز خودکار حذف شوند</span><Switch on={life.on} label="حذف خودکار" onChange={(v) => setLife({ ...life, on: v })} /></div>
            {life.on && <div className="grid grid-cols-[7rem_1fr] gap-3">
              <Field label="پس از (روز)"><input value={life.days} onChange={(e) => setLife({ ...life, days: e.target.value.replace(/\D/g, "") })} inputMode="numeric" dir="ltr" className={INPUT + " text-left"} /></Field>
              <Field label="فقط در مسیر" hint="خالی = کل باکت"><input value={life.prefix} onChange={(e) => setLife({ ...life, prefix: e.target.value })} dir="ltr" placeholder="logs/" className={INPUT + " text-left font-mono"} /></Field>
            </div>}
            <div className="flex justify-end"><AsyncButton disabled={!active || (life.on && !(Number(life.days) >= 1))} onClick={async () => { await api.storage.setLifecycle(b.id, life.on ? { days: Number(life.days), prefix: life.prefix.trim() } : null); notify("قانون حذف خودکار ذخیره شد", "check"); }}>ذخیره</AsyncButton></div>
          </div>
        </Card>
        <Card title="ارتقای حجم" icon="gauge">
          <p className="text-sm text-white/70">پلن فعلی: <b>{plan?.name}</b> ({toman(plan?.price ?? 0)} در ماه)</p>
          {bigger.length === 0 ? <p className="text-[11px] text-white/50 mt-2">بزرگ‌ترین پلن را دارید؛ برای حجم بیشتر تیکت بزنید.</p> : <div className="flex flex-wrap items-end gap-2 mt-3">
            <Select label="پلن جدید" className="flex-1 min-w-40" value={up} onChange={setUp} options={[{ value: "", label: "انتخاب پلن بزرگ‌تر" }, ...bigger.map((p) => ({ value: p.id, label: p.name + " — " + toman(p.price) + " / ماه" }))]} />
            <AsyncButton disabled={!upTo} confirmText={upTo ? "حجم باکت به " + upTo.name + " ارتقا یابد؟ کاهش حجم بعداً ممکن نیست." : undefined} onClick={async () => { await api.storage.changePlan(b.id, up); setUp(""); notify("حجم باکت ارتقا یافت", "gauge"); }}>ارتقا</AsyncButton>
          </div>}
        </Card>
      </div>
      <div className="space-y-4">
        <Card title="قوانین CORS" icon="network" action={<button type="button" disabled={rules.length >= 10} onClick={() => setRules([...rules, { ...EMPTY_RULE }])} className={BTN_G + BTN_SM}><Icon name="plus" size={14} />قانون</button>}>
          <p className="text-[11px] text-white/55 leading-6 mb-3">برای خواندن یا بارگذاری مستقیم از مرورگر (JavaScript سایت شما) لازم است.</p>
          {rules.length === 0 && <p className="text-sm text-white/55">قانونی تعریف نشده است.</p>}
          <ul className="space-y-3">
            {rules.map((r, i) => (
              <li key={i} className="rounded-2xl border border-white/[0.08] p-3 space-y-3">
                <Field label="Originها (هر خط یکی)"><textarea value={r.origins.join("\n")} onChange={(e) => setRule(i, { origins: e.target.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean) })} rows={2} dir="ltr" className={INPUT + " h-auto py-2 text-left font-mono"} /></Field>
                <fieldset><legend className="text-xs text-white/60 mb-1.5">متدها</legend><div className="flex flex-wrap gap-3">{CORS_METHODS.map((m) => (
                  <label key={m} className="inline-flex items-center gap-1.5 text-xs font-mono"><input type="checkbox" checked={r.methods.includes(m)} onChange={(e) => setRule(i, { methods: e.target.checked ? [...r.methods, m] : r.methods.filter((x) => x !== m) })} />{m}</label>
                ))}</div></fieldset>
                <div className="grid grid-cols-[1fr_6rem] gap-2">
                  <Field label="هدرهای مجاز"><input value={r.headers.join(", ")} onChange={(e) => setRule(i, { headers: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} dir="ltr" className={INPUT + " text-left font-mono"} /></Field>
                  <Field label="MaxAge"><input value={String(r.maxAge)} onChange={(e) => setRule(i, { maxAge: Number(e.target.value.replace(/\D/g, "")) || 0 })} dir="ltr" inputMode="numeric" className={INPUT + " text-left"} /></Field>
                </div>
                <button type="button" onClick={() => setRules(rules.filter((_, j) => j !== i))} className="text-[11px] text-rose-300 hover:text-rose-200 inline-flex items-center gap-1"><Icon name="trash-2" size={12} />حذف قانون</button>
              </li>
            ))}
          </ul>
          <div className="flex justify-end mt-3"><AsyncButton disabled={!active} onClick={async () => { const r = await api.storage.setCors(b.id, rules); notify(r.corsApplied ? "قوانین CORS ذخیره شد" : "ذخیره شد؛ این سرور CORS را سراسری پاسخ می‌دهد", "check"); }}>ذخیره CORS</AsyncButton></div>
        </Card>
        <Card title="حذف باکت" icon="trash-2">
          <p className="text-sm text-white/70 leading-7">باکت با همه فایل‌ها و نسخه‌هایش برای همیشه حذف می‌شود و هزینه ساعتی متوقف می‌شود.</p>
          <div className="flex gap-2 mt-3">
            <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} dir="ltr" placeholder={b.name} aria-label="نام باکت برای تأیید" className={INPUT + " text-left font-mono"} />
            <AsyncButton danger disabled={confirmName !== b.name} onClick={async () => { await api.storage.remove(b.id, confirmName); notify("باکت حذف شد", "trash-2"); router.push("/panel/storage" as never); }}>حذف</AsyncButton>
          </div>
        </Card>
      </div>
    </div>
  );
}
