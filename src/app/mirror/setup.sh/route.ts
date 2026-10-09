import { mirrorSetupScript } from "@/lib/mirror";
import { SITE_URL } from "@/lib/seo";

export const dynamic = "force-dynamic";

/** curl -fsSL https://gereh.net/mirror/setup.sh | sudo sh */
export function GET() {
  const base = process.env.MIRROR_URL || "https://mirror.gereh.net";
  return new Response(mirrorSetupScript(base, SITE_URL), { headers: { "content-type": "text/x-shellscript; charset=utf-8", "cache-control": "public, max-age=300" } });
}
