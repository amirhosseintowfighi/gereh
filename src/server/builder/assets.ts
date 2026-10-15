/* Front-end assets generated projects use (Tailwind's browser build and the Vazirmatn font), served by
   Gereh itself at /api/build/vendor/*: public CDNs are slow or filtered for many Iranian visitors, and
   the preview must work offline. The model is told to use the public URLs; they are rewritten here. */
import "server-only";

export const CDN = {
  tailwind: "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4",
  font: "https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css",
};

const TW = /https:\/\/(?:cdn\.jsdelivr\.net\/npm|unpkg\.com)\/@tailwindcss\/browser@4(?:\.\d+(?:\.\d+)?)?(?:\/dist\/index\.global(?:\.min)?\.js)?/g;
const FONT = /https:\/\/cdn\.jsdelivr\.net\/gh\/rastikerdar\/vazirmatn@[\w.-]+\/Vazirmatn-font-face\.css/g;

/** points the known CDN assets at Gereh's copies; base "" keeps them on the current origin */
export const localizeAssets = (html: string, base = "") =>
  html.replace(TW, base + "/api/build/vendor/tailwind.js").replace(FONT, base + "/api/build/vendor/vazirmatn.css");

/** the same rewrite for every HTML file of a snapshot */
export function localizeFiles(files: Record<string, string>, base: string) {
  const out: Record<string, string> = {};
  for (const [p, c] of Object.entries(files)) out[p] = /\.html?$/i.test(p) ? localizeAssets(c, base) : c;
  return out;
}
