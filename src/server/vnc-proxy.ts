/* Web console bridge: the browser's noVNC speaks WebSocket, a VPS's VNC port speaks raw RFB over TCP. Pointing noVNC
   straight at the node (wss://<node>:59xx) can never work, and Virtualizor's own websocket proxy needs its port open
   and a trusted certificate. So the site bridges it itself: servers.vnc hands out a short-lived sealed ticket for
   exactly one host:port, the browser opens wss://<site>/vnc/<ticket> (Nginx passes /vnc/ to this listener with the
   site's own certificate), and each socket is piped to that TCP port. VNC_PROXY=0 turns it off; VNC_PROXY_PORT moves it. */
import "server-only";
import net from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import { open, seal } from "./secrets";

export const VNC_PROXY_PORT = Number(process.env.VNC_PROXY_PORT || 6081);
export const vncProxyOn = () => process.env.VNC_PROXY !== "0";
const TICKET_SEC = 120;

type Ticket = { h: string; p: number; u: string; exp: number };

/** a ticket for one VNC endpoint, valid for TICKET_SEC; the browser connects to /vnc/<ticket> on the site */
export function vncTicket(host: string, port: number, userId: string, now = Date.now()) {
  return seal(JSON.stringify({ h: host, p: port, u: userId, exp: now + TICKET_SEC * 1000 } satisfies Ticket));
}

/** the endpoint a ticket allows, or null when it is forged, malformed or expired */
export function readTicket(t: string, now = Date.now()): Ticket | null {
  try {
    const v = JSON.parse(open(t) ?? "null") as Ticket | null;
    if (!v || typeof v.h !== "string" || !Number.isInteger(v.p) || v.p < 1 || v.p > 65535 || v.exp < now) return null;
    return v;
  } catch { return null; }
}

/** pipes one browser socket to the VNC port the ticket names */
export function bridge(ws: WebSocket, t: Ticket) {
  const tcp = net.connect({ host: t.h, port: t.p });
  let done = false;
  const end = (why?: string) => {
    if (done) return;
    done = true;
    tcp.destroy();
    try { ws.close(why ? 4000 : 1000, why?.slice(0, 120)); } catch { /* already closed */ }
  };
  tcp.setTimeout(15_000, () => end("VNC " + t.h + ":" + t.p + " did not answer"));
  tcp.on("connect", () => tcp.setTimeout(0));
  tcp.on("data", (b) => { if (ws.readyState === ws.OPEN) ws.send(b); });
  tcp.on("error", (e) => { console.warn("[vnc-proxy] " + t.h + ":" + t.p + " " + (e as NodeJS.ErrnoException).code); end("VNC " + t.h + ":" + t.p + ": " + (e as NodeJS.ErrnoException).code); });
  tcp.on("close", () => end());
  ws.on("message", (m) => { if (!tcp.destroyed) tcp.write(Buffer.isBuffer(m) ? m : Buffer.from(m as ArrayBuffer)); });
  ws.on("close", () => end());
  ws.on("error", () => end());
}

let server: WebSocketServer | null = null;
/** one listener per machine: a second Next process finds the port taken and leaves it to the first */
export function startVncProxy() {
  if (server || !vncProxyOn()) return;
  const wss = new WebSocketServer({ host: "127.0.0.1", port: VNC_PROXY_PORT, handleProtocols: (p) => (p.has("binary") ? "binary" : false) });
  wss.on("error", (e) => { if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") console.error("[vnc-proxy]", e); server = null; });
  wss.on("connection", (ws, req) => {
    const m = /^\/vnc\/([^/?#]+)/.exec(req.url ?? "");
    const t = m ? readTicket(decodeURIComponent(m[1])) : null;
    if (!t) { console.warn("[vnc-proxy] refused a console ticket (invalid or expired)"); ws.close(4001, "ticket invalid or expired"); return; }
    bridge(ws, t);
  });
  wss.on("listening", () => console.log("[vnc-proxy] listening on 127.0.0.1:" + VNC_PROXY_PORT));
  server = wss;
}
