import { AppDetail } from "@/components/panel/paas-apps";

export const metadata = { title: "جزئیات اپ" };

export default async function Page({ params }: PageProps<"/panel/apps/[id]">) {
  const { id } = await params;
  return <AppDetail key={id} id={id} />;
}
