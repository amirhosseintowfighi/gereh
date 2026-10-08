import { GeoDetail } from "@/components/panel/geo";

export const metadata = { title: "Geo DNS دامنه" };

export default async function Page({ params }: PageProps<"/panel/geo/[id]">) {
  const { id } = await params;
  return <GeoDetail key={id} id={id} />;
}
