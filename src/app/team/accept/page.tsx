import type { Metadata } from "next";
import { Suspense } from "react";
import { TeamAccept } from "@/components/panel/team";

export const metadata: Metadata = { title: "پیوستن به تیم", robots: { index: false, follow: false } };

export default function Page() {
  return <Suspense><TeamAccept /></Suspense>;
}
