import { actor, context, needStaff } from "@/server/ctx";
import { errorResponse } from "@/server/http";
import { financeReport, financeSheets, jalaliYM, slaReport } from "@/server/reports";
import { logAudit } from "@/server/util";
import { xlsx } from "@/server/xlsx";

/** GET /api/admin/reports/export?months=12 — the same report as an Excel workbook */
export async function GET(req: Request) {
  try {
    const ctx = await context();
    needStaff(ctx, "reports");
    const months = Number(new URL(req.url).searchParams.get("months")) || 12;
    const [finance, sla] = await Promise.all([financeReport(ctx.db, months), slaReport(ctx.db, 30)]);
    const [y, m] = jalaliYM(new Date());
    await logAudit(ctx.db, actor(ctx), "خروجی اکسل گزارش مالی", months + " ماه", ctx.ip);
    const name = `gereh-finance-${y}-${String(m).padStart(2, "0")}.xlsx`;
    return new Response(new Uint8Array(xlsx(financeSheets(finance, sla))), {
      headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
