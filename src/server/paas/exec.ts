/* `kubectl exec` without kubectl: the pods/exec subresource over a WebSocket (channel protocol
   v4.channel.k8s.io). Every message starts with a channel byte: 0 stdin, 1 stdout, 2 stderr, 3 the
   final status. Used by the database features (users, inspector, first-run setup), so commands
   always run in the database's own container with the credentials it already has. */
import "server-only";
import { randomBytes } from "node:crypto";
import http from "node:http";
import https from "node:https";
import type { Duplex } from "node:stream";
import { caPem, cfg } from "./kubernetes";

export type ExecResult = { code: number; stdout: string; stderr: string };
export class ExecError extends Error {
  constructor(message: string, readonly result: ExecResult) { super(message); }
}

export const execPath = (ns: string, pod: string, container: string, command: string[], stdin: boolean) =>
  `/api/v1/namespaces/${ns}/pods/${pod}/exec?container=${encodeURIComponent(container)}&stdout=true&stderr=true${stdin ? "&stdin=true" : ""}` +
  command.map((c) => "&command=" + encodeURIComponent(c)).join("");

/** one masked client frame (binary) */
export function frame(payload: Buffer, opcode = 2) {
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x80 | opcode, 0x80 | len]) : len < 65536 ? Buffer.from([0x80 | opcode, 0x80 | 126, len >> 8, len & 255]) : Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(len)); return b; })()]);
  const mask = randomBytes(4);
  const body = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) body[i] = payload[i] ^ mask[i & 3];
  return Buffer.concat([head, mask, body]);
}

/** incremental parser for server frames (unmasked); calls onMessage with whole messages */
export function frameReader(onMessage: (opcode: number, data: Buffer) => void) {
  let buf: Buffer = Buffer.alloc(0);
  let parts: Buffer[] = [], partOp = 0;
  return (chunk: Buffer) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0, op = buf[0] & 0x0f, masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const maskKey = masked ? buf.subarray(off, off + 4) : null;
      if (masked) off += 4;
      if (buf.length < off + len) return;
      let data = buf.subarray(off, off + len);
      if (maskKey) data = Buffer.from(data.map((b, i) => b ^ maskKey[i & 3]));
      buf = buf.subarray(off + len);
      if (op === 0) { parts.push(data); if (fin) { onMessage(partOp, Buffer.concat(parts)); parts = []; } continue; }
      if (!fin && op < 8) { partOp = op; parts = [data]; continue; }
      onMessage(op, Buffer.from(data));
    }
  };
}

/** exit code from the channel-3 status object */
export function exitCode(status: string) {
  try {
    const s = JSON.parse(status) as { status?: string; message?: string; details?: { causes?: { reason?: string; message?: string }[] } };
    if (s.status === "Success") return { code: 0, message: "" };
    const c = s.details?.causes?.find((x) => x.reason === "ExitCode");
    return { code: c ? Number(c.message) || 1 : 1, message: s.message ?? "" };
  } catch { return { code: 1, message: status }; }
}

/** runs `command` in a container; `stdin` is written and must be fully consumed by the command
    (v4 has no stdin EOF, so read a known length, e.g. `head -c N`) */
export function podExec(ns: string, pod: string, container: string, command: string[], o: { stdin?: AsyncIterable<Buffer> | Buffer; timeoutMs?: number; maxOut?: number; /** binary stdout goes here instead of the result */ onStdout?: (chunk: Buffer) => void } = {}): Promise<ExecResult> {
  const { api, token } = cfg();
  const url = new URL(api + execPath(ns, pod, container, command, !!o.stdin));
  const lib = url.protocol === "http:" ? http : https;
  const maxOut = o.maxOut ?? 8 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    let socket: Duplex | null = null, done = false;
    const out: Buffer[] = [], err: Buffer[] = [];
    let size = 0, status = "";
    const finish = (e?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket?.destroy();
      if (e) return reject(e);
      // no status message: the connection closed before the command finished
      if (!status) return reject(new Error("exec ended without a status"));
      resolve({ code: exitCode(status).code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
    };
    const timer = setTimeout(() => finish(new Error("exec timed out")), o.timeoutMs ?? 60_000);
    const req = lib.request(url, {
      method: "GET", ca: caPem(),
      headers: { authorization: "Bearer " + token, connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": randomBytes(16).toString("base64"), "sec-websocket-protocol": "v4.channel.k8s.io" },
    });
    req.on("response", (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => finish(new Error("Kubernetes exec: " + res.statusCode + " " + Buffer.concat(chunks).toString("utf8").slice(0, 300))));
    });
    req.on("error", (e) => finish(e));
    req.on("upgrade", (_res, sock, head) => {
      socket = sock;
      const read = frameReader((op, data) => {
        if (op === 8) return finish();
        if (op === 9) { sock.write(frame(data, 10)); return; }
        if (op !== 1 && op !== 2 || !data.length) return;
        const ch = data[0], body = data.subarray(1);
        if (ch === 3) { status += body.toString("utf8"); return; }
        size += body.length;
        if (size > maxOut) return finish(new Error("exec output too large"));
        if (ch === 1 && o.onStdout) o.onStdout(body);
        else (ch === 2 ? err : out).push(body);
      });
      if (head?.length) read(head);
      sock.on("data", read);
      sock.on("end", () => finish());
      sock.on("close", () => finish());
      sock.on("error", (e) => finish(e));
      if (o.stdin) void (async () => {
        try {
          const src: AsyncIterable<Buffer> = Buffer.isBuffer(o.stdin) ? [o.stdin] as unknown as AsyncIterable<Buffer> : o.stdin!;
          for await (const chunk of src) {
            for (let i = 0; i < chunk.length; i += 256 * 1024) {
              if (done) return;
              const ok = sock.write(frame(Buffer.concat([Buffer.from([0]), chunk.subarray(i, i + 256 * 1024)])));
              if (!ok) await new Promise((r) => sock.once("drain", r));
            }
          }
        } catch (e) { finish(e as Error); }
      })();
    });
    req.end();
  });
}

