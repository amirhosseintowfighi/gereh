import Link from "next/link";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { ArticleView } from "@/components/site/article";
import { GEO_DOCS } from "@/content/geo";
import { BTN_G, BTN_P, GLASS_SOFT } from "@/lib/cls";
import { breadcrumbLd, ORG_ID, pageMeta, SITE_URL } from "@/lib/seo";

const TITLE = "راهنمای Geo DNS";
const DESC = "راه‌اندازی Geo DNS گره: ثبت دامنه، تغییر NS، رکوردهای ایران و خارج، بررسی سلامت و سوییچ خودکار، همگام‌سازی مدیریت‌شده و تمدید.";
export const metadata = pageMeta({ title: TITLE, description: DESC, path: "/docs/geo-dns" });

export default function Page() {
  return (
    <>
      <JsonLd data={[breadcrumbLd([["Geo DNS", "/geo-dns"], ["راهنما", "/docs/geo-dns"]]), { "@type": "TechArticle", headline: TITLE, description: DESC, url: SITE_URL + "/docs/geo-dns", inLanguage: "fa-IR", author: { "@id": ORG_ID }, publisher: { "@id": ORG_ID } }]} />
      <ArticleView crumbs={[["Geo DNS", "/geo-dns"], ["راهنما", "/docs/geo-dns"]]} title={TITLE} lead="از ثبت دامنه تا همگام‌سازی سرور خارج." body={GEO_DOCS.replaceAll("https://gereh.net", SITE_URL)}
        meta={<span className="flex items-center gap-1.5"><Icon name="radar" size={14} />Geo DNS</span>}
        aside={(
          <div className={GLASS_SOFT + " rounded-2xl p-4 space-y-2"}>
            <Link href={"/panel/geo?new=1" as never} className={BTN_P + " w-full h-10 text-sm"}><Icon name="radar" size={15} />فعال‌سازی</Link>
            <Link href={"/geo-dns#plans" as never} className={BTN_G + " w-full h-10 text-sm"}><Icon name="tag" size={15} />پلن‌ها</Link>
          </div>
        )} />
    </>
  );
}
