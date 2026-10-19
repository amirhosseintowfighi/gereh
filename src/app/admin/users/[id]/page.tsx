import { AdminUser360 } from "@/components/panel/admin-user";

export const metadata = { title: "نمای کامل مشتری" };

export default async function Page({ params }: PageProps<"/admin/users/[id]">) {
  const { id } = await params;
  return <AdminUser360 key={id} id={decodeURIComponent(id)} />;
}
