import { MonitorPage } from "@/components/panel/monitor";
import { MONITOR } from "@/lib/monitor";

export const metadata = { title: MONITOR.name };

export default function Page() {
  return <MonitorPage />;
}
