import { AdvisorPage } from "@/components/panel/advisor";
import { ADVISOR } from "@/lib/advisor";

export const metadata = { title: ADVISOR.name };

export default function Page() {
  return <AdvisorPage />;
}
