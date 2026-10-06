import { LegalPage } from "@/components/site/legal";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({ title: "توافق سطح خدمات (SLA)", description: "تعهد آپتایم ۹۹٫۹٪ ماهانه گره، نحوه جبران خسارت در صورت قطعی و قواعد اطلاع‌رسانی نگهداری برنامه‌ریزی‌شده.", path: "/sla" });

export default function Page() {
  return <LegalPage doc="sla" />;
}
