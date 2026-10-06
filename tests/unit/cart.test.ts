import { beforeEach, describe, expect, it, vi } from "vitest";
import { CART_KEY, getCart, resetCartCache, setCart } from "@/lib/cart";

const item = (id: string, base = 1000) => ({ id, title: "item " + id, base });

describe("cart store", () => {
  beforeEach(() => { localStorage.clear(); resetCartCache(); });

  it("starts empty and persists writes", () => {
    expect(getCart()).toEqual([]);
    setCart([item("a")]);
    expect(getCart()).toEqual([item("a")]);
    expect(JSON.parse(localStorage.getItem(CART_KEY)!)).toEqual([item("a")]);
  });

  it("supports functional updates", () => {
    setCart([item("a")]);
    setCart((c) => [...c, item("b")]);
    setCart((c) => c.filter((x) => x.id !== "a"));
    expect(getCart().map((x) => x.id)).toEqual(["b"]);
  });

  it("returns a stable snapshot between writes (useSyncExternalStore contract)", () => {
    setCart([item("a")]);
    expect(getCart()).toBe(getCart());
  });

  it("drops corrupted or malformed storage", () => {
    localStorage.setItem(CART_KEY, "{not json");
    expect(getCart()).toEqual([]);
    resetCartCache();
    localStorage.setItem(CART_KEY, JSON.stringify([item("ok"), { id: 1 }, null, { id: "x", title: "t", base: "NaN" }]));
    expect(getCart()).toEqual([item("ok")]);
  });

  it("keeps working when storage throws (private mode / quota)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceeded"); });
    setCart([item("a")]);
    expect(getCart()).toEqual([item("a")]);
  });
});
