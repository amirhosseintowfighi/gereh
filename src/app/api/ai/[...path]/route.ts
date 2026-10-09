import { gateway } from "@/server/ai/gateway";
import { db } from "@/server/ctx";

/* AI API gateway; api.gereh.dev maps here (see src/server/ai/gateway.ts for the paths) */
export const dynamic = "force-dynamic";
export const maxDuration = 600;

async function handle(req: Request, { params }: RouteContext<"/api/ai/[...path]">) {
  return gateway(await db(), req, (await params).path.join("/"));
}
export { handle as GET, handle as POST };
