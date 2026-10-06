import { Navbar } from "@/components/site/navbar";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <main id="main" className="flex-1">{children}</main>
    </div>
  );
}
