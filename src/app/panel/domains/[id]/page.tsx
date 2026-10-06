import { UserDomains } from "@/components/panel/user";

export const metadata = { title: "مدیریت دامنه" };

export default async function Page({ params }: PageProps<"/panel/domains/[id]">) {
  const { id } = await params;
  return <UserDomains id={id} />;
}
