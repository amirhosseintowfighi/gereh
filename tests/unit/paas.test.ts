import { describe, expect, it } from "vitest";
import { appMonthly, detectStack, hourlyOf, PAAS_NAME_RE } from "@/lib/paas";

const files = (o: Record<string, string | null>) => new Map(Object.entries(o));

describe("detectStack", () => {
  it.each([
    [{ "package.json": JSON.stringify({ dependencies: { next: "16" } }) }, "nextjs"],
    [{ "package.json": JSON.stringify({ dependencies: { express: "5" } }) }, "node"],
    [{ "package.json": JSON.stringify({ devDependencies: { vite: "6" } }) }, "react"],
    [{ "package.json": JSON.stringify({ dependencies: { nuxt: "3" } }) }, "nuxt"],
    [{ "requirements.txt": "Django==5.1\ngunicorn", "manage.py": null }, "django"],
    [{ "requirements.txt": "fastapi\nuvicorn" }, "fastapi"],
    [{ "pyproject.toml": "[project]\ndependencies=['flask']" }, "flask"],
    [{ "composer.json": JSON.stringify({ require: { "laravel/framework": "^11" } }) }, "laravel"],
    [{ "composer.json": "{}" }, "php"],
    [{ "go.mod": null }, "go"],
    [{ "pom.xml": null }, "java"],
    [{ "src/App.csproj": null }, "dotnet"],
    [{ "Gemfile": null }, "ruby"],
    [{ "index.html": null }, "static"],
    [{ "Dockerfile": null, "package.json": "{}" }, "docker"],
    [{ "docker-compose.yml": null, "Dockerfile": null }, "compose"],
    [{ "README.md": null }, null],
  ])("%j → %s", (f, want) => expect(detectStack(files(f as Record<string, string | null>))).toBe(want));
  it("tolerates broken package.json", () => expect(detectStack(files({ "package.json": "{oops" }))).toBe("node"));
});

describe("names and prices", () => {
  it("app names are DNS labels", () => {
    expect(PAAS_NAME_RE.test("my-api")).toBe(true);
    for (const bad of ["ab", "-api", "api-", "My", "1api", "a".repeat(31), "a_b"]) expect(PAAS_NAME_RE.test(bad)).toBe(false);
  });
  it("hourly price rounds up", () => {
    expect(hourlyOf(720)).toBe(1);
    expect(hourlyOf(721)).toBe(2);
    expect(hourlyOf(0)).toBe(1);
    expect(appMonthly({ price: 100_000 }, 3, 10)).toBe(330_000);
  });
});
