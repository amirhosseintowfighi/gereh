import { LegalPage } from "@/components/site/legal";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({ title: "سیاست حریم خصوصی", description: "گره چه اطلاعاتی از شما نگه می‌دارد، چطور از محتوای سرورهای شما محافظت می‌کند و در چه شرایطی اطلاعات به اشتراک گذاشته می‌شود.", path: "/privacy" });

export default function Page() {
  return <LegalPage doc="privacy" />;
}
