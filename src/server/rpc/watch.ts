/* «پایش پیشرفته» (group "watch"): the customer's watched services, turning a plan on or changing its mode, renewal,
   options, the on-demand check and the history; the admin's pricing and figures (src/server/watch). */
import "server-only";
import { z } from "zod";
import { rateLimit } from "../auth";
import { method, needStaff, needUser } from "../ctx";
import { watchAdmin, watchCheckNow, watchEnable, watchHistory, watchOptions, watchRenew, watchReport } from "../watch/service";
import { saveWatchSettings, WATCH_SETTINGS } from "../watch/settings";

const id = z.string().max(40);
const kind = z.enum(["server", "app"]);
const mode = z.enum(["every3h", "continuous"]);

export const watchRpc = {
  "watch.report": method(z.tuple([]), async (ctx) => watchReport(ctx)),
  "watch.history": method(z.tuple([kind, id]), async (ctx, [k, rid]) => watchHistory(ctx, k, rid)),
  "watch.enable": method(z.tuple([kind, id, mode]), async (ctx, [k, rid, m]) => {
    await rateLimit(ctx.db, "watch-enable:" + needUser(ctx).uid, 30, 3600);
    return watchEnable(ctx, k, rid, m);
  }),
  "watch.renew": method(z.tuple([kind, id, z.boolean()]), async (ctx, [k, rid, on]) => watchRenew(ctx, k, rid, on)),
  "watch.options": method(z.tuple([kind, id, z.object({ autoFix: z.boolean().optional(), uptimeUrl: z.string().trim().max(300).optional() })]), async (ctx, [k, rid, o]) => watchOptions(ctx, k, rid, o)),
  "watch.checkNow": method(z.tuple([kind, id]), async (ctx, [k, rid]) => {
    await rateLimit(ctx.db, "watch-check:" + needUser(ctx).uid, 20, 3600);
    return watchCheckNow(ctx, k, rid);
  }),

  "watch.admin": method(z.tuple([]), async (ctx) => { needStaff(ctx, "settings"); return watchAdmin(ctx.db); }),
  "watch.adminSettings": method(z.tuple([WATCH_SETTINGS.partial()]), async (ctx, [patch]) => {
    needStaff(ctx, "settings");
    await saveWatchSettings(ctx.db, patch);
    return watchAdmin(ctx.db);
  }),
};
