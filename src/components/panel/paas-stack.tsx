"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { BTN_G, BTN_P, INPUT, TEXTAREA } from "@/lib/cls";
import { fa } from "@/lib/format";
import { appMonthly, engineOf, PAAS_NAME_RE, stackOf } from "@/lib/paas";
import { parseStack, STACK_GALLERY, stackAppName, stackFromCompose, StackError, type StackPlan } from "@/lib/paas-stack";
import { api, useDB } from "@/lib/store";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Field } from "../ui";
import { AsyncButton, Modal, PageTitle } from "../ui-client";
import { Cost } from "./paas-shared";

const BLANK = `name: my-stack
databases:
  - { id: main, engine: postgres, version: "16" }
apps:
  - name: $APP_NAME
    image: nginx:1.29-alpine
    port: 80
    env:
      DATABASE_URL: $DB_main_URL
      SECRET_KEY: $RANDOM_STRING
`;

/** «قالب ترکیبی»: gallery + YAML editor with live validation, cost and a one-click create */
export function StackTemplates() {
  const db = useDB(); const router = useRouter(); const { notify } = useApp();
  const [yaml, setYaml] = useState(STACK_GALLERY[0].yaml);
  const [name, setName] = useState("stack-" + (db.paasApps.length + 1));
  const [compose, setCompose] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const parsed = useMemo((): { plan?: StackPlan; error?: string } => {
    try { return { plan: parseStack(yaml) }; } catch (e) { return { error: e instanceof StackError ? e.message : (e as Error).message }; }
  }, [yaml]);
  const plan = parsed.plan;
  const monthly = plan ? plan.apps.reduce((s, a) => { const p = db.paasPlans.find((x) => x.id === a.planId); return s + (p ? appMonthly(p, a.instances, a.disk?.sizeGb ?? 0) : 0); }, 0)
    + plan.databases.reduce((s, d) => s + (db.paasPlans.find((x) => x.id === d.planId)?.price ?? 0), 0) : 0;
  const names = plan ? plan.apps.map((a) => stackAppName(name, a)) : [];
  const nameError = names.find((n) => !PAAS_NAME_RE.test(n));
  return (
    <div>
      <PageTitle title="قالب ترکیبی" sub="چند اپ و پایگاه داده را با یک فایل YAML با هم بسازید و به هم وصل کنید." back={["/panel/apps/templates", "اپ‌های آماده"]}
        action={<Link href={"/docs/paas/stack-templates" as never} className={BTN_G + " h-10 px-4 text-sm"}><Icon name="book-open" size={15} />راهنمای قالب</Link>} />
      <h2 className="text-sm font-bold text-white/80 mb-3">گالری</h2>
      <ul className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
        {STACK_GALLERY.map((g) => (
          <li key={g.id}>
            <button type="button" onClick={() => { setYaml(g.yaml); setNotes([]); }} aria-pressed={yaml === g.yaml}
              className={"w-full h-full text-right rounded-2xl border p-4 transition flex flex-col " + (yaml === g.yaml ? "bg-sky-400/10 border-sky-300/50" : "bg-white/[0.035] border-white/[0.08] hover:border-white/25")}>
              <span className="flex items-center gap-2"><Icon name={g.icon} size={16} className="acc" /><b className="text-sm">{g.name}</b></span>
              <span className="text-[11px] text-white/55 leading-5 mt-2">{g.desc}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="grid xl:grid-cols-[1fr_22rem] gap-4 items-start">
        <Card title="ویرایشگر" icon="file-pen" action={<div className="flex gap-2">
          <button type="button" onClick={() => setCompose("")} className={BTN_G + " h-8 px-3 text-xs"}><Icon name="upload" size={13} />از docker-compose</button>
          <button type="button" onClick={() => { setYaml(BLANK); setNotes([]); }} className={BTN_G + " h-8 px-3 text-xs"}><Icon name="file-plus" size={13} />خالی</button>
        </div>}>
          <textarea value={yaml} onChange={(e) => setYaml(e.target.value)} dir="ltr" rows={24} spellCheck={false} aria-label="قالب YAML" className={TEXTAREA + " font-mono text-xs leading-6 text-left"} />
          <p className="text-[11px] text-white/50 mt-2 leading-6">
            متغیرها: <code dir="ltr">$APP_NAME</code>، <code dir="ltr">$APP_URL</code>، <code dir="ltr">$RANDOM_STRING</code> (با <code dir="ltr">_برچسب</code> بین اپ‌ها مشترک)، <code dir="ltr">$RANDOM_HEX</code>، <code dir="ltr">$RANDOM_BASE64</code> و <code dir="ltr">$DB_&lt;id&gt;_URL</code> (یا <code dir="ltr">_HOST</code>، <code dir="ltr">_PORT</code>، <code dir="ltr">_USER</code>، <code dir="ltr">_PASSWORD</code>، <code dir="ltr">_NAME</code>).
          </p>
          {notes.length > 0 && <ul className="mt-3 text-xs text-amber-200/90 space-y-1">{notes.map((n) => <li key={n}>• {n}</li>)}</ul>}
        </Card>
        <div className="xl:sticky xl:top-24 space-y-4">
          <Card title="پیش‌نمایش" icon="layers">
            {parsed.error ? <p role="alert" className="text-sm text-rose-300 leading-7">{parsed.error}</p> : plan && <>
              <Field label="نام پایه" error={nameError ? "«" + nameError + "» نام معتبری نیست" : undefined}><input value={name} onChange={(e) => setName(e.target.value.toLowerCase().trim())} dir="ltr" className={INPUT + " font-mono text-left"} /></Field>
              <ul className="mt-4 space-y-2 text-sm">
                {plan.apps.map((a, i) => (
                  <li key={a.suffix || "main"} className="rounded-xl bg-white/[0.04] p-3">
                    <span className="flex items-center gap-2"><Icon name="rocket" size={14} className="acc" /><b dir="ltr" className="font-mono text-xs">{names[i]}</b>{i === 0 && <Badge tone="green">عمومی</Badge>}</span>
                    <span className="block text-[11px] text-white/55 mt-1" dir="ltr" style={{ textAlign: "right" }}>{a.image ?? a.git!.url} · {stackOf(a.stack)?.label}{a.version ? " " + a.version : ""} · :{a.port}</span>
                    {a.env.some((e) => "db" in e) && <span className="block text-[11px] text-white/45 mt-1">اتصال: {[...new Set(a.env.filter((e) => "db" in e).map((e) => (e as { db: string }).db))].join("، ")}</span>}
                  </li>
                ))}
                {plan.databases.map((d) => (
                  <li key={d.id} className="rounded-xl bg-white/[0.04] p-3 flex items-center gap-2"><Icon name="database" size={14} className="acc" /><b dir="ltr" className="font-mono text-xs">{(name + "-" + d.id).slice(0, 30)}</b><span className="text-[11px] text-white/55">{engineOf(d.engine)?.label} {d.version}</span></li>
                ))}
              </ul>
              <div className="mt-4 pt-4 border-t border-white/[0.08]"><Cost monthly={monthly} /></div>
              <AsyncButton disabled={!!nameError} className={BTN_P + " w-full h-11 mt-4"} onClick={async () => {
                const r = await api.paas.createStack(yaml, name);
                notify(fa(r.appIds.length) + " اپ و " + fa(r.dbIds.length) + " پایگاه داده ساخته شد", "rocket");
                router.push(("/panel/apps/" + r.appIds[0]) as never);
              }}><Icon name="rocket" size={16} />ساخت همه</AsyncButton>
            </>}
          </Card>
        </div>
      </div>
      {compose !== null && (
        <Modal open onClose={() => setCompose(null)} title="تبدیل docker-compose" icon="upload" size="max-w-2xl">
          <p className="text-sm text-white/65 leading-7">محتوای docker-compose.yml را بچسبانید؛ سرویس‌های postgres، mysql، mariadb، mongo و redis به پایگاه داده مدیریت‌شده تبدیل می‌شوند.</p>
          <textarea value={compose} onChange={(e) => setCompose(e.target.value)} dir="ltr" rows={14} aria-label="docker-compose.yml" className={TEXTAREA + " font-mono text-xs mt-3 text-left"} />
          <AsyncButton className={BTN_P + " w-full h-11 mt-3"} onClick={async () => { const r = stackFromCompose(compose); setYaml(r.yaml); setNotes(r.notes); setCompose(null); }}><Icon name="refresh-cw" size={16} />تبدیل</AsyncButton>
        </Modal>
      )}
    </div>
  );
}
