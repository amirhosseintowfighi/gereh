"use client";
import { ErrorView, type ErrorProps } from "@/components/error-view";

/** inside the admin shell: the sidebar and header stay usable when one page fails */
export default function AdminError(p: ErrorProps) {
  return <ErrorView {...p} compact home={["/admin", "داشبورد مدیریت"]} />;
}
