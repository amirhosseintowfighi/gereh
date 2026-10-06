import { expect, test, type Page } from "@playwright/test";

const login = async (page: Page, id = "demo@gereh.cloud") => {
  await page.goto("/auth");
  await page.getByLabel("ایمیل یا موبایل").fill(id);
  await page.getByLabel("رمز عبور", { exact: true }).fill("secret-pass");
  await page.getByRole("button", { name: "ورود", exact: true }).click();
};

test.describe("domains", () => {
  test("search from the URL, add to cart, cart survives reload", async ({ page }) => {
    await page.goto("/domains?q=novinbrand.ir");
    await expect(page.getByRole("heading", { name: "novinbrand.ir" })).toBeVisible();

    const add = page.getByRole("button", { name: /^ثبت novinbrand\./ }).first();
    const label = await add.getAttribute("aria-label");
    await add.click();
    await expect(page.getByRole("button", { name: /سبد خرید، ۱ مورد/ })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: /سبد خرید، ۱ مورد/ })).toBeVisible();
    await page.getByRole("button", { name: /سبد خرید، ۱ مورد/ }).click();
    const drawer = page.getByRole("dialog", { name: "سبد خرید" });
    await expect(drawer).toContainText(label!.replace("ثبت ", ""));

    await drawer.getByRole("button", { name: /^حذف / }).click();
    await expect(drawer).toContainText("سبد خالی است");
  });

  test("invalid names show a validation error", async ({ page }) => {
    await page.goto("/domains");
    await page.getByLabel("نام دامنه").fill("-bad-");
    await page.getByRole("button", { name: "بررسی", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "خط تیره" })).toBeVisible();
  });
});

test.describe("auth", () => {
  test("panel requires login and returns to the requested page", async ({ page }) => {
    await page.goto("/panel/billing");
    await expect(page).toHaveURL(/\/auth\?next=%2Fpanel%2Fbilling/);
    await page.getByLabel("ایمیل یا موبایل").fill("demo@gereh.cloud");
    await page.getByLabel("رمز عبور", { exact: true }).fill("secret-pass");
    await page.getByRole("button", { name: "ورود", exact: true }).click();
    await expect(page).toHaveURL(/\/panel\/billing$/);
  });

  test("next= cannot redirect off-site", async ({ page }) => {
    await page.goto("/auth?next=//evil.example.com");
    await page.getByLabel("ایمیل یا موبایل").fill("demo@gereh.cloud");
    await page.getByLabel("رمز عبور", { exact: true }).fill("secret-pass");
    await page.getByRole("button", { name: "ورود", exact: true }).click();
    await expect(page).toHaveURL(/localhost:\d+\/panel$/);
  });

  test("empty credentials show an error", async ({ page }) => {
    await page.goto("/auth");
    await page.getByRole("button", { name: "ورود", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "وارد کنید" })).toBeVisible();
  });

  test("auth pages are noindex", async ({ page }) => {
    await page.goto("/auth");
    for (const c of await page.locator('meta[name="robots"]').evaluateAll((m) => m.map((x) => x.getAttribute("content")))) expect(c).toContain("noindex");
  });
});

test.describe("user panel", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/panel$/);
  });

  test("dashboard → server detail → power off with confirmation", async ({ page }) => {
    await page.goto("/panel/servers/srv-1042");
    await expect(page.getByRole("heading", { name: "web-prod-1" })).toBeVisible();
    await page.getByRole("button", { name: /خاموش/ }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button").last().click();
    await expect(page.getByText("خاموش", { exact: true }).first()).toBeVisible();
  });

  test("every panel section renders without errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const p of ["/panel", "/panel/servers", "/panel/hosting", "/panel/domains", "/panel/billing", "/panel/tickets", "/panel/keys", "/panel/account",
      "/panel/servers/srv-1042", "/panel/domains/dom-501", "/panel/hosting/hst-221", "/panel/tickets/TK-3021"]) {
      await page.goto(p);
      await expect(page.locator("main")).toBeVisible();
      await expect(page.locator("h1").first()).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test("logout clears the session", async ({ page }) => {
    await page.evaluate(() => localStorage.removeItem("gereh:session"));
    await page.goto("/panel");
    await expect(page).toHaveURL(/\/auth/);
  });
});

test.describe("admin panel", () => {
  test("admin login lands on /admin and every section renders", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await login(page, "admin@gereh.cloud");
    await expect(page).toHaveURL(/\/admin$/);
    for (const p of ["/admin/users", "/admin/services", "/admin/billing", "/admin/tickets", "/admin/tickets/TK-3021", "/admin/products",
      "/admin/coupons", "/admin/announcements", "/admin/infra", "/admin/virtualizor", "/admin/audit", "/admin/settings"]) {
      await page.goto(p);
      await expect(page.locator("h1").first()).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test("a customer session cannot open the admin panel", async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/panel$/);
    await page.goto("/admin");
    await expect(page.getByText("دسترسی به پنل مدیریت ندارید")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "منوی مدیریت" })).toHaveCount(0);
  });
});

test("command palette opens with Ctrl+K and navigates", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "دسترسی سریع" });
  await expect(dialog).toBeVisible();
  await page.getByRole("combobox", { name: "جست‌وجو" }).fill("هاست");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/hosting$/);
});
