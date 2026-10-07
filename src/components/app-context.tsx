"use client";
import { createContext, useContext } from "react";
import type { Sku } from "@/lib/catalog";
import type { CartItem } from "@/lib/store";

export type ConfirmOpts = { title?: string; danger?: boolean; ok?: string };
export type AppApi = {
  notify: (msg: string, icon?: string) => void;
  /** priced from the live catalog; the server prices it again at checkout */
  addToCart: (sku: Sku) => void;
  searchDomain: (q: string) => void;
  confirm: (text: string, opts?: ConfirmOpts) => Promise<boolean>;
  openCart: () => void;
  openPalette: () => void;
  cart: CartItem[];
};
export const AppCtx = createContext<AppApi | null>(null);
export function useApp() {
  const v = useContext(AppCtx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}
