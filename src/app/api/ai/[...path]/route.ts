import { gateway } from "@/server/ai/gateway";
import { db } from "@/server/ctx";

/* AI API gateway; api.gereh.dev maps here (see src/server/ai/gateway.ts for the paths) */
export const dynamic = "force-dynamic";
export const maxDuration = 600;

async function handle(req: Request, { params }: RouteContext<"/api/ai/[...path]">) {
  const path = (await params).path.join("/");
  // clients configured with the bare host (https://api.gereh.dev) call /chat/completions: treat it as /v1/...
  return gateway(await db(), req, /^v1(beta)?\//.test(path) ? path : "v1/" + path);
}
export { handle as GET, handle as POST };
