/* Managed WordPress (Eco / Turbo): a Gereh Apps app from the official WordPress image, a managed
   MariaDB, a persistent disk for wp-content, and (Turbo) the edge cache. Priced as the sum of its parts. */
import { DISK_PRICE_GB, type PaasPlan } from "./paas";

export type WpPlan = { id: "eco" | "turbo"; name: string; appPlan: string; dbPlan: string; diskGb: number; cdn: boolean; for: string; features: string[] };

export const WP_PLANS: WpPlan[] = [
  { id: "eco", name: "اکو", appPlan: "app-micro", dbPlan: "db-micro", diskGb: 10, cdn: false, for: "وبلاگ، سایت شرکتی و فروشگاه‌های کوچک",
    features: ["نیم هسته و ۵۱۲ مگ رم اختصاصی", "۱۰ گیگ دیسک NVMe", "MariaDB مدیریت‌شده با پشتیبان روزانه", "SSL رایگان و دامنه اختصاصی", "انتقال رایگان از cPanel"] },
  { id: "turbo", name: "توربو", appPlan: "app-small", dbPlan: "db-small", diskGb: 25, cdn: true, for: "فروشگاه ووکامرس و سایت‌های پربازدید",
    features: ["یک هسته و یک گیگ رم اختصاصی", "۲۵ گیگ دیسک NVMe", "MariaDB با یک گیگ رم و پشتیبان روزانه", "کش لبه (CDN) برای صفحات و فایل‌ها", "SSL رایگان و انتقال رایگان از cPanel"] },
];
export const wpPlanOf = (id: string | null | undefined) => WP_PLANS.find((p) => p.id === id);

export const WP_IMAGE = "wordpress:6.7-php8.3-apache";
/** WordPress behind the platform's TLS proxy must see HTTPS, or wp-admin loops on redirects */
export const WP_CONFIG_EXTRA = "if (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strpos($_SERVER['HTTP_X_FORWARDED_PROTO'], 'https') !== false) { $_SERVER['HTTPS'] = 'on'; }\ndefine('DISALLOW_FILE_EDIT', true);";

/** monthly price of a package from the live PaaS plan prices */
export function wpMonthly(p: WpPlan, plans: Pick<PaasPlan, "id" | "price">[]) {
  const price = (id: string) => plans.find((x) => x.id === id)?.price ?? 0;
  return price(p.appPlan) + price(p.dbPlan) + p.diskGb * DISK_PRICE_GB;
}

/** largest backup archive accepted for import (cPanel full backup .tar.gz, or .zip) */
export const WP_MAX_IMPORT = 4 * 1024 * 1024 * 1024;
