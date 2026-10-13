import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { context } from "@/server/ctx";
import { notifications } from "@/server/db/schema";
import { errorResponse, noStore } from "@/server/http";

/** the service worker shows the newest unread notification after a (payload-less) push */
export async function GET() {
  try {
    const ctx = await context();
    if (!ctx.auth) return NextResponse.json({ title: "گره", body: "اعلان جدید دارید." }, { headers: noStore });
    const [n] = await ctx.db.select().from(notifications).where(and(eq(notifications.userId, ctx.auth.user.id), eq(notifications.read, false))).orderBy(desc(notifications.createdAt)).limit(1);
    return NextResponse.json({ title: "گره", body: n?.text ?? "اعلان جدید دارید.", url: "/panel" }, { headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}
