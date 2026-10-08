"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BTN_G, BTN_P, INPUT } from "@/lib/cls";
import { api, useDB, useSession } from "@/lib/store";
import type { TeamRole } from "@/lib/types";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field } from "../ui";
import { AsyncButton, IconBtn, Menu, Select } from "../ui-client";

export const TEAM_ROLES: { value: TeamRole; label: string; hint: string }[] = [
  { value: "admin", label: "مدیر حساب", hint: "همه سرویس‌ها و پرداخت؛ بدون تغییر تنظیمات امنیتی صاحب حساب" },
  { value: "tech", label: "فنی", hint: "سرورها، هاست، دامنه و تیکت؛ بدون دسترسی مالی" },
  { value: "billing", label: "مالی", hint: "صورتحساب، کیف پول، تمدید و تیکت" },
];
export const roleLabel = (r: string) => TEAM_ROLES.find((x) => x.value === r)?.label ?? r;

/** owner: invite people and manage their roles */
export function TeamTab() {
  const db = useDB();
  const { notify, confirm } = useApp();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("tech");
  const t = db.team;
  return (
    <div className="grid xl:grid-cols-[1fr_1.3fr] gap-4">
      <Card title="دعوت عضو جدید" icon="users-round">
        <p className="text-sm text-white/55 leading-7 mb-4">همکاران با حساب خودشان وارد می‌شوند و از منوی بالای پنل به حساب شما می‌روند؛ رمز شما را لازم ندارند.</p>
        <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
          <Field label="ایمیل"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" className={INPUT + " text-left"} placeholder="colleague@example.com" /></Field>
          <Field label="نقش" hint={TEAM_ROLES.find((r) => r.value === role)?.hint}><Select label="نقش" value={role} onChange={(v) => setRole(v as TeamRole)} options={TEAM_ROLES.map(({ value, label }) => ({ value, label }))} /></Field>
          <AsyncButton onClick={async () => { await api.team.invite(email, role); setEmail(""); notify("دعوت‌نامه ارسال شد", "send"); }}><Icon name="send" size={15} /> ارسال دعوت</AsyncButton>
        </form>
      </Card>
      <Card title="اعضای تیم" icon="users" pad="p-3 sm:p-4">
        {t.members.length === 0 && t.invites.length === 0 ? <Empty icon="users-round" title="هنوز عضوی ندارید" /> : <>
          {t.members.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl hover:bg-white/[0.03]">
              <div className="min-w-0"><div className="text-sm font-bold">{m.name}</div><div className="text-[11px] text-white/55 ltr text-right">{m.email}</div></div>
              <div className="flex items-center gap-2">
                <Select className="w-32" label={"نقش " + m.name} value={m.role} onChange={async (v) => { await api.team.setRole(m.id, v as TeamRole); notify("نقش تغییر کرد"); }} options={TEAM_ROLES.map(({ value, label }) => ({ value, label }))} />
                <IconBtn icon="trash-2" label={"حذف " + m.name} className="hover:text-rose-300" onClick={async () => { if (await confirm(m.name + " از تیم حذف شود؟ دسترسی او فورا قطع می‌شود.", { danger: true, ok: "حذف" })) { await api.team.remove(m.id); notify("عضو حذف شد"); } }} />
              </div>
            </div>
          ))}
          {t.invites.map((i) => (
            <div key={i.id} className="flex items-center justify-between gap-3 p-3 rounded-xl">
              <div className="min-w-0"><div className="text-sm ltr text-right">{i.email}</div><div className="text-[11px] text-white/55 mt-0.5">در انتظار پذیرش تا {i.expires}</div></div>
              <div className="flex items-center gap-2"><Badge>{roleLabel(i.role)}</Badge><IconBtn icon="x" label={"لغو دعوت " + i.email} onClick={async () => { await api.team.cancelInvite(i.id); notify("دعوت لغو شد"); }} /></div>
            </div>
          ))}
        </>}
      </Card>
    </div>
  );
}

/** header menu: switch between your own account and accounts you are a member of */
export function AccountSwitcher() {
  const db = useDB(); const session = useSession();
  const router = useRouter();
  const ships = db.team.memberships;
  if (!session || !ships.length) return null;
  const current = session.teamRole ? ships.find((s) => s.ownerId === session.userId) : null;
  const go = async (ownerId: string | null) => { await api.team.switchTo(ownerId); router.push("/panel"); };
  return (
    <Menu label="انتخاب حساب" triggerClass={BTN_G + " h-10 px-3 text-xs max-sm:hidden"}
      trigger={<><Icon name="users-round" size={15} />{current ? current.ownerName : "حساب من"}<Icon name="chevron-down" size={13} /></>}
      items={[
        { icon: "user-round", label: "حساب خودم", run: () => go(null) },
        ...ships.map((s) => ({ icon: "users-round", label: s.ownerName + " (" + roleLabel(s.role) + ")", run: () => go(s.ownerId) })),
      ]} />
  );
}

/** /team/accept?token= — joins the team, then opens the owner's panel */
export function TeamAccept() {
  const params = useSearchParams();
  const session = useSession();
  const router = useRouter();
  const token = params.get("token") || "";
  const [error, setError] = useState("");
  const tried = useRef(false);
  useEffect(() => {
    if (session === undefined || tried.current) return;
    if (session === null) { router.replace(("/auth?next=" + encodeURIComponent("/team/accept?token=" + token)) as never); return; }
    tried.current = true;
    api.team.accept(token).then(() => router.replace("/panel")).catch((e: unknown) => setError(e instanceof Error ? e.message : "پذیرش دعوت ناموفق بود."));
  }, [session, token, router]);
  return (
    <main id="main" className="min-h-screen grid place-items-center p-6 text-center">
      {error ? <div role="alert" className="max-w-md"><Icon name="circle-alert" size={36} className="mx-auto text-rose-300" /><h1 className="text-xl font-black mt-4">دعوت پذیرفته نشد</h1><p className="text-white/60 mt-2 leading-7">{error}</p><a href="/panel" className={BTN_P + " mt-6 px-5 h-10 text-sm inline-flex"}>رفتن به پنل</a></div>
        : <div aria-busy="true"><Icon name="loader-circle" size={30} className="animate-spin mx-auto text-white/60" /><h1 className="text-lg font-bold mt-4">در حال پیوستن به تیم…</h1></div>}
    </main>
  );
}
