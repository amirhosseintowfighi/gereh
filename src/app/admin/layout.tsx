import type { Metadata } from "next";
import { Suspense } from "react";
import { PanelGate } from "@/components/panel/shell";

export const metadata: Metadata = { title: { default: "پنل مدیریت", template: "%s | مدیریت گره" }, robots: { index: false, follow: false } };

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <PanelGate kind="admin"><Suspense>{children}</Suspense></PanelGate>;
}
