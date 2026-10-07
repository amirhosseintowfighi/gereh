import { UserDatabases } from "@/components/panel/paas-dbs";

export const metadata = { title: "پایگاه داده" };

export default async function Page({ searchParams }: PageProps<"/panel/databases">) {
  const { new: create } = await searchParams;
  return <UserDatabases create={create === "1"} />;
}
