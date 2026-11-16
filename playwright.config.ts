import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT || 3100);
// Runs against the production build (`npm run build` first). CHROMIUM_PATH lets CI or a
// sandbox point at a preinstalled browser instead of `playwright install`.
const executablePath = process.env.CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "tests/e2e",
  // one server, one in-memory database: tests that change data reset it first, so they run one at a time
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "fa-IR",
    trace: "retain-on-failure",
    launchOptions: { executablePath },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } } },
    { name: "mobile", use: { ...devices["Pixel 7"], launchOptions: { executablePath } }, testMatch: /(public|mobile)\.spec\.ts/ },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    // E2E=1 enables POST /api/test (reset) and GET /api/test (outbox); demo seed + payment simulator
    // `next start` is a production server, which refuses to seal secrets without APP_SECRET: a fixed test-only value
    env: { E2E: "1", SEED_DEMO: "1", PAY_SIMULATOR: "1", APP_SECRET: process.env.APP_SECRET || "e2e-only-secret-0123456789abcdef0123456789" },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
