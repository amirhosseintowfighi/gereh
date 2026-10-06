import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PAGES = ["/", "/vps", "/hosting", "/domains", "/about", "/contact", "/terms", "/privacy", "/sla"];

/** fail the test on uncaught errors and console errors (hydration mismatches included) */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  return errors;
}

for (const path of PAGES) {
  test.describe(`page ${path}`, () => {
    test("renders with SEO essentials and no runtime errors", async ({ page }) => {
      const errors = watchErrors(page);
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.locator("html")).toHaveAttribute("lang", "fa");
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page).toHaveTitle(/گره/);

      const desc = await page.locator('meta[name="description"]').getAttribute("content");
      expect(desc?.length).toBeGreaterThan(50);
      const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
      expect(new URL(canonical!).pathname).toBe(path);
      await expect(page.locator('meta[property="og:image"]')).toHaveCount(1);
      await expect(page.locator('meta[name="robots"]')).not.toHaveAttribute("content", /noindex/);

      // every JSON-LD block must be valid JSON with a schema.org context
      for (const raw of await page.locator('script[type="application/ld+json"]').allTextContents()) {
        expect(JSON.parse(raw)["@context"]).toBe("https://schema.org");
      }

      await page.waitForLoadState("networkidle");
      expect(errors).toEqual([]);
    });

    test("has no horizontal overflow", async ({ page }) => {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test("passes axe accessibility checks (serious/critical)", async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
    });
  });
}

test("unknown routes return a real 404 with noindex", async ({ page }) => {
  const res = await page.goto("/this-page-does-not-exist");
  expect(res?.status()).toBe(404);
  await expect(page.locator("h1")).toContainText("پیدا نشد");
  const robots = await page.locator('meta[name="robots"]').evaluateAll((m) => m.map((x) => x.getAttribute("content")));
  expect(robots.length).toBeGreaterThan(0);
  for (const c of robots) expect(c).toContain("noindex");
});

test("robots.txt, sitemap.xml and manifest are served", async ({ request }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /panel");
  expect(robots).toContain("Disallow: /admin");
  expect(robots).toMatch(/Sitemap: https?:\/\/.+\/sitemap\.xml/);

  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const p of ["/vps", "/hosting", "/domains"]) expect(sitemap).toContain(p + "</loc>");
  expect(sitemap).not.toContain("/panel");

  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ lang: "fa", dir: "rtl" });
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);
});

test("static brand assets exist with correct types", async ({ request }) => {
  for (const [path, type] of [["/icon.svg", "image/svg+xml"], ["/og.png", "image/png"], ["/apple-icon.png", "image/png"], ["/icon-192.png", "image/png"]]) {
    const res = await request.get(path);
    expect(res.ok(), path).toBe(true);
    expect(res.headers()["content-type"]).toContain(type);
  }
});

test("security headers are set", async ({ request }) => {
  const h = (await request.get("/")).headers();
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("SAMEORIGIN");
  expect(h["strict-transport-security"]).toContain("max-age=");
  expect(h["x-powered-by"]).toBeUndefined();
});
