/* «مشاور هزینه» (group "advisor"): the report, «اعمال» and «نادیده بگیر» on the caller's own findings, the weekly
   digest mute, and the staff card (src/server/advisor). The client never sends an action's arguments: apply takes the
   finding id, a confirm and, for costly or destructive actions, the typed resource name. */
import "server-only";
import { z } from "zod";
import { rateLimit } from "../auth";
import { adminStats, apply, brief, ignore, report, setMute } from "../advisor/service";
import { saveAdvisorSettings } from "../advisor/summary";
import { method, needStaff, needUser } from "../ctx";

const id = z.string().max(40);

export const advisorRpc = {
  /** refresh: recompute now (otherwise a report younger than ten minutes is served as is) */
  "advisor.report": method(z.tuple([z.boolean().optional()]), async (ctx, [refresh]) => {
    if (refresh) await rateLimit(ctx.db, "advisor-refresh:" + needUser(ctx).uid, 20, 3600);
    return report(ctx, !!refresh);
  }),
  "advisor.brief": method(z.tuple([]), async (ctx) => brief(ctx)),
  "advisor.apply": method(z.tuple([id, z.boolean(), z.string().max(120).optional()]), async (ctx, [findingId, confirm, typed]) => {
    await rateLimit(ctx.db, "advisor-apply:" + needUser(ctx).uid, 20, 600);
    return apply(ctx, findingId, confirm, typed ?? "");
  }),
  "advisor.ignore": method(z.tuple([id]), async (ctx, [findingId]) => ignore(ctx, findingId)),
  "advisor.setMute": method(z.tuple([z.boolean()]), async (ctx, [muted]) => setMute(ctx, muted)),

  "advisor.adminStats": method(z.tuple([]), async (ctx) => adminStats(ctx)),
  "advisor.adminSettings": method(z.tuple([z.object({ dailyCap: z.number().int().min(0).max(1_000_000_000).optional(), notifyMin: z.number().int().min(0).max(1_000_000_000).optional() })]), async (ctx, [patch]) => {
    needStaff(ctx, "settings");
    return saveAdvisorSettings(ctx.db, patch);
  }),
};
