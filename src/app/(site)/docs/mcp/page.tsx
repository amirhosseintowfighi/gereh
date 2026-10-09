import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { ArticleView } from "@/components/site/article";
import { mcpDocs } from "@/content/mcp";
import { BTN_G, BTN_P, GLASS_SOFT } from "@/lib/cls";
import { breadcrumbLd, ORG_ID, pageMeta, SITE_URL } from "@/lib/seo";
import { MCP_TOOLS } from "@/server/mcp";

const TITLE = "اتصال ایجنت‌های هوش مصنوعی به گره (MCP)";
const DESC = "سرور MCP گره برای Claude Code، Cursor، Codex و VS Code: دیپلوی، لاگ، متغیرهای محیطی، سرورها و DNS را با زبان طبیعی مدیریت کنید.";
export const metadata = pageMeta({ title: TITLE, description: DESC, path: "/docs/mcp" });

export default function Page() {
  return (
    <>
      <JsonLd data={[breadcrumbLd([["مستندات API", "/docs/api"], ["MCP", "/docs/mcp"]]), { "@type": "TechArticle", headline: TITLE, description: DESC, url: SITE_URL + "/docs/mcp", inLanguage: "fa-IR", author: { "@id": ORG_ID }, publisher: { "@id": ORG_ID } }]} />
      <ArticleView crumbs={[["مستندات API", "/docs/api"], ["MCP", "/docs/mcp"]]} title={TITLE} lead="ایجنت برنامه‌نویسی شما، حالا اپراتور زیرساخت هم هست." body={mcpDocs(SITE_URL, MCP_TOOLS)}
        meta={<><span className="flex items-center gap-1.5"><Icon name="bot" size={14} />Model Context Protocol</span><span className="flex items-center gap-1.5"><Icon name="plug" size={14} />Streamable HTTP</span></>}
        aside={(
          <div className={GLASS_SOFT + " rounded-2xl p-4 space-y-2"}>
            <a href="/panel/keys" className={BTN_P + " w-full h-10 text-sm"}><Icon name="key-round" size={15} />ساخت توکن</a>
            <a href="/docs/api" className={BTN_G + " w-full h-10 text-sm"}><Icon name="code-xml" size={15} />API عمومی</a>
          </div>
        )} />
    </>
  );
}
