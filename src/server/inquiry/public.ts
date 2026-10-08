import "server-only";
import { asc, eq } from "drizzle-orm";
import { INQUIRY_SERVICES } from "@/lib/inquiry";
import { db } from "../ctx";
import { inquiryServices } from "../db/schema";

/** live catalog for the public pages; falls back to the defaults if the database is unreachable */
export async function publicInquiry(): Promise<{ id: string; name: string; price: number; approval: boolean }[]> {
  try {
    return (await (await db()).select().from(inquiryServices).where(eq(inquiryServices.active, true)).orderBy(asc(inquiryServices.position)))
      .map((s) => ({ id: s.id, name: s.name, price: s.price, approval: s.approval }));
  } catch {
    return INQUIRY_SERVICES.map((s) => ({ id: s.id, name: s.name, price: s.price, approval: s.approval }));
  }
}
