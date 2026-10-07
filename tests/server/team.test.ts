import { beforeEach, describe, expect, it } from "vitest";
import { readAuth } from "@/server/auth";
import { teamAllows } from "@/server/ctx";
import { outbox } from "@/server/messaging";
import { buildState } from "@/server/state";
import { asUser, call, db, fails, fresh, jar } from "./helpers";

beforeEach(fresh);
const tokenFromMail = () => /token=([\w-]+)/.exec(outbox.find((m) => m.subject?.startsWith("دعوت"))!.text)![1];

async function memberJoins(role: "admin" | "tech" | "billing") {
  await asUser();
  await call("team.invite", "sara@example.com", role, "http://localhost:3000");
  const token = tokenFromMail();
  jar.clear();
  await call("auth.register", { name: "سارا", email: "sara@example.com", phone: "09351112233", password: "Abcdefg1" });
  await call("team.accept", token);
}

describe("teams", () => {
  it("a member joins by invitation and works in the owner's account", async () => {
    await memberJoins("tech");
    const d = await db();
    const auth = await readAuth(d);
    expect(auth).toMatchObject({ uid: "u1", teamRole: "tech" });
    const s = await buildState(d, auth, "customer");
    expect(s.session).toMatchObject({ userId: "u1", teamRole: "tech" });
    expect(s.db.servers.every((x) => x.userId === "u1")).toBe(true);
    expect(s.db.team.memberships).toEqual([{ ownerId: "u1", ownerName: "امیر رضایی", role: "tech" }]);
    await call("servers.power", "srv-1042", "reboot");
  });

  it("role policy: tech cannot pay, billing cannot touch servers, nobody manages the owner's team", () => {
    expect(teamAllows("tech", "servers.reinstall")).toBe(true);
    expect(teamAllows("tech", "billing.pay")).toBe(false);
    expect(teamAllows("tech", "domains.renew")).toBe(false);
    expect(teamAllows("billing", "billing.pay")).toBe(true);
    expect(teamAllows("billing", "servers.power")).toBe(false);
    expect(teamAllows("billing", "domains.renew")).toBe(true);
    expect(teamAllows("admin", "account.changePassword")).toBe(false);
    expect(teamAllows("admin", "account.updateProfile")).toBe(false);
    expect(teamAllows("admin", "team.invite")).toBe(false);
    expect(teamAllows("admin", "team.switch")).toBe(true);
    expect(teamAllows(undefined, "anything.at.all")).toBe(true);
  });

  it("members cannot manage the owner's team; removal cuts access at once", async () => {
    await memberJoins("admin");
    expect(await fails("team.invite", "x@example.com", "tech")).toContain("صاحب حساب");
    const memberJar = new Map(jar);
    jar.clear();
    await asUser();
    const d = await db();
    const ownerView = await buildState(d, await readAuth(d), "customer");
    const sara = ownerView.db.team.members[0];
    expect(sara).toMatchObject({ email: "sara@example.com", role: "admin" });
    await call("team.remove", sara.id);
    jar.clear(); memberJar.forEach((v, k) => jar.set(k, v));
    expect((await readAuth(d))!.uid).not.toBe("u1");
  });

  it("an invite only works for the invited email", async () => {
    await asUser();
    await call("team.invite", "sara@example.com", "billing", "http://localhost:3000");
    const token = tokenFromMail();
    jar.clear();
    await call("auth.register", { name: "دیگری", email: "other@example.com", phone: "09351112299", password: "Abcdefg1" });
    expect(await fails("team.accept", token)).toContain("ایمیل دیگری");
  });

  it("switching back to your own account", async () => {
    await memberJoins("billing");
    await call("team.switch", null);
    expect((await readAuth(await db()))!.teamRole).toBeUndefined();
    expect(await fails("team.switch", "u2")).toContain("عضو این حساب نیستید");
  });
});
