import { expect, test, type Page } from "@playwright/test";

// every flow starts from the demo seed (the server runs with E2E=1)
test.beforeEach(async ({ request }) => { expect((await request.post("/api/test")).ok()).toBe(true); });

const login = async (page: Page, id = "demo@gereh.cloud") => {
  await page.goto("/auth");
  await page.getByLabel("ایمیل یا موبایل").fill(id);
  await page.getByLabel("رمز عبور", { exact: true }).fill("Demo1234!");
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
    await page.getByLabel("رمز عبور", { exact: true }).fill("Demo1234!");
    await page.getByRole("button", { name: "ورود", exact: true }).click();
    await expect(page).toHaveURL(/\/panel\/billing$/);
  });

  test("next= cannot redirect off-site", async ({ page }) => {
    await page.goto("/auth?next=//evil.example.com");
    await page.getByLabel("ایمیل یا موبایل").fill("demo@gereh.cloud");
    await page.getByLabel("رمز عبور", { exact: true }).fill("Demo1234!");
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
      "/panel/servers/srv-1042", "/panel/domains/dom-501", "/panel/hosting/hst-221", "/panel/tickets/TK-3021", "/panel/affiliate", "/panel/billing/INV-14031/print"]) {
      await page.goto(p);
      await expect(page.locator("main")).toBeVisible();
      await expect(page.locator("h1").first()).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test("logout ends the server session", async ({ page, context }) => {
    await page.getByRole("button", { name: "حساب" }).click();
    await page.getByRole("menuitem", { name: "خروج از حساب" }).click();
    await expect(page).toHaveURL(/\/$/);
    expect((await context.cookies()).find((c) => c.name === "gereh_sid")).toBeUndefined();
    await page.goto("/panel");
    await expect(page).toHaveURL(/\/auth/);
  });

  test("the session cookie is HttpOnly and SameSite=Lax", async ({ context }) => {
    const c = (await context.cookies()).find((x) => x.name === "gereh_sid")!;
    expect(c).toMatchObject({ httpOnly: true, sameSite: "Lax" });
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

test.describe("admin ↔ customer", () => {
  test("impersonation shows a banner and can be ended", async ({ page }) => {
    await login(page, "admin@gereh.cloud");
    await expect(page).toHaveURL(/\/admin$/);
    await page.getByRole("navigation", { name: "منوی مدیریت" }).getByRole("link", { name: "کاربران" }).click();
    await page.getByRole("cell", { name: /user2@mail\.ir/ }).click();
    await page.getByRole("button", { name: /ورود به‌جای کاربر/ }).click();
    await page.getByRole("dialog").getByRole("button").last().click();
    await expect(page).toHaveURL(/\/panel$/);
    const banner = page.getByRole("status").filter({ hasText: "در حال مشاهده پنل" });
    await expect(banner).toBeVisible();
    await banner.getByRole("button", { name: /پایان/ }).click();
    await expect(page).toHaveURL(/\/admin\/users$/);
  });

  test("a suspended server is read-only for the customer", async ({ page }) => {
    await login(page, "admin@gereh.cloud");
    await page.getByRole("navigation", { name: "منوی مدیریت" }).getByRole("link", { name: "سرویس‌ها" }).click();
    await page.getByRole("row", { name: /web-prod-1/ }).getByRole("button", { name: "اقدامات" }).click();
    await page.getByRole("menuitem", { name: "تعلیق" }).click();
    await page.getByRole("dialog").getByRole("button").last().click();
    await expect(page.getByRole("row", { name: /web-prod-1/ })).toContainText("معلق");

    // the suspension is stored server-side, so the customer sees it on their own login
    await page.context().clearCookies();
    await login(page);
    await expect(page).toHaveURL(/\/panel$/);
    await page.getByRole("navigation", { name: "منوی پنل" }).getByRole("link", { name: /سرورها/ }).click();
    await page.getByRole("row", { name: /web-prod-1/ }).click();
    await expect(page.getByText("این سرور معلق است")).toBeVisible();
    const tabs = page.getByRole("tablist", { name: "بخش‌های سرور" }).getByRole("tab");
    await expect(tabs).toHaveCount(3);
    await expect(page.getByRole("tab", { name: "نصب مجدد" })).toHaveCount(0);
  });
});

test("a discount code is applied in the cart and carried onto the invoice", async ({ page }) => {
  await login(page);
  await expect(page).toHaveURL(/\/panel$/);
  await page.goto("/vps");
  await page.getByRole("button", { name: /^افزودن .* به سبد$/ }).first().click();
  await page.getByRole("button", { name: /سبد خرید، ۱ مورد/ }).click();
  const drawer = page.getByRole("dialog", { name: "سبد خرید" });
  await drawer.getByLabel("کد تخفیف").fill("NOPE");
  await drawer.getByRole("button", { name: "اعمال" }).click();
  await expect(drawer.getByRole("alert")).toContainText("معتبر نیست");
  await drawer.getByLabel("کد تخفیف").fill("welcome");
  await drawer.getByRole("button", { name: "اعمال" }).click();
  await expect(drawer.getByText("تخفیف", { exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: /ثبت سفارش/ }).click();
  await expect(drawer).toContainText("سفارش ثبت شد");
});

test("online payment: bank page → callback → verified → invoice paid", async ({ page }) => {
  await login(page);
  await expect(page).toHaveURL(/\/panel$/);
  await page.goto("/panel/billing");
  await page.getByRole("row", { name: /INV-14058/ }).getByRole("button", { name: "پرداخت" }).click();
  const dialog = page.getByRole("dialog", { name: /پرداخت INV-14058/ });
  await dialog.getByRole("radio", { name: /درگاه/ }).click();
  await dialog.getByRole("button", { name: /^پرداخت/ }).click();
  await expect(page).toHaveURL(/\/pay\/sim\?/);
  await page.getByRole("link", { name: "پرداخت موفق" }).click();
  await expect(page).toHaveURL(/\/panel\/billing\?paid=1/);
  await expect(page.getByRole("status").filter({ hasText: "کد پیگیری" })).toBeVisible();
  await expect(page.getByRole("row", { name: /INV-14058/ })).toContainText("پرداخت‌شده");
});

test("cancelling at the bank leaves the invoice unpaid", async ({ page }) => {
  await login(page);
  await expect(page).toHaveURL(/\/panel$/);
  await page.goto("/panel/billing");
  await page.getByRole("row", { name: /INV-14058/ }).getByRole("button", { name: "پرداخت" }).click();
  const dialog = page.getByRole("dialog", { name: /پرداخت INV-14058/ });
  await dialog.getByRole("radio", { name: /درگاه/ }).click();
  await dialog.getByRole("button", { name: /^پرداخت/ }).click();
  await page.getByRole("link", { name: "انصراف" }).click();
  await expect(page).toHaveURL(/\/panel\/billing\?failed=1/);
  await expect(page.getByRole("row", { name: /INV-14058/ })).not.toContainText("پرداخت‌شده");
});

test("official invoice: buyer details → printable invoice", async ({ page }) => {
  await login(page);
  await expect(page).toHaveURL(/\/panel$/);
  await page.goto("/panel/billing");
  await page.getByRole("row", { name: /INV-14031/ }).click();
  await page.getByRole("button", { name: "درخواست فاکتور رسمی" }).click();
  const d = page.getByRole("dialog", { name: /فاکتور رسمی/ });
  await d.getByLabel("کد ملی / شناسه ملی شرکت").fill("0013542419");
  await d.getByLabel("کد پستی").fill("1234567890");
  await d.getByLabel("نشانی").fill("تهران، خیابان آزادی، پلاک ۱۰");
  const popup = page.waitForEvent("popup");
  await d.getByRole("button", { name: "ذخیره و چاپ" }).click();
  const p = await popup;
  await expect(p.getByRole("heading", { name: "صورتحساب فروش کالا و خدمات" })).toBeVisible();
  await expect(p.getByText("0013542419")).toBeVisible();
});

test("hosting + domain bundle adds both to the cart", async ({ page }) => {
  await page.goto("/hosting");
  await page.getByLabel("دامنه سایت (اختیاری)").fill("mybundle-site.ir");
  await page.getByRole("button", { name: /^افزودن نقره به سبد$/ }).first().click();
  await expect(page.getByRole("button", { name: /سبد خرید، ۲ مورد/ })).toBeVisible();
});

test("referral link opens registration with the code", async ({ page }) => {
  await page.goto("/auth?ref=NOVIN24");
  await expect(page.getByRole("heading", { name: "ساخت حساب گره" })).toBeVisible();
});

test("team: the owner sees the invite listed after sending it", async ({ page }) => {
  await login(page);
  await expect(page).toHaveURL(/\/panel$/);
  await page.goto("/panel/account");
  await page.getByRole("tab", { name: "تیم" }).click();
  await page.getByLabel("ایمیل").fill("colleague@example.com");
  await page.getByRole("button", { name: "ارسال دعوت" }).click();
  await expect(page.getByText("colleague@example.com")).toBeVisible();
});

test("public API: token-less requests get 401, openapi.json is public", async ({ request }) => {
  expect((await request.get("/api/v1/servers")).status()).toBe(401);
  const spec = await request.get("/api/v1/openapi.json");
  expect(spec.ok()).toBe(true);
  expect((await spec.json()).openapi).toBe("3.1.0");
});

test("knowledge base search filters articles", async ({ page }) => {
  await page.goto("/kb");
  await page.getByLabel("جستجو در راهنما").fill("UFW");
  await expect(page.getByRole("link", { name: /دیواره آتش UFW/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /فاکتور رسمی|کیف پول/ })).toHaveCount(0);
  await page.getByRole("link", { name: /دیواره آتش UFW/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/UFW/);
});

test("live chat: visitor asks, staff replies, visitor sees the answer", async ({ page, browser }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "گفتگو با پشتیبانی" }).click();
  const w = page.getByRole("dialog", { name: "گفتگو با پشتیبانی" });
  await w.getByLabel("نام").fill("مهمان تست");
  await w.getByLabel("پیام").fill("سلام، سرور من بالا نمی‌آید");
  await w.getByRole("button", { name: "شروع گفتگو" }).click();
  await expect(w.getByText("سلام، سرور من بالا نمی‌آید")).toBeVisible();

  const staff = await (await browser.newContext()).newPage();
  await login(staff, "admin@gereh.cloud");
  await expect(staff).toHaveURL(/\/admin$/);
  await staff.goto("/admin/chats");
  await staff.getByRole("button", { name: /مهمان تست/ }).click();
  await staff.getByLabel("پاسخ").fill("از کنسول VNC وارد شوید.");
  await staff.getByRole("button", { name: "ارسال", exact: true }).click();
  await expect(staff.getByText("از کنسول VNC وارد شوید.")).toBeVisible();

  await expect(w.getByText("از کنسول VNC وارد شوید.")).toBeVisible({ timeout: 10_000 });
});

test("admin reports: monthly table renders and the Excel export downloads", async ({ page }) => {
  await login(page, "admin@gereh.cloud");
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/reports");
  await expect(page.getByRole("region", { name: "جدول جزئیات ماهانه" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "خروجی اکسل" }).click();
  expect((await download).suggestedFilename()).toMatch(/^gereh-finance-\d{4}-\d{2}\.xlsx$/);
});

test("blog: staff publish a post and it appears publicly with RSS", async ({ page, request }) => {
  await login(page, "admin@gereh.cloud");
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/blog");
  await page.getByRole("button", { name: "نوشته جدید" }).click();
  await page.getByLabel("عنوان").fill("راهنمای آزمایشی بکاپ");
  await page.getByLabel("نشانی (slug)").fill("backup-guide-test");
  await page.getByLabel(/^خلاصه/).fill("این نوشته برای آزمون انتشار در بلاگ نوشته شده است و کمی طولانی است.");
  await page.getByLabel("برچسب‌ها").fill("پشتیبان‌گیری");
  await page.getByLabel("متن").fill("## چرا بکاپ\n\nبدون بکاپ هر خطا می‌تواند همه داده‌ها را از بین ببرد. " + "متن ".repeat(20));
  await page.getByRole("button", { name: "انتشار" }).click();
  await expect(page.getByText("نوشته منتشر شد").first()).toBeVisible();

  await page.goto("/blog/backup-guide-test");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("راهنمای آزمایشی بکاپ");
  await expect(page.getByRole("heading", { name: "چرا بکاپ" })).toBeVisible();
  const rss = await request.get("/blog/rss.xml");
  expect(await rss.text()).toContain("/blog/backup-guide-test");
});

test("unknown TLD and blog slugs are real 404s", async ({ request }) => {
  expect((await request.get("/domains/nope")).status()).toBe(404);
  expect((await request.get("/blog/does-not-exist")).status()).toBe(404);
});

test.describe("devops", () => {
  test("validation errors are shown, then a valid request gets a tracking number", async ({ page }) => {
    await page.goto("/devops/kubernetes");
    const form = page.getByRole("form", { name: "درخواست مشاوره دواپس" });
    await expect(form.getByRole("checkbox", { name: "کوبرنتیز و کانتینرسازی" })).toHaveAttribute("aria-checked", "true");
    await form.getByRole("button", { name: "ارسال درخواست" }).click();
    await expect(form.getByText("نام را وارد کنید.")).toBeVisible();
    await expect(form.getByText("حداقل یک گزینه را انتخاب کنید.")).toBeVisible();

    await form.getByLabel("نام و نام خانوادگی").fill("مهسا کریمی");
    await form.getByLabel("نام شرکت یا محصول").fill("فروشگاه نمونه");
    await form.getByLabel("ایمیل کاری").fill("mahsa@example.com");
    await form.getByLabel("شماره تماس").fill("09121234567");
    await form.getByRole("combobox", { name: "اندازه تیم" }).selectOption("۱۱ تا ۵۰ نفر");
    await form.getByRole("combobox", { name: "مرحله کسب‌وکار" }).selectOption("محصول عرضه‌شده");
    await form.getByRole("checkbox", { name: "گره" }).click();
    await form.getByRole("combobox", { name: "بودجه تقریبی" }).selectOption("۲۵ تا ۶۰ میلیون تومان در ماه");
    await form.getByRole("combobox", { name: "زمان شروع" }).selectOption("ظرف یک ماه");
    await form.getByLabel("وضعیت فعلی و هدفتان").fill("سه سرویس روی داکر داریم و می‌خواهیم به کوبرنتیز برویم.");
    await form.getByRole("checkbox", { name: /سیاست حریم خصوصی/ }).check();
    await form.getByRole("button", { name: "ارسال درخواست" }).click();
    await expect(page.getByRole("heading", { name: "درخواست شما ثبت شد" })).toBeVisible();
    await expect(page.getByText(/DO-\d+/)).toBeVisible();
  });

  test("staff see the lead in the pipeline; the demo customer sees their project", async ({ page }) => {
    await login(page, "admin@gereh.cloud");
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/admin/devops");
    await page.getByRole("button", { name: /پرداخت‌یار/ }).click();
    const drawer = page.getByRole("dialog", { name: /پرداخت‌یار/ });
    await expect(drawer.getByText("sina@pardakhtyar.example")).toBeVisible();
    await drawer.getByLabel("یادداشت").fill("تماس گرفتم؛ جلسه فردا");
    await drawer.getByRole("button", { name: "ثبت" }).click();
    await expect(drawer.getByText("تماس گرفتم؛ جلسه فردا")).toBeVisible();

    await page.context().clearCookies();
    await login(page);
    await expect(page).toHaveURL(/\/panel$/);
    await page.goto("/panel/devops");
    await expect(page.getByText("استقرار خودکار و نگه‌داری زیرساخت")).toBeVisible();
    await expect(page.getByText("پایپ‌لاین هر سه پروژه فعال شد", { exact: false })).toBeVisible();
  });
});
