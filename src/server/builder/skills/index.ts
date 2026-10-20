/* Skill selection for one agent run: the core skills of the task kind and stack first (in catalog
   order), then the ones the request's words call for (most specific first), within a token budget. */
import "server-only";
import { estimateTokens } from "@/lib/ai";
import { SKILL_TITLES, type BuilderStack } from "@/lib/builder";
import { dirOf, langInfo, localeOf } from "@/lib/site-language";
import { SKILLS, type Skill, type SkillCtx, type TaskKind } from "./catalog";

export { SKILLS, type Skill, type SkillCtx, type TaskKind };

/** the default budget (tokens) of the skills block; BUILDER_SKILLS_BUDGET overrides it */
export const SKILLS_BUDGET = 6000;
export const skillsBudget = () => {
  const n = Number(process.env.BUILDER_SKILLS_BUDGET);
  return Number.isFinite(n) && n > 0 ? Math.min(20_000, Math.floor(n)) : SKILLS_BUDGET;
};

export const skillCtx = (lang: string): SkillCtx => {
  const info = langInfo(lang);
  return { lang, dir: dirOf(lang), locale: localeOf(lang), name: info ? info.native + (info.id === "en" ? "" : " (" + englishName(info.id) + ")") : lang };
};
const englishName = (id: string) => { try { return new Intl.DisplayNames(["en"], { type: "language" }).of(id) ?? id; } catch { return id; } };

const bodyOf = (s: Skill, c: SkillCtx) => (typeof s.body === "function" ? s.body(c) : s.body);
const renderSkill = (s: Skill, c: SkillCtx) =>
  `<skill id="${s.id}" title="${SKILL_TITLES[s.id] ?? s.id}">\n${bodyOf(s, c)}\nSelf-review checklist:\n${s.checklist.map((x) => "- [ ] " + x).join("\n")}\n</skill>`;

/** tokens one skill adds to the prompt */
export const skillTokens = (s: Skill, c: SkillCtx = skillCtx("fa")) => estimateTokens(renderSkill(s, c).length);

const byId = new Map(SKILLS.map((s) => [s.id, s]));
export const skillById = (id: string) => byId.get(id) ?? null;

export function selectSkills(o: { stack: BuilderStack; kind: TaskKind; prompt?: string; budget?: number; lang?: string }): Skill[] {
  const budget = o.budget ?? skillsBudget();
  const ctx = skillCtx(o.lang || "fa");
  const text = o.prompt ?? "";
  const fits = SKILLS.filter((s) => s.stacks.includes(o.stack));
  const core = fits.filter((s) => s.core.includes(o.kind));
  // keyword matches outside the core, the more distinct words matched the earlier
  const hits = (s: Skill) => new Set([...text.matchAll(new RegExp(s.triggers.source, "gi"))].map((m) => m[0].toLowerCase())).size;
  const extra = fits.filter((s) => !s.core.includes(o.kind) && s.kinds.includes(o.kind) && hits(s) > 0)
    .sort((a, b) => hits(b) - hits(a));
  const out: Skill[] = [];
  let used = 0;
  for (const s of [...core, ...extra]) {
    const t = skillTokens(s, ctx);
    if (out.length && used + t > budget) continue;
    out.push(s);
    used += t;
  }
  return out;
}

/** the block appended to the system prompt */
export function skillsBlock(skills: Skill[], ctx: SkillCtx) {
  if (!skills.length) return "";
  return `# Skills
The skills below are the house standards for this run. Follow every rule in them unless the customer explicitly asks otherwise, and before you finish, check your files against each skill's checklist. The last line of <plan> must be "skills: <the ids of the skills you applied, comma separated>".
<skills>
${skills.map((s) => renderSkill(s, ctx)).join("\n")}
</skills>`;
}

/** the checklists only (for the review pass) */
export const checklists = (skills: Skill[]) => skills.map((s) => s.id + ":\n" + s.checklist.map((c) => "- " + c).join("\n")).join("\n");
