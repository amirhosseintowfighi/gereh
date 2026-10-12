"use client";
/* Live datacenter locations on the client. Pages render with the built-in defaults, then this loads what the
   admin saved (/api/locations, once per page load) and re-renders every component that uses it. */
import { useEffect, useReducer } from "react";
import { LOCS, setLocs, type Loc } from "./catalog";

const subs = new Set<() => void>();
let loading = false, loaded = false;
const emit = () => subs.forEach((f) => f());

/** replace the live list (e.g. from the panel state after an admin edit) */
export function applyLocs(list: Loc[] | undefined) {
  if (!list?.length) return;
  loaded = true;
  setLocs(list);
  emit();
}

export function useLocs(fromState?: Loc[]): Loc[] {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    subs.add(rerender);
    if (!loaded && !loading && !fromState?.length) {
      loading = true;
      fetch("/api/locations").then((r) => (r.ok ? r.json() : null)).then((j: { locations?: Loc[] } | null) => applyLocs(j?.locations)).catch(() => {}).finally(() => { loading = false; });
    }
    return () => { subs.delete(rerender); };
  }, [fromState?.length]);
  useEffect(() => { applyLocs(fromState); }, [fromState]);
  return LOCS;
}
