"use client";
import { ErrorView, type ErrorProps } from "@/components/error-view";

/** inside the site layout, so the header and footer stay */
export default function SiteError(p: ErrorProps) {
  return <ErrorView {...p} />;
}
