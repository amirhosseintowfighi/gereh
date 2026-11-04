import net from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { bridge, readTicket, vncTicket } from "@/server/vnc-proxy";

/* a fake VNC port: answers the RFB greeting and echoes whatever the client sends */
const vnc = net.createServer((s) => { s.write("RFB 003.008\n"); s.on("data", (b) => s.write(b)); });
const vncPort = await new Promise<number>((r) => vnc.listen(0, "127.0.0.1", () => r((vnc.address() as net.AddressInfo).port)));
const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
wss.on("connection", (ws, req) => { const t = readTicket(decodeURIComponent(req.url!.slice(5))); if (!t) ws.close(4001, "ticket invalid or expired"); else bridge(ws, t); });
const wsPort = await new Promise<number>((r) => wss.on("listening", () => r((wss.address() as net.AddressInfo).port)));
afterAll(() => { wss.close(); vnc.close(); });

const connect = (ticket: string) => new WebSocket("ws://127.0.0.1:" + wsPort + "/vnc/" + encodeURIComponent(ticket), ["binary"]);

describe("web console bridge", () => {
  it("a ticket names one endpoint and expires; a forged one is refused", () => {
    const now = Date.now();
    expect(readTicket(vncTicket("10.0.0.5", 5927, "u1", now), now)).toMatchObject({ h: "10.0.0.5", p: 5927, u: "u1" });
    expect(readTicket(vncTicket("10.0.0.5", 5927, "u1", now), now + 121_000)).toBeNull();
    expect(readTicket("v1.forged.ticket.value")).toBeNull();
    expect(readTicket(JSON.stringify({ h: "1.2.3.4", p: 22, exp: now + 9e9 }))).toBeNull(); // plain JSON is not a ticket
  });

  it("pipes the browser's WebSocket to the VNC port, both ways, in binary", async () => {
    const ws = connect(vncTicket("127.0.0.1", vncPort, "u1"));
    const got: Buffer[] = [];
    await new Promise<void>((done) => {
      ws.on("message", (m) => { got.push(m as Buffer); if (Buffer.concat(got).toString().includes("ping")) done(); else if (got.length === 1) ws.send(Buffer.from("ping")); });
    });
    expect(ws.protocol).toBe("binary");
    expect(Buffer.concat(got).toString()).toBe("RFB 003.008\nping");
    ws.close();
  });

  it("refuses a bad ticket and reports an unreachable VNC port", async () => {
    const bad = connect("nope");
    expect(await new Promise((r) => bad.on("close", (code, why) => r([code, why.toString()])))).toEqual([4001, "ticket invalid or expired"]);
    const closed = await new Promise<number>((r) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)); }); });
    const down = connect(vncTicket("127.0.0.1", closed, "u1"));
    const [code, why] = await new Promise<[number, string]>((r) => down.on("close", (c, w) => r([c, w.toString()])));
    expect(code).toBe(4000);
    expect(why).toMatch(/ECONNREFUSED/);
  });
});
