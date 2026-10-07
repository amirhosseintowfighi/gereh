/**
 * Shopping cart as an external store persisted to localStorage.
 * Reads go through useSyncExternalStore, so SSR renders an empty cart and the
 * client hydrates from storage without a setState-in-effect round trip.
 * Other tabs stay in sync through the `storage` event.
 */
import { useSyncExternalStore } from "react";
import type { CartItem } from "./store";

export const CART_KEY = "gereh:cart";
const EMPTY: CartItem[] = [];
const listeners = new Set<() => void>();
let cache: CartItem[] | null = null;

// items saved before SKUs existed (or tampered with) are dropped: the server could not price them anyway
const isItem = (x: unknown): x is CartItem =>
  !!x && typeof x === "object" && typeof (x as CartItem).id === "string" && typeof (x as CartItem).title === "string" && Number.isFinite((x as CartItem).base)
  && !!(x as CartItem).sku && typeof (x as CartItem).sku === "object" && typeof (x as CartItem).sku.t === "string";

function load(): CartItem[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter(isItem) : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function getCart(): CartItem[] {
  if (typeof window === "undefined") return EMPTY;
  return (cache ??= load());
}

const emit = () => listeners.forEach((f) => f());

export function setCart(next: CartItem[] | ((c: CartItem[]) => CartItem[])) {
  cache = typeof next === "function" ? next(getCart()) : next;
  try { localStorage.setItem(CART_KEY, JSON.stringify(cache)); } catch { /* private mode / quota: keep in memory */ }
  emit();
}

const onStorage = (e: StorageEvent) => { if (e.key === CART_KEY || e.key === null) { cache = null; emit(); } };

function subscribe(f: () => void) {
  if (!listeners.size && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  listeners.add(f);
  return () => {
    listeners.delete(f);
    if (!listeners.size && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export const useCart = () => useSyncExternalStore(subscribe, getCart, () => EMPTY);

/** Test helper: forget the in-memory copy so the next read hits storage. */
export const resetCartCache = () => { cache = null; };
