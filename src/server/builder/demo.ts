/* Demo data: one finished builder project with history (generate → two edits → an auto-fixed deploy
   → a health check), live on its own app with a linked database, built by the simulator itself. */
import "server-only";
import type { BuilderStack } from "@/lib/builder";
import type { DB } from "../db/client";
import { builderMessages, builderProjects, builderRuns, builderVersions, paasApps, paasDbs, paasDeployments, paasEvents, paasLinks } from "../db/schema";
import { seal } from "../secrets";
import { diffOf } from "./engine";
import { parseOutput } from "./format";
import { simulate } from "./sim";

const PROMPT = "یک سایت نوبت‌دهی برای سالن زیبایی با معرفی خدمات، قیمت‌ها و فرم رزرو آنلاین نوبت";
const EDITS = ["رنگ سایت را صورتی کن و بخش سؤالات متداول اضافه کن", "یک گالری نمونه‌کار و دکمه تماس فوری اضافه کن"];

export async function seedBuilderDemo(db: DB) {
  const stack: BuilderStack = "node", pid = "bld-demo1", appId = "app-demo-salon", now = Date.now();
  const at = (minAgo: number) => new Date(now - minAgo * 60_000);
  const apply = (files: Record<string, string>, text: string) => {
    const p = parseOutput(text), next = { ...files, ...p.files };
    for (const d of p.deletes) delete next[d];
    return { next, summary: p.summary, diff: diffOf(files, next) };
  };

  const v1 = apply({}, simulate(stack, { kind: "generate", prompt: PROMPT }));
  const v2 = apply(v1.next, simulate(stack, { kind: "edit", prompt: EDITS[0], files: v1.next, history: [PROMPT] }));
  const v3 = apply(v2.next, simulate(stack, { kind: "edit", prompt: EDITS[1], files: v2.next, history: [PROMPT, EDITS[0]] }));
  // the first deploy failed: the start script had been lost in an edit; the fix agent restored it
  const broken = { ...v3.next, "package.json": v3.next["package.json"].replace(/\s*"scripts": \{[^}]*\},?/, "") };
  const failLog = "==> Extracting uploaded archive\n==> Detected Node.js 22\n$ npm ci --omit=dev\nadded 86 packages in 6s\n$ npm start\nnpm ERR! Missing script: \"start\"\nNo start command could be found\nERROR: build step exited with code 1";
  const v4 = apply(broken, simulate(stack, { kind: "fix", files: broken, log: failLog, failure: "start", explain: "" }));
  const health = parseOutput(simulate(stack, { kind: "maintain", files: v4.next, incident: "manual", events: "", logs: "" }));

  await db.insert(paasDbs).values({ id: "pdb-demo-salon", userId: "u1", name: "salon-rose-db", engine: "postgres", version: "17", planId: "db-micro", status: "running", host: "salon-rose-db.u1.db.gereh.internal", port: 5432, username: "u_salon_rose", passwordEnc: seal("demo-salon-db-password"), dbName: "salon_rose", createdAt: at(300) }).onConflictDoNothing();
  await db.insert(paasApps).values({ id: appId, userId: "u1", name: "salon-rose", stack: "node", source: "zip", port: 8080, healthPath: "/healthz", startCommand: "npm start", planId: "app-nano", status: "running", hookToken: "demo-hook-token-salon-rose-0000000", liveDeployment: "dep-salon2", createdAt: at(300) }).onConflictDoNothing();
  await db.insert(paasDeployments).values([
    { id: "dep-salon1", appId, status: "failed", trigger: "create", message: "اولین استقرار", failure: "start", log: failLog, createdAt: at(298), startedAt: at(298), finishedAt: at(297) },
    { id: "dep-salon2", appId, status: "live", trigger: "manual", message: "رفع خودکار خطا — نسخه ۴", image: "registry.gereh.net/u1/salon-rose:dep-salon2", log: "==> Extracting uploaded archive\n==> Detected Node.js 22\n$ npm ci --omit=dev\nadded 86 packages in 6s\n==> Pushing image registry.gereh.net/u1/salon-rose\n==> Releasing 1 instance(s)\n==> Live", createdAt: at(295), startedAt: at(295), finishedAt: at(293) },
  ]).onConflictDoNothing();
  await db.insert(paasLinks).values({ appId, dbId: "pdb-demo-salon", envKey: "DATABASE_URL" }).onConflictDoNothing();
  await db.insert(paasEvents).values([{ appId, kind: "deploy", message: "استقرار نسخه جدید (dep-salon2): رفع خودکار خطا", createdAt: at(293) }]);

  await db.insert(builderProjects).values({
    id: pid, userId: "u1", name: "سایت نوبت‌دهی سالن زیبایی", description: PROMPT, stack, model: "claude-opus-5.5", status: "live", appId, dbId: "pdb-demo-salon",
    previewToken: "demoSalonPreviewToken0000000000", version: 4, deployedVersion: 4, deploymentId: "dep-salon2", deployAttempt: 2, autoMaintain: true,
    checkedAt: at(3), spent: 61_200 + 18_900 + 21_400 + 12_300 + 6_800, maintainSpent: 6_800, createdAt: at(320), updatedAt: at(240),
  }).onConflictDoNothing();
  const run = (id: string, kind: "generate" | "edit" | "fix" | "maintain", o: { prompt?: string; cost: number; summary: string; diff?: { added: string[]; changed: string[]; deleted: string[] }; version?: number; attempt?: number; incident?: string; min: number }) =>
    ({ id, projectId: pid, userId: "u1", kind, status: "succeeded" as const, model: "claude-opus-5.5", prompt: o.prompt ?? "", inTokens: Math.round(o.cost / 4), outTokens: Math.round(o.cost / 9.5), cost: o.cost, summary: o.summary, diff: o.diff ?? { added: [], changed: [], deleted: [] }, version: o.version ?? null, attempt: o.attempt ?? 0, incident: o.incident ?? "", createdAt: at(o.min), finishedAt: at(o.min - 1) });
  await db.insert(builderRuns).values([
    run("brun-demo1", "generate", { prompt: PROMPT, cost: 61_200, summary: v1.summary, diff: v1.diff, version: 1, min: 318 }),
    run("brun-demo2", "edit", { prompt: EDITS[0], cost: 18_900, summary: v2.summary, diff: v2.diff, version: 2, min: 312 }),
    run("brun-demo3", "edit", { prompt: EDITS[1], cost: 21_400, summary: v3.summary, diff: v3.diff, version: 3, min: 305 }),
    run("brun-demo4", "fix", { cost: 12_300, summary: v4.summary, diff: v4.diff, version: 4, attempt: 1, min: 296 }),
    run("brun-demo5", "maintain", { cost: 6_800, summary: health.summary, incident: "manual", min: 240 }),
  ]).onConflictDoNothing();
  await db.insert(builderVersions).values([
    { projectId: pid, version: 1, files: v1.next, message: PROMPT.slice(0, 120), runId: "brun-demo1", createdAt: at(317) },
    { projectId: pid, version: 2, files: v2.next, message: EDITS[0], runId: "brun-demo2", createdAt: at(311) },
    { projectId: pid, version: 3, files: broken, message: EDITS[1], runId: "brun-demo3", createdAt: at(304) },
    { projectId: pid, version: 4, files: v4.next, message: "رفع خودکار: دستور اجرای اپ", runId: "brun-demo4", createdAt: at(296) },
  ]).onConflictDoNothing();
  await db.insert(builderMessages).values([
    { projectId: pid, role: "user", content: PROMPT, runId: "brun-demo1", createdAt: at(318) },
    { projectId: pid, role: "assistant", content: v1.summary, runId: "brun-demo1", createdAt: at(317) },
    { projectId: pid, role: "user", content: EDITS[0], runId: "brun-demo2", createdAt: at(312) },
    { projectId: pid, role: "assistant", content: v2.summary, runId: "brun-demo2", createdAt: at(311) },
    { projectId: pid, role: "user", content: EDITS[1], runId: "brun-demo3", createdAt: at(305) },
    { projectId: pid, role: "assistant", content: v3.summary, runId: "brun-demo3", createdAt: at(304) },
    { projectId: pid, role: "assistant", content: "انتشار ناموفق بود (دستور اجرا پیدا نشد)؛ AI در حال بررسی لاگ و رفع خودکار خطاست (تلاش ۱ از ۳).", createdAt: at(297) },
    { projectId: pid, role: "assistant", content: v4.summary, runId: "brun-demo4", createdAt: at(296) },
    { projectId: pid, role: "assistant", content: "🎉 منتشر شد (پس از رفع خودکار خطا)! نشانی سایت: https://salon-rose.gereh.dev", createdAt: at(293) },
    { projectId: pid, role: "assistant", content: health.summary, runId: "brun-demo5", createdAt: at(240) },
  ]);
}
