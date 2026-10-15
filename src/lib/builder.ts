/* The AI app builder: a customer describes an idea in Persian, the AI writes the files, the panel
   previews them and one click deploys them as a Gereh app. Shared by the server, the panel and the site.
   The product name is not final: every label comes from BUILDER, so renaming is a one-line change. */

export const BUILDER = {
  name: "بافت",
  slug: "baft",
  tagline: "از ایده تا محصول در حال اجرا، با AI",
  short: "سازنده هوشمند اپ",
} as const;

/** the model a new project uses; any active chat model can be chosen per project */
export const BUILDER_DEFAULT_MODEL = "claude-opus-5.5";

export type BuilderStack = "static" | "node";
export const BUILDER_STACKS: { id: BuilderStack; label: string; hint: string; icon: string }[] = [
  { id: "static", label: "سایت", hint: "HTML و Tailwind؛ سریع و ارزان", icon: "layers" },
  { id: "node", label: "اپ با سرور", hint: "Express با پایگاه داده برای ذخیره اطلاعات", icon: "server" },
];

export const BUILDER_IDEAS: { label: string; icon: string; prompt: string }[] = [
  { label: "سایت نوبت‌دهی آرایشگاه", icon: "calendar-clock", prompt: "یک سایت نوبت‌دهی برای سالن آرایش با معرفی خدمات، قیمت‌ها و فرم رزرو آنلاین نوبت" },
  { label: "فروشگاه ساده لباس", icon: "shopping-cart", prompt: "یک فروشگاه ساده لباس با فهرست محصولات، قیمت به تومان، سبد خرید و صفحه تماس" },
  { label: "لندینگ معرفی رستوران", icon: "store", prompt: "یک صفحه معرفی رستوران با منوی غذا، ساعت کاری، نقشه و دکمه رزرو میز" },
  { label: "فرم ثبت‌نام رویداد", icon: "users", prompt: "یک صفحه ثبت‌نام رویداد با معرفی سخنران‌ها، برنامه زمانی و فرم ثبت‌نام که اطلاعات را ذخیره کند" },
];

export const RUN_KIND: Record<"generate" | "edit" | "fix" | "maintain", { label: string; icon: string }> = {
  generate: { label: "ساخت", icon: "sparkles" },
  edit: { label: "ویرایش", icon: "pencil" },
  fix: { label: "رفع خودکار خطا", icon: "hammer" },
  maintain: { label: "نگهداری", icon: "heart-pulse" },
};
export const PROJECT_STATUS: Record<string, [string, "green" | "amber" | "red" | "gray" | "blue"]> = {
  draft: ["پیش‌نویس", "gray"], generating: ["در حال ساخت", "blue"], ready: ["آماده انتشار", "amber"], deploying: ["در حال انتشار", "blue"],
  fixing: ["در حال رفع خطا", "amber"], live: ["منتشر شده", "green"], failed: ["انتشار ناموفق", "red"],
};

/* ---------- file rules (the AI's output is validated before anything is saved) ---------- */
export const FILE_LIMITS = { files: 60, fileBytes: 200_000, totalBytes: 1_500_000 };
const EXT = new Set(["html", "htm", "css", "js", "mjs", "cjs", "json", "md", "txt", "svg", "xml", "webmanifest", "sql", "ico"]);
const NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/** null when the path is safe to write, else a Persian reason */
export function pathError(p: string): string | null {
  if (!p || p.length > 160) return "مسیر فایل خالی یا خیلی بلند است";
  if (p.startsWith("/") || p.includes("\\") || /^[a-z]+:/i.test(p)) return "مسیر مطلق مجاز نیست: " + p;
  const parts = p.split("/");
  if (parts.length > 6) return "پوشه‌بندی خیلی عمیق است: " + p;
  for (const s of parts) {
    if (s === ".." || s === ".") return "مسیر نسبی با .. مجاز نیست: " + p;
    if (!NAME_RE.test(s)) return "نام فایل یا پوشه نامعتبر است: " + p;
  }
  if (parts[0] === "node_modules") return "پوشه node_modules نوشته نمی‌شود";
  const ext = p.includes(".") ? p.slice(p.lastIndexOf(".") + 1).toLowerCase() : "";
  if (!EXT.has(ext) && p !== "Procfile") return "پسوند فایل مجاز نیست: " + p;
  return null;
}

