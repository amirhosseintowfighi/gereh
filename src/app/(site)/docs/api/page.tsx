import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { ArticleView } from "@/components/site/article";
import { API_DOCS } from "@/content/api-docs";
import { BTN_G, GLASS_SOFT } from "@/lib/cls";
import { breadcrumbLd, ORG_ID, pageMeta, SITE_URL } from "@/lib/seo";

const TITLE = "مستندات API گره";
const DESC = "راهنمای REST API گره برای مدیریت سرور ابری، DNS و صورتحساب با توکن، همراه با نمونه curl، کدهای خطا، مشخصات OpenAPI و Terraform provider.";
export const metadata = pageMeta({ title: TITLE, description: DESC, path: "/docs/api" });

export default function ApiDocsPage() {
  return (
    <>
      <JsonLd data={[breadcrumbLd([["مستندات API", "/docs/api"]]), { "@type": "TechArticle", headline: TITLE, description: DESC, url: SITE_URL + "/docs/api", inLanguage: "fa-IR", author: { "@id": ORG_ID }, publisher: { "@id": ORG_ID }, proficiencyLevel: "Expert" }]} />
      <ArticleView crumbs={[["مستندات API", "/docs/api"]]} title={TITLE} lead="سرورها، DNS و صورتحساب‌ها را با چند خط کد مدیریت کنید." body={API_DOCS.replaceAll("https://gereh.net", SITE_URL)}
        meta={<><span className="flex items-center gap-1.5"><Icon name="code-xml" size={14} />REST · JSON</span><span className="flex items-center gap-1.5"><Icon name="tag" size={14} />نسخه ۱</span></>}
        aside={(
          <div className={GLASS_SOFT + " rounded-2xl p-4 space-y-2"}>
            <a href="/api/v1/openapi.json" className={BTN_G + " w-full h-10 text-sm"}><Icon name="download" size={15} />OpenAPI JSON</a>
            <a href="/panel/keys" className={BTN_G + " w-full h-10 text-sm"}><Icon name="key-round" size={15} />ساخت توکن</a>
          </div>
        )} />
    </>
  );
}
