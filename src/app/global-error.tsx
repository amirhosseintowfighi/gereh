"use client";
import { useEffect } from "react";

/* Replaces the root layout when it fails, so it brings its own document and inline styles
   (globals.css, the fonts and the providers are not available here). */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <html lang="fa" dir="rtl">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#04050b", color: "#fff", fontFamily: "Vazirmatn, Tahoma, 'Segoe UI', system-ui, sans-serif" }}>
        <title>خطا | گره</title>
        <main role="alert" style={{ maxWidth: 480, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0 }}>گره بارگذاری نشد</h1>
          <p style={{ color: "rgba(255,255,255,.6)", fontSize: 14, lineHeight: 2, marginTop: 12 }}>خطایی پیش‌بینی‌نشده رخ داد. دوباره تلاش کنید.</p>
          {error.digest && <p style={{ color: "rgba(255,255,255,.5)", fontSize: 12 }}>کد خطا: <span dir="ltr" style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace" }}>{error.digest}</span></p>}
          <button type="button" onClick={() => retry()} style={{ marginTop: 20, height: 40, padding: "0 20px", borderRadius: 12, border: 0, background: "#f5f7fb", color: "#05070d", fontWeight: 700, fontSize: 14, fontFamily: "inherit", cursor: "pointer" }}>تلاش دوباره</button>
        </main>
      </body>
    </html>
  );
}
