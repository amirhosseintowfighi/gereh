import { UserStorage } from "@/components/panel/storage";

export const metadata = { title: "فضای ذخیره‌سازی ابری" };

export default async function Page({ searchParams }: PageProps<"/panel/storage">) {
  const { new: create } = await searchParams;
  return <UserStorage create={create === "1"} />;
}
