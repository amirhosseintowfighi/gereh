/* «پرسش از دیتابیس» (group "dbquery"): schema and history of a database, a question turned into a query (not run),
   running the shown or edited query read-only, «تحلیل نتیجه» with explicit consent, the sample-values switch and saved
   queries (src/server/dbquery). Team roles: admin and tech (ctx.ts); custom roles also need database view access. */
import "server-only";
import { z } from "zod";
import { DBQ_LIMITS } from "@/lib/dbquery";
import { method } from "../ctx";
import { analyze, ask, overview, removeHistory, run, saveHistory, setSamples } from "../dbquery/service";

const id = z.string().max(40);
const database = z.string().max(64).default("");

export const dbqueryRpc = {
  "dbquery.overview": method(z.tuple([id, z.string().max(64).optional()]), async (ctx, [dbId, db]) => overview(ctx, dbId, db)),
  "dbquery.ask": method(z.tuple([id, z.object({ database, question: z.string().max(DBQ_LIMITS.questionChars) })]), async (ctx, [dbId, i]) => ask(ctx, dbId, i)),
  "dbquery.run": method(z.tuple([id, z.object({ database, query: z.string().max(DBQ_LIMITS.queryChars), historyId: id.optional() })]), async (ctx, [dbId, i]) => run(ctx, dbId, i)),
  "dbquery.analyze": method(z.tuple([id, z.boolean()]), async (ctx, [historyId, consent]) => analyze(ctx, historyId, consent)),
  "dbquery.setSamples": method(z.tuple([id, z.boolean()]), async (ctx, [dbId, on]) => setSamples(ctx, dbId, on)),
  "dbquery.save": method(z.tuple([id, z.boolean(), z.string().max(80).default("")]), async (ctx, [historyId, saved, title]) => saveHistory(ctx, historyId, saved, title)),
  "dbquery.remove": method(z.tuple([id]), async (ctx, [historyId]) => removeHistory(ctx, historyId)),
};
