/** starts the background worker in each Node.js server process (set WORKER=0 to disable) */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.WORKER === "0") return;
  const [{ startWorker }, { db }] = await Promise.all([import("./server/worker"), import("./server/ctx")]);
  startWorker(db, Number(process.env.WORKER_INTERVAL_MS || 5000));
}
