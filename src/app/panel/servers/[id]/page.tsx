import { ServerDetail } from "@/components/panel/server";

export const metadata = { title: "جزئیات سرور" };

export default async function Page({ params }: PageProps<"/panel/servers/[id]">) {
  const { id } = await params;
  return <ServerDetail key={id} id={id} />;
}
