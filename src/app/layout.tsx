import type { Metadata, Viewport } from "next";
import { Geist_Mono, Vazirmatn } from "next/font/google";
import { MeshBackground } from "@/components/brand";
import { JsonLd } from "@/components/json-ld";
import { AppProvider } from "@/components/providers";
import { orgLd, SITE_DESC, SITE_NAME, SITE_URL } from "@/lib/seo";
import "./globals.css";

const vazirmatn = Vazirmatn({ subsets: ["arabic", "latin"], variable: "--font-vazirmatn", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "گره | سرور ابری، هاست و دامنه", template: "%s | گره" },
  description: SITE_DESC,
  applicationName: SITE_NAME,
  keywords: ["سرور ابری", "خرید سرور مجازی", "VPS", "سرور اختصاصی", "هاست وردپرس", "هاست لینوکس", "ثبت دامنه", "دامنه ir", "گره", "gereh"],
  authors: [{ name: "ویرگول", url: "https://virgule.studio" }],
  creator: "ویرگول",
  publisher: SITE_NAME,
  alternates: { canonical: "/" },
  openGraph: { type: "website", locale: "fa_IR", siteName: SITE_NAME, url: "/", title: "گره | سرور ابری، هاست و دامنه", description: SITE_DESC, images: [{ url: "/og.png", width: 1200, height: 630, alt: "گره — سرعت ابر، استواری زمین" }] },
  twitter: { card: "summary_large_image", title: "گره | سرور ابری، هاست و دامنه", description: SITE_DESC, images: ["/og.png"] },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
  formatDetection: { telephone: false },
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }, { url: "/icon-192.png", sizes: "192x192", type: "image/png" }], apple: "/apple-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#04050b",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fa" dir="rtl" className={`${vazirmatn.variable} ${geistMono.variable}`}>
      <body className="font-sans min-h-screen">
        <a href="#main" className="sr-only-focusable fixed top-2 right-2 z-[100] rounded-xl bg-white text-slate-900 px-4 py-2 font-bold">رفتن به محتوای اصلی</a>
        <JsonLd data={[orgLd, { "@type": "WebSite", "@id": SITE_URL + "/#site", url: SITE_URL, name: SITE_NAME, inLanguage: "fa-IR", publisher: { "@id": orgLd["@id"] },
          potentialAction: { "@type": "SearchAction", target: { "@type": "EntryPoint", urlTemplate: SITE_URL + "/domains?q={search_term_string}" }, "query-input": "required name=search_term_string" } }]} />
        <MeshBackground />
        <AppProvider>
          <div className="relative z-10 min-h-screen">{children}</div>
        </AppProvider>
      </body>
    </html>
  );
}
