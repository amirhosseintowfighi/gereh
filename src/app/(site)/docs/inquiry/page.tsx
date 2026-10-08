import Link from "next/link";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { ArticleView } from "@/components/site/article";
import { inquiryDocs } from "@/content/inquiry";
import { BTN_G, BTN_P, GLASS_SOFT } from "@/lib/cls";
import { breadcrumbLd, ORG_ID, pageMeta, SITE_URL } from "@/lib/seo";
import { publicInquiry } from "@/server/inquiry/public";

export const dynamic = "force-dynamic";
const TITLE = "مستندات API استعلام";
const DESC = "راهنمای کامل API استعلام گره: احراز هویت با کلید و رمز، sandbox رایگان، قالب پاسخ، کدهای خطا، هزینه و ورودی و خروجی هر سرویس با نمونه cURL، PHP، Python و Node.js.";
export const metadata = pageMeta({ title: TITLE, description: DESC, path: "/docs/inquiry" });

export default async function Page() {
  const prices = Object.fromEntries((await publicInquiry()).map((s) => [s.id, s.price]));
  return (
    <>
      <JsonLd data={[breadcrumbLd([["API استعلام", "/inquiry"], ["مستندات", "/docs/inquiry"]]), { "@type": "TechArticle", headline: TITLE, description: DESC, url: SITE_URL + "/docs/inquiry", inLanguage: "fa-IR", author: { "@id": ORG_ID }, publisher: { "@id": ORG_ID } }]} />
      <ArticleView crumbs={[["API استعلام", "/inquiry"], ["مستندات", "/docs/inquiry"]]} title={TITLE} lead="از اولین درخواست تا مدیریت خطا، با نمونه کد." body={inquiryDocs(SITE_URL, prices)}
        meta={<><span className="flex items-center gap-1.5"><Icon name="code-xml" size={14} />REST · JSON</span><span className="flex items-center gap-1.5"><Icon name="tag" size={14} />نسخه ۱</span></>}
        aside={(
          <div className={GLASS_SOFT + " rounded-2xl p-4 space-y-2"}>
            <Link href={"/panel/inquiry" as never} className={BTN_P + " w-full h-10 text-sm"}><Icon name="key-round" size={15} />دریافت کلید API</Link>
            <Link href={"/inquiry#pricing" as never} className={BTN_G + " w-full h-10 text-sm"}><Icon name="tag" size={15} />قیمت‌ها</Link>
          </div>
        )} />
    </>
  );
}
