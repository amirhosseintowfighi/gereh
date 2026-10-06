import { UserHosting } from "@/components/panel/user";

export const metadata = { title: "جزئیات هاست" };

export default async function Page({ params }: PageProps<"/panel/hosting/[id]">) {
  const { id } = await params;
  return <UserHosting id={id} />;
}
