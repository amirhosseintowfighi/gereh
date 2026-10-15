import { readFile } from "node:fs/promises";
import path from "node:path";

/* GET /api/build/vendor/<file> — Tailwind's browser build and the Vazirmatn font for pages made with the
   AI builder (previews and deployed apps on the apps domain, hence CORS for the font files). */
const pub = (...p: string[]) => path.join(/* turbopackIgnore: true */ process.cwd(), "public", ...p);
const RANGES: Record<string, string> = {
  arabic: "U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC",
  "latin-ext": "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
  latin: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
};
const FONT_CSS = Object.entries(RANGES).map(([k, r]) => `@font-face { font-family: "Vazirmatn"; font-style: normal; font-weight: 100 900; font-display: swap; src: url("vazirmatn-${k}.woff2") format("woff2"); unicode-range: ${r}; }`).join("\n") + "\n";
const HEADERS = { "access-control-allow-origin": "*", "cross-origin-resource-policy": "cross-origin", "cache-control": "public, max-age=604800" };

export async function GET(_req: Request, { params }: RouteContext<"/api/build/vendor/[file]">) {
  const { file } = await params;
  if (file === "vazirmatn.css") return new Response(FONT_CSS, { headers: { ...HEADERS, "content-type": "text/css; charset=utf-8" } });
  const font = /^vazirmatn-(arabic|latin-ext|latin)\.woff2$/.exec(file);
  const src = file === "tailwind.js" ? pub("vendor", "tailwind-browser-4.1.18.js") : font ? pub("fonts", "vazirmatn-" + font[1] + ".v5-3.woff2") : null;
  if (!src) return new Response("not found", { status: 404 });
  const body = await readFile(src).catch(() => null);
  if (!body) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(body), { headers: { ...HEADERS, "content-type": font ? "font/woff2" : "text/javascript; charset=utf-8" } });
}
