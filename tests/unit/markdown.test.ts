import { describe, expect, it } from "vitest";
import { headings, parse, plain, safeHref } from "@/lib/markdown";

describe("markdown", () => {
  it("parses headings, lists, code, quotes and tables", () => {
    const b = parse("# T\n\n## Sub\ntext line one\nline two\n\n- a\n- b\n\n1. x\n2. y\n\n> note\n\n```bash\nls -la\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n");
    expect(b.map((x) => x.t)).toEqual(["h", "h", "p", "ul", "ol", "quote", "code", "table"]);
    expect(b[2]).toEqual({ t: "p", text: "text line one line two" });
    expect(b[6]).toEqual({ t: "code", lang: "bash", code: "ls -la" });
    expect(b[7]).toEqual({ t: "table", head: ["A", "B"], rows: [["1", "2"]] });
  });
  it("keeps an unterminated fence as code to the end", () => {
    expect(parse("```\nrm -rf /")).toEqual([{ t: "code", lang: "", code: "rm -rf /" }]);
  });
  it("collects h2/h3 headings for a table of contents", () => {
    expect(headings("# Title\n## One **bold**\n### Two\n")).toEqual([{ id: "s2", level: 2, text: "One bold" }, { id: "s3", level: 3, text: "Two" }]);
  });
  it("only allows safe link targets", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("//evil.example")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(safeHref("/kb/ssh")).toBe("/kb/ssh");
    expect(safeHref("https://gereh.net")).toBe("https://gereh.net");
    expect(safeHref("#s2")).toBe("#s2");
  });
  it("plain() strips inline markup", () => {
    expect(plain("**a** `b` [c](/d)")).toBe("a b c");
  });
});
