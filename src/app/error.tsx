"use client";
import { ErrorView, type ErrorProps } from "@/components/error-view";

export default function RootError(p: ErrorProps) {
  return <main id="main"><ErrorView {...p} /></main>;
}
