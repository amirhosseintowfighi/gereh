import { DbDetail } from "@/components/panel/paas-dbs";

export const metadata = { title: "جزئیات پایگاه داده" };

export default async function Page({ params }: PageProps<"/panel/databases/[id]">) {
  const { id } = await params;
  return <DbDetail key={id} id={id} />;
}
