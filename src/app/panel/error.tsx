"use client";
import { ErrorView, type ErrorProps } from "@/components/error-view";

/** inside the panel shell: the sidebar and header stay usable when one page fails */
export default function PanelError(p: ErrorProps) {
  return <ErrorView {...p} compact home={["/panel", "داشبورد"]} />;
}
