import { UserTickets } from "@/components/panel/user";

export const metadata = { title: "تیکت" };

export default async function Page({ params }: PageProps<"/panel/tickets/[id]">) {
  const { id } = await params;
  return <UserTickets key={id} id={id} />;
}
