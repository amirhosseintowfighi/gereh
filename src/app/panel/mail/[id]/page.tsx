import { MailDetail } from "@/components/panel/mail";

export const metadata = { title: "دامنه ایمیل" };

export default async function Page({ params }: PageProps<"/panel/mail/[id]">) {
  const { id } = await params;
  return <MailDetail key={id} id={id} />;
}
