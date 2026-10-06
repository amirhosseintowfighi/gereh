import { describe, expect, it } from "vitest";
import { SITE_URL, breadcrumbLd, faqLd, offerLd, pageMeta } from "@/lib/seo";
import { safeNext } from "@/lib/url";

describe("safeNext", () => {
  it.each(["/panel", "/panel/billing?tab=wallet", "/admin/tickets/TK-3021", "/a#b"])("allows %s", (p) => {
    expect(safeNext(p)).toBe(p);
  });

  it.each([null, "", "panel", "//evil.com", "/\\evil.com", "https://evil.com", "javascript:alert(1)", "/ok<script>", "/\nfoo"])("blocks %j", (p) => {
    expect(safeNext(p)).toBeNull();
  });
});

describe("seo helpers", () => {
  it("pageMeta sets canonical, OG and Twitter", () => {
    const m = pageMeta({ title: "T", description: "D", path: "/vps" });
    expect(m.alternates?.canonical).toBe("/vps");
    expect(m.openGraph).toMatchObject({ title: "T", url: "/vps", locale: "fa_IR" });
    expect(m.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("breadcrumbs start at home with absolute URLs", () => {
    const b = breadcrumbLd([["سرور ابری", "/vps"]]);
    expect(b.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "خانه", item: SITE_URL + "/" },
      { "@type": "ListItem", position: 2, name: "سرور ابری", item: SITE_URL + "/vps" },
    ]);
  });

  it("faqLd maps question/answer pairs", () => {
    const f = faqLd([["Q?", "A."]]);
    expect(f.mainEntity[0]).toEqual({ "@type": "Question", name: "Q?", acceptedAnswer: { "@type": "Answer", text: "A." } });
  });

  it("offerLd converts toman to IRR", () => {
    const o = offerLd("VPS", "d", [390000, 2390000], "/vps");
    expect(o.offers).toMatchObject({ priceCurrency: "IRR", lowPrice: 3_900_000, highPrice: 23_900_000, offerCount: 2 });
  });
});