const bytes = (s: string) => new TextEncoder().encode(s).length;
/** checks a whole snapshot: every path, each file's size, the count and the total */
export function filesError(files: Record<string, string>): string | null {
  const paths = Object.keys(files);
  if (paths.length > FILE_LIMITS.files) return "تعداد فایل‌ها از " + FILE_LIMITS.files.toLocaleString("fa-IR") + " بیشتر است";
  let total = 0;
  for (const p of paths) {
    const e = pathError(p);
    if (e) return e;
    const n = bytes(files[p]);
    if (n > FILE_LIMITS.fileBytes) return "فایل " + p + " از ۲۰۰ کیلوبایت بزرگ‌تر است";
    total += n;
  }
  if (total > FILE_LIMITS.totalBytes) return "حجم کل پروژه از ۱٫۵ مگابایت بیشتر است";
  return null;
}

/** "auto" stack: an idea that has to keep data (bookings, sign-ups, orders) gets a server */
export function guessStack(prompt: string): BuilderStack {
  return /ثبت[‌ ]?نام|رزرو|نوبت|ذخیره|پایگاه[‌ ]?داده|پنل مدیریت|سفارش|فرم|database|backend|api|login|ورود کاربر/i.test(prompt) ? "node" : "static";
}

/** a short project name from the idea */
export function projectName(prompt: string) {
  const s = prompt.replace(/\s+/g, " ").trim().replace(/^(یک|یه)\s+/, "");
  const cut = s.split(/[،,.؛:\n]| با | که /)[0].trim();
  return (cut.length > 48 ? cut.slice(0, 46).trim() + "…" : cut) || "پروژه جدید";
}

export const isTextFile = (p: string) => !/\.ico$/i.test(p);
export const langOf = (p: string) => (p.split(".").pop() || "").toLowerCase();

/* ---------- views ---------- */
export type BuilderRunView = {
  id: string; kind: "generate" | "edit" | "fix" | "maintain"; status: "running" | "succeeded" | "failed" | "cancelled"; model: string; prompt: string;
  cost: number; inTokens: number; outTokens: number; summary: string; log: string; diff: { added: string[]; changed: string[]; deleted: string[] };
  version: number | null; attempt: number; incident: string; hasPatch: boolean; applied: boolean; at: string;
};
export type BuilderProjectSummary = {
  id: string; name: string; description: string; stack: BuilderStack; status: string; version: number; liveUrl: string | null; spent: number; updatedAt: string; files: number;
};
export type BuilderDeployView = {
  status: string; attempt: number; error: string; deploymentId: string | null; log: string; failure: string; appId: string | null; appName: string | null;
};
export type BuilderProjectView = BuilderProjectSummary & {
  /** what the panel frames for the live app (the real URL, or the deployed version's preview on the simulator) */
  liveView: string | null;
  model: string; previewUrl: string; appId: string | null; appName: string | null; dbId: string | null; deployedVersion: number | null;
  autoMaintain: boolean; maintainCap: number; maintainSpent: number; checkedAt: string | null;
  files: number; tree: { path: string; size: number }[];
  messages: { id: number; role: "user" | "assistant"; content: string; runId: string | null; at: string }[];
  runs: BuilderRunView[];
  versions: { version: number; message: string; at: string; files: number }[];
  deploy: BuilderDeployView | null;
  plan: { id: string; name: string; monthly: number; hourly: number; dbMonthly: number } | null;
};

/** events of the generation stream (/api/build/run) */
export type BuilderEvent =
  | { type: "run"; runId: string; kind: string; model: string }
  | { type: "status"; text: string }
  | { type: "plan"; text: string }
  | { type: "file"; path: string }
  | { type: "done"; version: number; summary: string; charged: number; diff: { added: string[]; changed: string[]; deleted: string[] } }
  | { type: "error"; message: string };
