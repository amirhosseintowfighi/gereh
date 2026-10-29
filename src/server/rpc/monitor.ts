/* «پایش هوشمند» (group "monitor"): the customer's incidents, feedback, mutes, sensitivity and channel thresholds, the
   one-click actions (incident id + action id + confirm; the server derives every argument), and the staff card and
   actions (src/server/monitor). */
import "server-only";
import { z } from "zod";
import { rateLimit } from "../auth";
import { method, needStaff, needUser } from "../ctx";
import { saveMonitorSettings } from "../monitor/explain";
import { act, adminIncidents, adminStats, badge, brief, feedback, muteIncident, report, setPrefs, setResource, staffAct } from "../monitor/service";

const id = z.string().max(40);
const kind = z.enum(["server", "app"]);
const sev = z.enum(["info", "warn", "critical", "off"]);
const ACTIONS = ["snapshot", "reboot", "start", "poweroff", "root_password", "firewall_preset", "scale_up"] as const;

export const monitorRpc = {
  "monitor.report": method(z.tuple([]), async (ctx) => report(ctx)),
  "monitor.brief": method(z.tuple([]), async (ctx) => brief(ctx)),
  "monitor.badge": method(z.tuple([kind, id]), async (ctx, [k, rid]) => badge(ctx, k, rid)),
  "monitor.feedback": method(z.tuple([id, z.enum(["false_positive", "useful"])]), async (ctx, [iid, f]) => feedback(ctx, iid, f)),
  /** hours: 0 unmutes */
  "monitor.mute": method(z.tuple([id, z.number().int().min(0).max(168)]), async (ctx, [iid, hours]) => muteIncident(ctx, iid, hours)),
  "monitor.setResource": method(z.tuple([kind, id, z.object({ sensitivity: z.enum(["low", "normal", "high"]).optional(), muteHours: z.number().int().min(0).max(168).optional() })]), async (ctx, [k, rid, patch]) => setResource(ctx, k, rid, patch)),
  "monitor.setPrefs": method(z.tuple([z.object({ panel: sev, email: z.enum(["warn", "critical", "off"]), channel: sev })]), async (ctx, [p]) => setPrefs(ctx, p)),
  "monitor.act": method(z.tuple([id, z.enum(ACTIONS), z.boolean(), z.string().max(120).optional()]), async (ctx, [iid, action, confirm, typed]) => {
    await rateLimit(ctx.db, "monitor-act:" + needUser(ctx).uid, 20, 600);
    return act(ctx, iid, action, confirm, typed ?? "");
  }),

  "monitor.adminIncidents": method(z.tuple([]), async (ctx) => adminIncidents(ctx)),
  "monitor.adminStats": method(z.tuple([]), async (ctx) => adminStats(ctx)),
  "monitor.staffAct": method(z.tuple([id, z.enum(["suspend", "contact"]), z.boolean(), z.string().max(4000).optional()]), async (ctx, [iid, action, confirm, text]) => staffAct(ctx, iid, action, confirm, text ?? "")),
  "monitor.adminSettings": method(z.tuple([z.object({ dailyCap: z.number().int().min(0).max(1_000_000_000).optional(), autoSuspendAbuse: z.boolean().optional() })]), async (ctx, [patch]) => {
    needStaff(ctx, "settings");
    return saveMonitorSettings(ctx.db, patch);
  }),
};
