import { AssistantPage } from "@/components/panel/assistant";
import { ASSISTANT } from "@/lib/assistant";

export const metadata = { title: ASSISTANT.name };

export default function Page() {
  return <AssistantPage />;
}
