import { BuildStudio } from "@/components/panel/builder";
import { BUILDER } from "@/lib/builder";

export const metadata = { title: BUILDER.name };

export default async function Page({ params }: PageProps<"/panel/build/[id]">) {
  const { id } = await params;
  return <BuildStudio key={id} id={id} />;
}
