import { asc, eq } from "drizzle-orm";
import { CostCalculator } from "@/components/site/cost-calculator";
import { SectionHead } from "@/components/ui";
import { VPS, type Plan } from "@/lib/catalog";
import { fa } from "@/lib/format";
import { pageMeta } from "@/lib/seo";
import type { CalcCatalog } from "@/lib/vps-billing";
import { db } from "@/server/ctx";
import * as t from "@/server/db/schema";

export const dynamic = "force-dynamic";
export const metadata = pageMeta({ title: "محاسبه‌گر هزینه", description: "هزینه سرور ابری، گره اپ، پایگاه داده، فضای ذخیره‌سازی، سرویس ایمیل، API هوش مصنوعی و Geo DNS را برای ۱ تا ۱۲ ماه حساب کنید.", path: "/pricing/calculator" });

/** each product line reads its live plan table; a missing table or a failed query just drops that line */
async function load(): Promise<CalcCatalog> {
  const d = await db();
  const safe = async <T,>(f: () => Promise<T[]>) => { try { return await f(); } catch { return [] as T[]; } };
  const [cloud, paas, storage, mail, ai, geo] = await Promise.all([
    safe(() => d.select().from(t.plans).where(eq(t.plans.kind, "cloud")).orderBy(asc(t.plans.position))),
    safe(() => d.select().from(t.paasPlans).where(eq(t.paasPlans.active, true)).orderBy(asc(t.paasPlans.position))),
    safe(() => d.select().from(t.storagePlans).where(eq(t.storagePlans.active, true)).orderBy(asc(t.storagePlans.position))),
    safe(() => d.select().from(t.mailPlans).where(eq(t.mailPlans.active, true)).orderBy(asc(t.mailPlans.position))),
    safe(() => d.select().from(t.aiModels)),
    safe(() => d.select().from(t.geoPlans).where(eq(t.geoPlans.active, true)).orderBy(asc(t.geoPlans.position))),
  ]);
  const vps = (cloud.length ? cloud.map((p) => p.data as Plan) : VPS.cloud).filter((p) => p.active !== false);
  const out: CalcCatalog = [
    { group: "vps", label: "سرور ابری", icon: "server", unit: "سرور", items: vps.map((p) => ({ id: p.id, name: p.name, monthly: p.price, meta: [p.cpu, p.ram, p.disk].filter(Boolean).join("، ") })) },
    { group: "apps", label: "گره اپ", icon: "rocket", unit: "اپ", items: paas.filter((p) => p.kind === "app").map((p) => ({ id: p.id, name: p.name, monthly: p.price, meta: fa(p.cpu) + " هسته، " + fa(p.ramMb) + " مگ رم" })) },
    { group: "dbs", label: "پایگاه داده", icon: "database", unit: "پایگاه", items: paas.filter((p) => p.kind === "db").map((p) => ({ id: p.id, name: p.name, monthly: p.price, meta: fa(p.ramMb) + " مگ رم، " + fa(p.diskGb) + " گیگ" })) },
    { group: "storage", label: "فضای ذخیره‌سازی", icon: "hard-drive", unit: "باکت", items: storage.map((p) => ({ id: p.id, name: p.name, monthly: p.price, meta: fa(p.sizeGb) + " گیگابایت" })) },
    { group: "mail", label: "سرویس ایمیل", icon: "mail", unit: "دامنه", items: mail.map((p) => ({ id: p.id, name: p.name, monthly: p.price, meta: fa(p.mailboxes) + " صندوق، " + fa(p.monthlyLimit) + " ارسال در ماه" })) },
    { group: "ai", label: "API هوش مصنوعی", icon: "bot", unit: "میلیون توکن ورودی + خروجی در ماه", items: ai.filter((m) => (m as { active?: boolean }).active !== false).map((m) => ({ id: m.id, name: m.name, monthly: m.inPrice + m.outPrice, meta: "ورودی " + fa(m.inPrice) + "، خروجی " + fa(m.outPrice) + " تومان در هر میلیون" })) },
    { group: "geo", label: "Geo DNS", icon: "radar", unit: "دامنه", items: geo.map((p) => ({ id: p.id, name: p.name, monthly: p.price, meta: fa(p.records) + " رکورد" + (p.healthChecks ? "، failover" : "") })) },
  ];
  return out.filter((g) => g.items.length);
}

export default async function Page() {
  const cat = await load();
  return (
    <main id="main" className="max-w-6xl mx-auto px-4 sm:px-6 pt-32 pb-20">
      <SectionHead as="h2" title="محاسبه‌گر هزینه" sub="قیمت‌ها زنده از جدول پلن‌ها خوانده می‌شود. سرویس‌های ساعتی به‌اندازه مصرف واقعی هزینه دارند؛ این برآورد برای روشن ماندن تمام ماه است." />
      <CostCalculator cat={cat} />
    </main>
  );
}
