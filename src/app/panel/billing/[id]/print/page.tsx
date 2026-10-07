import { InvoicePrint } from "@/components/panel/sales";

export const metadata = { title: "چاپ صورتحساب" };

export default async function Page({ params }: PageProps<"/panel/billing/[id]/print">) {
  const { id } = await params;
  return <InvoicePrint key={id} id={id} />;
}
