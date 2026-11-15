import { test } from "@playwright/test";

const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

/** The footer's Enamad seal is the one third-party request on the site. Answer it locally in every spec: where
    trustseal.enamad.ir is unreachable the image fails (a console error) or hangs (the page never reaches "load"). */
export function stubThirdParty() {
  test.beforeEach(async ({ page }) => {
    await page.route("https://trustseal.enamad.ir/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: PIXEL }));
  });
}
