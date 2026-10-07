import { describe, expect, it } from "vitest";
import { commonRoot, listZip, projectFiles, ZipError } from "@/server/unzip";
import { zip } from "@/server/xlsx";

describe("unzip", () => {
  it("lists entries, strips a single top folder and reads manifests", () => {
    const z = zip([["proj/package.json", Buffer.from('{"dependencies":{"next":"16"}}')], ["proj/app/page.tsx", Buffer.from("x")]]);
    expect(commonRoot(listZip(z))).toBe("proj/");
    const r = projectFiles(z, new Set(["package.json"]));
    expect([...r.files.keys()]).toEqual(["package.json", "app/page.tsx"]);
    expect(r.files.get("package.json")).toContain("next");
    expect(r.files.get("app/page.tsx")).toBeNull();
  });
  it("supports a root directory inside the archive", () => {
    const z = zip([["backend/requirements.txt", Buffer.from("fastapi")], ["frontend/package.json", Buffer.from("{}")]]);
    expect([...projectFiles(z, new Set(["requirements.txt"]), "backend").files.keys()]).toEqual(["requirements.txt"]);
  });
  it("rejects unsafe paths and garbage", () => {
    expect(() => listZip(zip([["../etc/passwd", Buffer.from("x")]]))).toThrow(ZipError);
    expect(() => listZip(zip([["/abs", Buffer.from("x")]]))).toThrow(ZipError);
    expect(() => listZip(Buffer.from("not a zip at all, not even close"))).toThrow(ZipError);
  });
});
