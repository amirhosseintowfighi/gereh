import { describe, expect, it } from "vitest";
import { dirOf } from "@/lib/site-language";
import { parseOutput } from "@/server/builder/format";
import { checkFiles } from "@/server/builder/quality";
import { projectFiles, simulate } from "@/server/builder/sim";

const h1 = (html: string) => /<h1[^>]*>([^<]+)<\/h1>/.exec(html)?.[1] ?? "";
const h2s = (html: string) => [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map((m) => m[1]);

describe("بافت simulator: site copy in the site's language", () => {
  it("a German request yields German headings with lang=de", () => {
    const html = projectFiles("Build a website in German for a hair salon", "static", "de")["index.html"];
    expect(html).toContain('<html lang="de" dir="ltr">');
    expect(h1(html)).toBe("Schönes Haar, genau dann, wenn es Ihnen passt");
    expect(h2s(html)).toEqual(expect.arrayContaining(["Leistungen und Preise", "Warum Salon Rosé?", "Termin buchen", "Das sagen unsere Kunden"]));
    expect(html).toContain("Vor- und Nachname");
    expect(html).toContain("65 €");
    expect(html).toContain("60 Min.");
    expect(html).not.toMatch(/Services and prices|Book an appointment|What our customers say/);
    expect(html).not.toContain("Vazirmatn");
  });

  it("an Arabic request yields Arabic copy with dir=rtl and the Arabic-script font", () => {
    const files = projectFiles("موقع لمطعم", "node", "ar");
    const html = files["public/index.html"];
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(h1(html)).toBe("مطبخ فارسي منزلي، طازج كل يوم");
    expect(h2s(html)).toEqual(expect.arrayContaining(["قائمة اليوم", "احجز طاولتك", "ماذا يقول عملاؤنا"]));
    expect(html).toContain("Vazirmatn");
    expect(html).toContain("«");
    expect(files["server.js"]).toContain("يرجى تعبئة جميع الحقول المطلوبة.");
    expect(files["public/app.js"]).toContain('" دولار"');
  });

  it("Turkish, French and Spanish have their own copy, currency and quotes; other languages fall back to English", () => {
    const tr = projectFiles("kuaför sitesi", "static", "tr")["index.html"];
    expect(h2s(tr)).toContain("Hizmetler ve fiyatlar");
    expect(tr).toMatch(/2[.,]275 ₺|2[.,]280 ₺/);
    const fr = projectFiles("site pour un café", "static", "fr")["index.html"];
    expect(h1(fr)).toBe("Du bon café, des matins sans hâte");
    expect(fr).toContain("« ");
    const es = projectFiles("tienda de ropa", "static", "es")["index.html"];
    expect(h2s(es)).toContain("Lo más vendido");
    expect(es).toContain("Añadir al carrito");
    const it = projectFiles("un sito per il mio studio", "static", "it")["index.html"];
    expect(it).toContain('<html lang="it" dir="ltr">');
    expect(h2s(it)).toContain("What we do");
  });

  it("every kind passes the static checks in every language with copy", () => {
    for (const lang of ["de", "ar", "tr", "fr", "es"]) {
      for (const prompt of ["salon", "shop", "restaurant", "café", "conference", "consulting"]) {
        for (const stack of ["static", "node"] as const) {
          const r = checkFiles(projectFiles(prompt, stack, lang), stack, { lang, dir: dirOf(lang) });
          expect(r.findings.filter((f) => f.severity === "error"), lang + "/" + stack + "/" + prompt).toEqual([]);
        }
      }
    }
  });

  it("edits add sections in the site's language and summarise in the chat language", () => {
    const files = projectFiles("salon", "static", "de");
    const out = parseOutput(simulate("static", { kind: "edit", prompt: "بخش سؤالات متداول اضافه کن", files, history: [], lang: "de", reply: "fa" }));
    expect(out.files["index.html"]).toContain("Häufige Fragen");
    expect(out.summary).toMatch(/[آ-ی]/);
  });

  it("fix and maintain summaries follow the customer's chat language: Persian for Persian, otherwise English", () => {
    const files = projectFiles("restaurant", "node", "de");
    const broken = { ...files, "package.json": "{ not json" };
    const fa = parseOutput(simulate("node", { kind: "fix", files: broken, log: "npm ERR! JSON.parse", failure: "build", explain: "", lang: "de", reply: "fa" }));
    expect(fa.summary).toMatch(/^علت خطا/);
    const en = parseOutput(simulate("node", { kind: "fix", files: broken, log: "npm ERR! JSON.parse", failure: "build", explain: "", lang: "de", reply: "de" }));
    expect(en.summary).toMatch(/^Cause: package\.json was broken/);
    expect(en.plan).toContain("- fix:");
    const okFa = parseOutput(simulate("node", { kind: "maintain", files, incident: "manual", events: "", logs: "", lang: "de", reply: "fa" }));
    expect(okFa.summary).toMatch(/^وضعیت: سالم/);
    const okEn = parseOutput(simulate("node", { kind: "maintain", files, incident: "manual", events: "", logs: "", lang: "ar", reply: "ar" }));
    expect(okEn.summary).toMatch(/^Status: healthy/);
    const oom = parseOutput(simulate("static", { kind: "maintain", files: projectFiles("x", "static", "en"), incident: "oom", events: "", logs: "", lang: "en", reply: "en" }));
    expect(oom.summary).toMatch(/^Likely cause:/);
    expect(oom.summary).toContain("Impact:");
  });
});
