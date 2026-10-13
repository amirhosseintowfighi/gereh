import { UserMail } from "@/components/panel/mail";

export const metadata = { title: "سرویس ایمیل" };

export default async function Page({ searchParams }: PageProps<"/panel/mail">) {
  const { new: create } = await searchParams;
  return <UserMail create={create === "1"} />;
}
