import { inflateRawSync } from "node:zlib";
import { beforeEach, describe, expect, it } from "vitest";
import { category, financeReport, financeSheets, jalaliYM, monthStart, slaReport } from "@/server/reports";
import { xlsx } from "@/server/xlsx";
import { asAdmin, asUser, call, db, fresh, login } from "./helpers";

beforeEach(fresh);

/** read every entry of a ZIP back (local headers only, enough for our own writer) */
function unzip(buf: Buffer) {
  const out = new Map<string, string>();
  for (let o = 0; buf.readUInt32LE(o) === 0x04034b50;) {
    const size = buf.readUInt32LE(o + 18); const nlen = buf.readUInt16LE(o + 26); const xlen = buf.readUInt16LE(o + 28);
    const name = buf.subarray(o + 30, o + 30 + nlen).toString("utf8");
    const start = o + 30 + nlen + xlen;
    out.set(name, inflateRawSync(buf.subarray(start, start + size)).toString("utf8"));
    o = start + size;
  }
  return out;
}

describe("jalali month helpers", () => {
  it("round-trips month starts in Tehran time", () => {
    const s = monthStart(1405, 7);
    expect(jalaliYM(s)).toEqual([1405, 7]);
    expect(jalaliYM(new Date(s.getTime() - 1))).toEqual([1405, 6]);
    expect(jalaliYM(monthStart(1405, 13))).toEqual([1406, 1]);
    expect(jalaliYM(monthStart(1405, 0))).toEqual([1404, 12]);
  });
});

describe("finance report", () => {
  it("classifies invoice lines", () => {
    expect(category("هاست نقره، سالانه")).toBe("هاست");
    expect(category("ثبت دامنه novin.ir")).toBe("دامنه");
    expect(category("سرور ابری حرفه‌ای")).toBe("سرور");
    expect(category("کد تخفیف OFF20")).toBe("تخفیف");
  });

  it("a payment made now shows up in the current month with VAT split out", async () => {
    await asUser();
    const before = await financeReport(await db(), 3);
    await call("billing.pay", "INV-14058", "wallet");
    const after = await financeReport(await db(), 3);
    const cur = after.months[after.months.length - 1]; const prev = before.months[before.months.length - 1];
    expect(after.months).toHaveLength(3);
    expect(cur.invoices).toBe(prev.invoices + 1);
    expect(cur.gross - prev.gross).toBeGreaterThan(0);
    expect(cur.gross - cur.net).toBe(cur.vat);
    expect(after.totals.gross).toBe(after.months.reduce((s, m) => s + m.gross, 0));
    expect(after.outstanding.count).toBe(before.outstanding.count - 1);
    expect(after.topCustomers.some((c) => c.id === "u1")).toBe(true);
  });

  it("exports a valid workbook with RTL sheets", async () => {
    const r = await financeReport(await db(), 6);
    const files = unzip(xlsx(financeSheets(r, await slaReport(await db(), 30))));
    expect([...files.keys()]).toEqual(expect.arrayContaining(["[Content_Types].xml", "xl/workbook.xml", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet5.xml"]));
    expect(files.get("xl/workbook.xml")).toContain('name="خلاصه ماهانه"');
    expect(files.get("xl/worksheets/sheet1.xml")).toContain('rightToLeft="1"');
    expect((files.get("xl/worksheets/sheet1.xml")!.match(/<row /g) ?? []).length).toBe(6 + 2);
  });

  it("escapes markup and control characters in cells", () => {
    const files = unzip(xlsx([{ name: "a/b?", rows: [["<x>&\"", "bad\u0001char", 12.5]] }]));
    expect(files.get("xl/worksheets/sheet1.xml")).toContain("&lt;x&gt;&amp;&quot;");
    expect(files.get("xl/worksheets/sheet1.xml")).toContain("badchar");
    expect(files.get("xl/workbook.xml")).toContain('name="a b "');
  });
});

describe("SLA report", () => {
  it("credits the first human reply, ignoring the auto-reply", async () => {
    await asUser();
    const id = await call<string>("tickets.create", { subject: "سرور پاسخ نمی‌دهد", dept: "فنی", priority: "high", service: "", message: "سلام، سرور srv-1042 بالا نمی‌آید." });
    await asAdmin();
    await call("tickets.reply", id, "بررسی شد؛ مشکل برطرف است.", "staff");
    const r = await slaReport(await db(), 30);
    const me = r.agents.find((a) => a.firstResponses > 0 && a.agent !== "پاسخ خودکار گره");
    expect(me).toBeDefined();
    expect(me!.withinSla).toBeGreaterThan(0);
    expect(r.agents.some((a) => a.agent === "پاسخ خودکار گره")).toBe(false);
  });

  it("endpoints: customers get 403, staff get JSON and an xlsx download", async () => {
    const { GET: json } = await import("@/app/api/admin/reports/route");
    const { GET: excel } = await import("@/app/api/admin/reports/export/route");
    await asUser();
    expect((await json(new Request("http://x/api/admin/reports"))).status).toBe(403);
    expect((await excel(new Request("http://x/api/admin/reports/export"))).status).toBe(403);
    await login("shima@gereh.net"); // finance role
    const r = await json(new Request("http://x/api/admin/reports?months=6"));
    expect(r.status).toBe(200);
    expect((await r.json()).result.finance.months).toHaveLength(6);
    const x = await excel(new Request("http://x/api/admin/reports/export?months=6"));
    expect(x.headers.get("content-type")).toContain("spreadsheetml");
    expect(Buffer.from(await x.arrayBuffer()).readUInt32LE(0)).toBe(0x04034b50);
    await login("kaveh@gereh.net"); // support role: no reports
    expect((await json(new Request("http://x/api/admin/reports"))).status).toBe(403);
  });
});
