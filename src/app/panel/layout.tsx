import type { Metadata } from "next";
import { Suspense } from "react";
import { PanelGate } from "@/components/panel/shell";

export const metadata: Metadata = { title: { default: "پنل کاربری", template: "%s | پنل گره" }, robots: { index: false, follow: false } };

export default function PanelLayout({ children }: LayoutProps<"/panel">) {
  return <PanelGate kind="user"><Suspense>{children}</Suspense></PanelGate>;
}
