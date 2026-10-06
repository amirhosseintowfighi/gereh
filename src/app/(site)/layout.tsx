import { Footer } from "@/components/site/footer";
import { Navbar, ScrollChrome } from "@/components/site/navbar";

export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-col min-h-screen">
      <ScrollChrome />
      <Navbar />
      <main id="main" className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
