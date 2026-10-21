/* The last failed panel call that came with a sealed ref (src/server/ai/explain.ts withErrorRef): the error toast
   offers «توضیح» for it. */
type RpcErr = { method: string; message: string; ref: string; at: number };
let last: RpcErr | null = null;
/** store.ts records each failed call */
export const noteRpcError = (method: string, message: string, ref?: string) => { if (ref) last = { method, message, ref, at: Date.now() }; };
/** the failed call behind a toast message, when it is fresh enough to explain */
export const explainableError = (message: string): RpcErr | null => (last && last.message === message && Date.now() - last.at < 20_000 ? last : null);
