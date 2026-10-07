import { EnFooter } from "@/components/site/en-chrome";

/* The English site shares the root <html> (lang="fa"); this wrapper switches language and direction
   for everything inside, which is what screen readers, fonts and layout use. */
export default function EnLayout({ children }: LayoutProps<"/en">) {
  return (
    <div lang="en" dir="ltr" className="flex flex-col min-h-screen text-left">
      <main id="main" className="flex-1">{children}</main>
      <EnFooter />
    </div>
  );
}
