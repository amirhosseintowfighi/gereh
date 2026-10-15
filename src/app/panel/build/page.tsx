import { BuildHome } from "@/components/panel/builder";
import { BUILDER } from "@/lib/builder";

export const metadata = { title: BUILDER.name + " — ساخت اپ با AI" };

export default function Page() {
  return <BuildHome />;
}
