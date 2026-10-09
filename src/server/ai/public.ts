import "server-only";
import { asc, eq } from "drizzle-orm";
import { AI_MODELS, rulePrice } from "@/lib/ai";
import { db } from "../ctx";
import { aiModels } from "../db/schema";
import { aiEndpoint } from "./state";

export type PublicAiModel = { id: string; name: string; vendor: string; inPrice: number; outPrice: number; context: number; vision: boolean };

/** live price list for the public pages; falls back to the defaults if the database is unreachable */
export async function publicAi(): Promise<{ models: PublicAiModel[]; endpoint: string }> {
  try {
    const rows = await (await db()).select().from(aiModels).where(eq(aiModels.active, true)).orderBy(asc(aiModels.position));
    return { models: rows.map((m) => ({ id: m.id, name: m.name, vendor: m.vendor, inPrice: m.inPrice, outPrice: m.outPrice, context: m.context, vision: m.vision })), endpoint: aiEndpoint() };
  } catch {
    return { models: AI_MODELS.map((m) => ({ id: m.id, name: m.name, vendor: m.vendor, inPrice: rulePrice(m.ref[0]), outPrice: rulePrice(m.ref[1]), context: m.context, vision: !!m.vision })), endpoint: aiEndpoint() };
  }
}
