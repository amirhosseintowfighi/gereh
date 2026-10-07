import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: { alias: { "@": src } },
  test: {
    restoreMocks: true,
    projects: [
      { extends: true, test: { name: "unit", environment: "happy-dom", include: ["tests/unit/**/*.test.ts"] } },
      {
        extends: true,
        // the server suite runs against an in-memory PGlite database per file
        resolve: { alias: { "server-only": fileURLToPath(new URL("./tests/server/empty.ts", import.meta.url)) } },
        test: { name: "server", environment: "node", include: ["tests/server/**/*.test.ts"], setupFiles: ["tests/server/setup.ts"], testTimeout: 30_000, hookTimeout: 60_000 },
      },
    ],
    coverage: { provider: "v8", include: ["src/lib/**", "src/server/**"], exclude: ["src/lib/cls.ts"], reporter: ["text", "html"] },
  },
});
