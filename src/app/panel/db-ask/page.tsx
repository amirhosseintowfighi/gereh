import { DbAskPage } from "@/components/panel/db-ask";
import { DBQ } from "@/lib/dbquery";

export const metadata = { title: DBQ.name };

export default async function Page({ searchParams }: PageProps<"/panel/db-ask">) {
  const { db } = await searchParams;
  return <DbAskPage initial={typeof db === "string" ? db : undefined} />;
}
