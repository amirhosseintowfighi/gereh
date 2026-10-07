import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { actor, method, needStaff } from "../ctx";
import { chatMessages, chats } from "../db/schema";
import { fail, logAudit } from "../util";

const id = z.string().max(40);

/** staff side of the live chat (visitors use /api/chat with their token) */
export const chatRpc = {
  "chat.reply": method(z.tuple([id, z.string().max(2000)]), async (ctx, [cid, raw]) => {
    const a = needStaff(ctx, "tickets");
    const text = raw.trim();
    if (!text) fail("متن پاسخ خالی است.");
    const name = a.user.name.split(" ")[0] || a.user.name;
    await ctx.db.transaction(async (tx) => {
      const r = await tx.update(chats).set({ status: "open", unread: false, agent: name, lastAt: new Date() }).where(eq(chats.id, cid)).returning({ id: chats.id });
      if (!r.length) fail("گفتگو پیدا نشد.", 404);
      await tx.insert(chatMessages).values({ chatId: cid, from: "staff", author: name, text });
    });
  }),
  "chat.read": method(z.tuple([id]), async (ctx, [cid]) => {
    needStaff(ctx, "tickets");
    await ctx.db.update(chats).set({ unread: false }).where(eq(chats.id, cid));
  }),
  "chat.close": method(z.tuple([id]), async (ctx, [cid]) => {
    needStaff(ctx, "tickets");
    const r = await ctx.db.update(chats).set({ status: "closed", unread: false }).where(eq(chats.id, cid)).returning({ id: chats.id });
    if (!r.length) fail("گفتگو پیدا نشد.", 404);
    await ctx.db.insert(chatMessages).values({ chatId: cid, from: "system", text: "گفتگو توسط پشتیبانی بسته شد." });
    await logAudit(ctx.db, actor(ctx), "بستن گفتگوی آنلاین", cid, ctx.ip);
  }),
};
