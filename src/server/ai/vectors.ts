/* Vector storage for knowledge bases. The default store keeps each chunk's embedding as a Postgres
   real[] and ranks by cosine similarity in JS — no extension needed, fine for a few thousand chunks per
   base. A pgvector store only has to implement the same interface (an `embedding vector` column and
   ORDER BY embedding <=> $1) and be selected with AI_VECTOR_STORE=pgvector. */
import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { cosine } from "@/lib/ai";
import type { DB } from "../db/client";
import { aiKbChunks, aiKbDocs } from "../db/schema";

export type ChunkIn = { kbId: string; docId: string; idx: number; text: string; embedding: number[] };
export type Hit = { chunkId: number; docId: string; docName: string; idx: number; text: string; score: number };

export interface VectorStore {
  readonly name: string;
  add(db: DB, rows: ChunkIn[]): Promise<void>;
  search(db: DB, kbId: string, vector: number[], k: number): Promise<Hit[]>;
}

class PgArrayStore implements VectorStore {
  readonly name = "pg-array";
  async add(db: DB, rows: ChunkIn[]) {
    for (let i = 0; i < rows.length; i += 200) await db.insert(aiKbChunks).values(rows.slice(i, i + 200));
  }
  async search(db: DB, kbId: string, vector: number[], k: number) {
    const rows = await db.select({ id: aiKbChunks.id, docId: aiKbChunks.docId, docName: aiKbDocs.name, idx: aiKbChunks.idx, text: aiKbChunks.text, embedding: aiKbChunks.embedding })
      .from(aiKbChunks).innerJoin(aiKbDocs, eq(aiKbDocs.id, aiKbChunks.docId)).where(and(eq(aiKbChunks.kbId, kbId))).orderBy(asc(aiKbChunks.id));
    return rows.map((r) => ({ chunkId: r.id, docId: r.docId, docName: r.docName, idx: r.idx, text: r.text, score: cosine(vector, r.embedding) }))
      .sort((a, b) => b.score - a.score).slice(0, k);
  }
}

let cached: VectorStore | null = null;
export function vectorStore(): VectorStore {
  if (cached) return cached;
  if (process.env.AI_VECTOR_STORE && process.env.AI_VECTOR_STORE !== "pg-array") console.warn("[ai] vector store " + process.env.AI_VECTOR_STORE + " is not available; using pg-array");
  return (cached = new PgArrayStore());
}
