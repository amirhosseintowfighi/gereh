import { LOCS } from "./catalog";

/** parts of the platform shown on /status and selectable when posting an incident */
export const COMPONENTS: { id: string; label: string; group: string }[] = [
  ...LOCS.map((l) => ({ id: l.id, label: "سرور ابری " + l.label, group: "زیرساخت" })),
  { id: "dns", label: "DNS (ns1/ns2.gereh.cloud)", group: "سرویس‌ها" },
  { id: "hosting", label: "هاست اشتراکی", group: "سرویس‌ها" },
  { id: "panel", label: "پنل کاربری و API", group: "سرویس‌ها" },
  { id: "billing", label: "پرداخت و درگاه", group: "سرویس‌ها" },
];
export const INCIDENT_STATUS: Record<string, string> = { investigating: "در حال بررسی", identified: "علت مشخص شد", monitoring: "در حال پایش", resolved: "برطرف شد", scheduled: "برنامه‌ریزی‌شده" };
export const SEVERITY: Record<string, string> = { minor: "جزئی", major: "اختلال جدی", critical: "قطعی", maintenance: "نگهداری" };
