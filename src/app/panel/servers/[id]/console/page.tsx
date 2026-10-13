import { VncFullPage } from "@/components/panel/vps-extras";

export const metadata = { title: "کنسول سرور" };

export default async function Page({ params }: PageProps<"/panel/servers/[id]/console">) {
  const { id } = await params;
  return <VncFullPage key={id} id={id} />;
}
