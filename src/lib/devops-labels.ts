import type { DevopsProject } from "./types";

export const PLAN_FA: Record<DevopsProject["plan"], string> = { startup: "بسته استارتاپ", growth: "بسته رشد", enterprise: "بسته سازمانی", project: "پروژه", audit: "ممیزی" };
export const PROJECT_STATUS: Record<DevopsProject["status"], [string, "blue" | "green" | "amber" | "gray"]> = { planning: ["برنامه‌ریزی", "blue"], active: ["فعال", "green"], paused: ["متوقف", "amber"], done: ["پایان‌یافته", "gray"] };
