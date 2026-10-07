import { NextResponse } from "next/server";
import { context, needStaff } from "@/server/ctx";
import { errorResponse, noStore } from "@/server/http";
import { financeReport, slaReport } from "@/server/reports";

/** GET /api/admin/reports?months=12&days=30 — finance by Jalali month + support SLA (staff with "reports") */
export async function GET(req: Request) {
  try {
    const ctx = await context();
    needStaff(ctx, "reports");
    const q = new URL(req.url).searchParams;
    const [finance, sla] = await Promise.all([financeReport(ctx.db, Number(q.get("months")) || 12), slaReport(ctx.db, Math.min(365, Math.max(1, Number(q.get("days")) || 30)))]);
    return NextResponse.json({ result: { finance, sla } }, { headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}
