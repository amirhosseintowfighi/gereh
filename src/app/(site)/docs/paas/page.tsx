import Link from "next/link";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { ArticleView } from "@/components/site/article";
import { PAAS_DOCS } from "@/content/paas-docs";
import { BTN_G, BTN_P, GLASS_SOFT } from "@/lib/cls";
import { breadcrumbLd, ORG_ID, pageMeta, SITE_URL } from "@/lib/seo";

const TITLE = "مستندات گره اپ";
const DESC = "راهنمای کامل استقرار اپ روی گره اپ: Git و Webhook، ZIP، Docker و Compose، بیلد خودکار، متغیرهای محیطی، پایگاه داده، دامنه و SSL، مقیاس، CLI، GitHub Actions، API و محدودیت‌ها.";
export const metadata = pageMeta({ title: TITLE, description: DESC, path: "/docs/paas" });

export default function PaasDocsPage() {
  return (
    <>
      <JsonLd data={[breadcrumbLd([["گره اپ", "/paas"], ["مستندات", "/docs/paas"]]), { "@type": "TechArticle", headline: TITLE, description: DESC, url: SITE_URL + "/docs/paas", inLanguage: "fa-IR", author: { "@id": ORG_ID }, publisher: { "@id": ORG_ID } }]} />
      <ArticleView crumbs={[["گره اپ", "/paas"], ["مستندات", "/docs/paas"]]} title={TITLE} lead="از اولین استقرار تا CI/CD، دامنه و پایگاه داده." body={PAAS_DOCS}
        meta={<><span className="flex items-center gap-1.5"><Icon name="rocket" size={14} />PaaS</span><span className="flex items-center gap-1.5"><Icon name="terminal" size={14} />CLI · API</span></>}
        aside={(
          <div className={GLASS_SOFT + " rounded-2xl p-4 space-y-2"}>
            <Link href="/panel/apps/new" className={BTN_P + " w-full h-10 text-sm"}><Icon name="rocket" size={15} />ساخت اپ</Link>
            <a href="/panel/keys" className={BTN_G + " w-full h-10 text-sm"}><Icon name="key-round" size={15} />ساخت توکن</a>
            <Link href="/paas#pricing" className={BTN_G + " w-full h-10 text-sm"}><Icon name="tag" size={15} />قیمت‌ها</Link>
          </div>
        )} />
    </>
  );
}
