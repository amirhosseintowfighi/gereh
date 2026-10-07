"use client";
import { useState } from "react";
import { BTN_G, BTN_P, INPUT, TEXTAREA } from "@/lib/cls";
import { Markdown } from "@/lib/markdown";
import { api, useDB } from "@/lib/store";
import type { Post } from "@/lib/types";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Badge, Card, Empty, Field } from "../ui";
import { AsyncButton, IconBtn, PageTitle, Tabs } from "../ui-client";

type Draft = { id?: string; slug: string; title: string; excerpt: string; body: string; tags: string; status: "draft" | "published" };
const blank: Draft = { slug: "", title: "", excerpt: "", body: "", tags: "", status: "draft" };
/** a URL slug from a title: Persian/latin letters and digits joined by hyphens */
export const slugify = (s: string) => s.toLowerCase().replace(/[‌\s_]+/g, "-").replace(/[^a-z0-9؀-ۿ-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

/** staff blog CMS: list, write with live preview, publish */
export function AdminBlog() {
  const db = useDB();
  const { notify, confirm } = useApp();
  const [d, setD] = useState<Draft | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [view, setView] = useState("write");
  const edit = (p: Post) => { setD({ id: p.id, slug: p.slug, title: p.title, excerpt: p.excerpt, body: p.body, tags: p.tags.join("، "), status: p.status }); setSlugTouched(true); setView("write"); };
  const save = async (status: "draft" | "published") => {
    if (!d) return;
    const id = await api.blog.save({ id: d.id, slug: d.slug, title: d.title.trim(), excerpt: d.excerpt.trim(), body: d.body, tags: d.tags.split(/[,،]/).map((t) => t.trim()).filter(Boolean), status });
    setD({ ...d, id, status });
    notify(status === "published" ? "نوشته منتشر شد" : "پیش‌نویس ذخیره شد", status === "published" ? "send" : "check");
  };

  if (d) return (
    <div>
      <PageTitle title={d.id ? "ویرایش نوشته" : "نوشته جدید"} back={["/admin/blog", "بلاگ"]}
        action={<div className="flex gap-2">
          <button type="button" onClick={() => setD(null)} className={BTN_G + " h-10 px-4 text-sm"}>بازگشت به فهرست</button>
          <AsyncButton className={BTN_G + " h-10 px-4 text-sm"} onClick={() => save("draft")}>ذخیره پیش‌نویس</AsyncButton>
          <AsyncButton className={BTN_P + " h-10 px-4 text-sm"} onClick={() => save("published")}><Icon name="send" size={15} />{d.status === "published" ? "به‌روزرسانی" : "انتشار"}</AsyncButton>
        </div>} />
      <div className="grid xl:grid-cols-[1fr_20rem] gap-4 items-start">
        <Card>
          <div className="mb-4"><Tabs size="sm" value={view} onChange={setView} label="حالت ویرایشگر" options={[{ id: "write", label: "نوشتن", icon: "pencil" }, { id: "preview", label: "پیش‌نمایش", icon: "eye" }]} /></div>
          {view === "write" ? (
            <div className="space-y-4">
              <Field label="عنوان"><input value={d.title} maxLength={160} onChange={(e) => setD({ ...d, title: e.target.value, slug: slugTouched ? d.slug : slugify(e.target.value) })} className={INPUT} /></Field>
              <Field label="متن" hint="Markdown ساده: ## تیتر، - فهرست، **پررنگ**، `کد`، [پیوند](/kb)، ```بلوک کد``` و جدول با |">
                <textarea value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} rows={22} className={TEXTAREA + " font-mono text-[13px] leading-7"} />
              </Field>
            </div>
          ) : (
            <div><h1 className="text-3xl font-black leading-[1.5] mb-3">{d.title || "بدون عنوان"}</h1><p className="text-white/65 mb-6 leading-8">{d.excerpt}</p><Markdown src={d.body} /></div>
          )}
        </Card>
        <div className="space-y-4">
          <Card title="انتشار" icon="send">
            <div className="space-y-4">
              <Field label="نشانی (slug)" hint={"/blog/" + (d.slug || "…")}><input value={d.slug} dir="auto" maxLength={80} onChange={(e) => { setSlugTouched(true); setD({ ...d, slug: slugify(e.target.value) }); }} className={INPUT} /></Field>
              <Field label="خلاصه (توضیحات موتور جستجو)" hint={d.excerpt.length.toLocaleString("fa-IR") + " / ۳۰۰ — بهتر است ۱۲۰ تا ۱۶۰ نویسه"}><textarea value={d.excerpt} maxLength={300} rows={4} onChange={(e) => setD({ ...d, excerpt: e.target.value })} className={TEXTAREA} /></Field>
              <Field label="برچسب‌ها" hint="با ویرگول جدا کنید"><input value={d.tags} onChange={(e) => setD({ ...d, tags: e.target.value })} className={INPUT} /></Field>
              <div className="text-xs text-white/55">وضعیت: {d.status === "published" ? <Badge tone="green">منتشرشده</Badge> : <Badge>پیش‌نویس</Badge>}</div>
              {d.id && d.status === "published" && <a href={"/blog/" + encodeURIComponent(d.slug)} target="_blank" className="text-xs acc inline-flex items-center gap-1">مشاهده در سایت <Icon name="external-link" size={12} /></a>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <PageTitle title="بلاگ" sub="نوشته‌های منتشرشده در /blog، نقشه سایت و خوراک RSS نمایش داده می‌شوند."
        action={<button type="button" onClick={() => { setD(blank); setSlugTouched(false); setView("write"); }} className={BTN_P + " px-4 h-10 text-sm"}><Icon name="plus" size={16} /> نوشته جدید</button>} />
      <Card pad="p-3 sm:p-4">
        {db.posts.length === 0 ? <Empty icon="newspaper" title="هنوز نوشته‌ای ندارید" /> : db.posts.map((p) => (
          <div key={p.id} className="p-3 rounded-xl hover:bg-white/[0.03] flex flex-wrap items-center justify-between gap-3">
            <button type="button" onClick={() => edit(p)} className="min-w-0 text-right">
              <span className="block font-bold text-sm">{p.title}</span>
              <span className="block text-[11px] text-white/55 mt-1">{p.author} · {p.status === "published" ? "انتشار " + p.publishedAt : "ویرایش " + p.updatedAt}</span>
            </button>
            <div className="flex items-center gap-2">
              {p.status === "published" ? <Badge tone="green">منتشرشده</Badge> : <Badge>پیش‌نویس</Badge>}
              <IconBtn icon="pencil" label={"ویرایش " + p.title} onClick={() => edit(p)} />
              <IconBtn icon="trash-2" label={"حذف " + p.title} className="hover:text-rose-300" onClick={async () => { if (await confirm("«" + p.title + "» حذف شود؟", { danger: true, ok: "حذف" })) { await api.blog.remove(p.id); notify("نوشته حذف شد"); } }} />
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
