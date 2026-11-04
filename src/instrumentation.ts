/** starts the background worker in each Node.js server process (set WORKER=0 to disable), and the web console bridge
    (./server/vnc-proxy.ts; VNC_PROXY=0 disables it) */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.VNC_PROXY !== "0") (await import("./server/vnc-proxy")).startVncProxy();
  if (process.env.WORKER === "0") return;
  const [{ startWorker }, { db }] = await Promise.all([import("./server/worker"), import("./server/ctx")]);
  startWorker(db, Number(process.env.WORKER_INTERVAL_MS || 5000));
}
