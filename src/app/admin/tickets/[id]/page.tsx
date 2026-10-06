import { AdminTickets } from "@/components/panel/admin";

export const metadata = { title: "تیکت" };

export default async function Page({ params }: PageProps<"/admin/tickets/[id]">) {
  const { id } = await params;
  return <AdminTickets id={id} />;
}
