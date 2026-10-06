import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { Footer } from "@/components/site/footer";
import { Navbar } from "@/components/site/navbar";
import { BTN_G, BTN_P } from "@/lib/cls";

export const metadata: Metadata = { title: "صفحه پیدا نشد", robots: { index: false } };

export default function NotFound() {
  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <main id="main" className="flex-1">
        <div className="fade-page max-w-xl mx-auto px-4 py-28 text-center">
          <div className="mono text-[7rem] leading-none font-medium silver" aria-hidden="true">404</div>
          <h1 className="text-2xl font-black mt-6">این صفحه پیدا نشد</h1>
          <p className="text-white/55 mt-3">آدرس را بررسی کنید یا به صفحه اصلی برگردید.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/" className={BTN_P + " px-6 h-11"}><Icon name="house" size={17} /> صفحه اصلی</Link>
            <Link href="/vps" className={BTN_G + " px-6 h-11"}>سرور ابری</Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
