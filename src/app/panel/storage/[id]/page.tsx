import { StorageDetail } from "@/components/panel/storage";

export const metadata = { title: "باکت" };

export default async function Page({ params }: PageProps<"/panel/storage/[id]">) {
  const { id } = await params;
  return <StorageDetail key={id} id={id} />;
}