/** an interactive terminal (tty; stdout and stderr arrive merged on channel 1, resize on channel 4) */
export type PodShell = {
  write(data: string | Buffer): void;
  resize(cols: number, rows: number): void;
  close(): void;
  onData(cb: (chunk: Buffer) => void): void;
  onExit(cb: (code: number, message: string) => void): void;
};
export function podShell(ns: string, pod: string, container: string, command: string[], size: { cols: number; rows: number }): Promise<PodShell> {
  const { api, token } = cfg();
  const url = new URL(api + `/api/v1/namespaces/${ns}/pods/${pod}/exec?container=${encodeURIComponent(container)}&stdin=true&stdout=true&tty=true` + command.map((c) => "&command=" + encodeURIComponent(c)).join(""));
  const lib = url.protocol === "http:" ? http : https;
  return new Promise((resolve, reject) => {
    const req = lib.request(url, {
      method: "GET", ca: caPem(),
      headers: { authorization: "Bearer " + token, connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": randomBytes(16).toString("base64"), "sec-websocket-protocol": "v4.channel.k8s.io" },
    });
    const timer = setTimeout(() => { req.destroy(); reject(new Error("exec timed out")); }, 30_000);
    req.on("response", (res) => {
      clearTimeout(timer);
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => reject(new Error("Kubernetes exec: " + res.statusCode + " " + Buffer.concat(chunks).toString("utf8").slice(0, 300))));
    });
    req.on("error", (e) => { clearTimeout(timer); reject(e); });
    req.on("upgrade", (_res, sock: Duplex, head) => {
      clearTimeout(timer);
      const data: ((c: Buffer) => void)[] = [], exit: ((code: number, message: string) => void)[] = [];
      let status = "", ended = false;
      const end = () => {
        if (ended) return;
        ended = true;
        clearInterval(ping);
        sock.destroy();
        const r = status ? exitCode(status) : { code: 0, message: "" };
        for (const cb of exit) cb(r.code, r.message);
      };
      const send = (ch: number, b: Buffer) => { if (!ended) sock.write(frame(Buffer.concat([Buffer.from([ch]), b]))); };
      const read = frameReader((op, msg) => {
        if (op === 8) return end();
        if (op === 9) { sock.write(frame(msg, 10)); return; }
        if (op !== 1 && op !== 2 || !msg.length) return;
        if (msg[0] === 3) status += msg.subarray(1).toString("utf8");
        else if (msg[0] === 1 || msg[0] === 2) { if (data.length) for (const cb of data) cb(msg.subarray(1)); else early.push(msg.subarray(1)); }
      });
      const early: Buffer[] = [];
      // keeps idle-timeout proxies between us and the API server from closing the stream
      const ping = setInterval(() => { if (!ended) sock.write(frame(Buffer.alloc(0), 9)); }, 30_000);
      sock.on("data", read);
      sock.on("end", end);
      sock.on("close", end);
      sock.on("error", end);
      const shell: PodShell = {
        write: (d) => send(0, Buffer.isBuffer(d) ? d : Buffer.from(d, "utf8")),
        resize: (cols, rows) => send(4, Buffer.from(JSON.stringify({ Width: cols, Height: rows }))),
        close: () => { if (!ended) { sock.write(frame(Buffer.alloc(0), 8)); end(); } },
        onData: (cb) => { data.push(cb); for (const c of early.splice(0)) cb(c); },
        onExit: (cb) => { if (ended) { const r = status ? exitCode(status) : { code: 0, message: "" }; cb(r.code, r.message); } else exit.push(cb); },
      };
      shell.resize(size.cols, size.rows);
      if (head?.length) read(head);
      resolve(shell);
    });
    req.end();
  });
}
