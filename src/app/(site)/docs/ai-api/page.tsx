import Link from "next/link";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { ArticleView } from "@/components/site/article";
import { aiDocs } from "@/content/ai";
import { BTN_G, BTN_P, GLASS_SOFT } from "@/lib/cls";
import { breadcrumbLd, ORG_ID, pageMeta, SITE_URL } from "@/lib/seo";
import { publicAi } from "@/server/ai/public";

export const dynamic = "force-dynamic";
const TITLE = "مستندات API هوش مصنوعی";
const DESC = "راهنمای API هوش مصنوعی گره: اتصال Claude Code، Codex، Cursor و SDKهای OpenAI، Anthropic و Gemini، استریم، هزینه به تومان، محدودیت کلید و کدهای خطا.";
export const metadata = pageMeta({ title: TITLE, description: DESC, path: "/docs/ai-api" });

export default async function Page() {
  const { models, endpoint } = await publicAi();
  return (
    <>
      <JsonLd data={[breadcrumbLd([["API هوش مصنوعی", "/ai-api"], ["مستندات", "/docs/ai-api"]]), { "@type": "TechArticle", headline: TITLE, description: DESC, url: SITE_URL + "/docs/ai-api", inLanguage: "fa-IR", author: { "@id": ORG_ID }, publisher: { "@id": ORG_ID } }]} />
      <ArticleView crumbs={[["API هوش مصنوعی", "/ai-api"], ["مستندات", "/docs/ai-api"]]} title={TITLE} lead="یک آدرس، یک کلید، همه مدل‌ها؛ با فرمت OpenAI، Anthropic یا Gemini." body={aiDocs(endpoint, models)}
        meta={<><span className="flex items-center gap-1.5"><Icon name="code-xml" size={14} />OpenAI · Anthropic · Gemini</span><span className="flex items-center gap-1.5"><Icon name="zap" size={14} />استریم SSE</span></>}
        aside={(
          <div className={GLASS_SOFT + " rounded-2xl p-4 space-y-2"}>
            <Link href={"/panel/ai" as never} className={BTN_P + " w-full h-10 text-sm"}><Icon name="key-round" size={15} />دریافت کلید API</Link>
            <Link href={"/ai-api#pricing" as never} className={BTN_G + " w-full h-10 text-sm"}><Icon name="tag" size={15} />قیمت مدل‌ها</Link>
          </div>
        )} />
    </>
  );
}
