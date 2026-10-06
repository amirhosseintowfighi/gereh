import { LegalPage } from "@/components/site/legal";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({ title: "قوانین استفاده از خدمات گره", description: "شرایط استفاده از سرور ابری، هاست و دامنه گره: استفاده مجاز، پرداخت و تمدید، تعلیق سرویس و ضمانت ۷ روزه بازگشت وجه.", path: "/terms" });

export default function Page() {
  return <LegalPage doc="terms" />;
}
