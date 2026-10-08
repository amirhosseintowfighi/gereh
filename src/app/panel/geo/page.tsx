import { UserGeo } from "@/components/panel/geo";

export const metadata = { title: "Geo DNS" };

export default async function Page({ searchParams }: PageProps<"/panel/geo">) {
  const { new: create } = await searchParams;
  return <UserGeo create={create === "1"} />;
}
