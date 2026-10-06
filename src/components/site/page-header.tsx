import Link from "next/link";
import { GirihField } from "../girih";
import { Icon } from "../icon";
import { IconTile } from "../ui";

export function PageHeader({ icon, title, sub, crumb }: { icon: string; title: string; sub: string; crumb: string }) {
  return (
    <div className="relative overflow-hidden">
      <GirihField />
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-10 sm:pt-14 pb-10 text-center hero-in">
        <nav aria-label="مسیر صفحه" className="flex items-center justify-center gap-2 text-xs text-white/45">
          <Link href="/" className="hover:text-white flex items-center gap-1"><Icon name="house" size={13} />خانه</Link>
          <Icon name="chevron-left" size={13} /><span className="text-white/75" aria-current="page">{crumb}</span>
        </nav>
        <div className="mt-6 mx-auto w-fit"><IconTile name={icon} size={26} cls="w-16 h-16 rounded-[1.25rem]" /></div>
        <h1 className="hero-title mt-6 text-[2.1rem] sm:text-6xl font-black leading-[1.35] tracking-tight">{title}</h1>
        <p className="mt-4 text-white/65 max-w-xl mx-auto leading-8">{sub}</p>
      </div>
    </div>
  );
}
