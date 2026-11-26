/* TEMPORARY: previews of three home hero options (a, b, c) for choosing a direction; remove after the choice. */
import { HeroA, HeroB, HeroC } from "@/components/home/hero-variants";

export const metadata = { title: "پیش‌نمایش", robots: { index: false, follow: false } };

export default async function HeroPreview({ params }: { params: Promise<{ v: string }> }) {
  const { v } = await params;
  return v === "a" ? <HeroA /> : v === "b" ? <HeroB /> : <HeroC />;
}
