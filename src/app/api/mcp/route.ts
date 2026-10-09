import { db } from "@/server/ctx";
import { mcpHttp } from "@/server/mcp";

export const dynamic = "force-dynamic";

async function handle(req: Request) {
  return mcpHttp({ db: await db(), ip: req.headers.get("x-real-ip") || "", device: "MCP" }, req);
}

export { handle as GET, handle as POST, handle as DELETE };
