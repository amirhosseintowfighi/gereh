import { expect, test } from "@playwright/test";

test("mobile menu opens, navigates and closes on route change", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile only");
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "منو" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.locator("#mobile-nav").getByRole("link", { name: "سرور ابری" }).click();
  await expect(page).toHaveURL(/\/vps$/);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});
