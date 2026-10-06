/** Post-login redirect target: only same-origin relative paths, never "//evil.com" or "/\evil.com". */
export const safeNext = (n: string | null) => (n && /^\/(?!\/)[\w\-/?=&#%.]*$/.test(n) ? n : null);
