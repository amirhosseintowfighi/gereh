/* What a paid invoice turns into. New orders become provisioning jobs (worker); renewals extend
   the service immediately and lift a billing suspension. Runs inside the settling transaction. */
import "server-only";
import { eq } from "drizzle-orm";
import type { Sku } from "@/lib/catalog";
import { addMonths } from "@/lib/jalali";
import type { Tx } from "../db/client";
import { domains, hosting, servers } from "../db/schema";
import { enqueue } from "../jobs";
import { virt } from "../virt/driver";
import { addTask, logActivity } from "../util";

export type FulfilItem =
  | { type: "order"; sku: Sku }
  | { type: "renew"; kind: "server" | "hosting" | "domain"; id: string; months: number };

const later = (d: Date | null | undefined) => (d && d > new Date() ? d : new Date());

export async function fulfil(tx: Tx, userId: string, invoiceId: string, items: FulfilItem[]) {
  for (const [i, f] of items.entries()) {
    if (f.type === "order") {
      const type = f.sku.t === "plan" || f.sku.t === "custom" ? "provision.server" : f.sku.t === "hosting" ? "provision.hosting" : f.sku.t === "domain" ? "provision.domain" : "provision.ip";
      await enqueue(tx, type, { userId, invoiceId, index: i, sku: f.sku }, { dedupe: invoiceId + ":" + i });
      continue;
    }
    if (f.kind === "server") {
      const [s] = await tx.select().from(servers).where(eq(servers.id, f.id));
      if (!s) continue;
      await tx.update(servers).set({ paidUntil: addMonths(later(s.paidUntil), f.months), ...(s.status === "suspended" ? { status: "running" } : {}) }).where(eq(servers.id, s.id));
      if (s.status === "suspended" && s.vpsid) await (await virt()).unsuspend(s.vpsid);
      await addTask(tx, s.id, "تمدید " + f.months.toLocaleString("fa-IR") + " ماهه");
    } else if (f.kind === "hosting") {
      const [h] = await tx.select().from(hosting).where(eq(hosting.id, f.id));
      if (!h) continue;
      await tx.update(hosting).set({ expiresAt: addMonths(later(h.expiresAt), f.months), status: "active" }).where(eq(hosting.id, h.id));
    } else {
      const [d] = await tx.select().from(domains).where(eq(domains.id, f.id));
      if (!d) continue;
      // registrar renewal runs in the worker so a registry outage cannot roll back the payment
      await tx.update(domains).set({ expiresAt: addMonths(later(d.expiresAt), f.months), status: "active" }).where(eq(domains.id, d.id));
      await enqueue(tx, "provision.domain", { userId, invoiceId, renew: d.id, years: f.months / 12 }, { dedupe: invoiceId + ":renew:" + d.id });
    }
    await logActivity(tx, userId, "refresh-cw", "تمدید سرویس با " + invoiceId);
  }
}
