import type { Metadata } from "next";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://gereh.net").replace(/\/$/, "");
export const SITE_NAME = "گره";
export const SITE_DESC = "سرور ابری با دیسک NVMe، سرور اختصاصی، هاست وب پرسرعت و ثبت دامنه .ir و بین‌المللی. آماده‌سازی سرور در کمتر از یک دقیقه، آپتایم ۹۹٫۹۹٪ و پشتیبانی فنی شبانه‌روزی.";
export const PHONE = "+98-21-91000000";
export const EMAIL = "hello@gereh.net";

/** Per-page metadata with canonical URL + OG/Twitter that inherit the site defaults. */
export function pageMeta({ title, description, path, en }: { title: string; description: string; path: string; en?: string }): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path, ...(en ? { languages: { "fa-IR": path, en, "x-default": path } } : {}) },
    openGraph: { title, description, url: path, type: "website", locale: "fa_IR", siteName: SITE_NAME, images: ["/og.png"] },
    twitter: { card: "summary_large_image", title, description, images: ["/og.png"] },
  };
}

export const ORG_ID = SITE_URL + "/#org";
export const orgLd = {
  "@type": "Organization",
  "@id": ORG_ID,
  name: SITE_NAME,
  alternateName: "Gereh Cloud",
  url: SITE_URL,
  logo: SITE_URL + "/icon-512.png",
  email: EMAIL,
  telephone: PHONE,
  address: { "@type": "PostalAddress", streetAddress: "خیابان ولیعصر", addressLocality: "تهران", addressCountry: "IR" },
  contactPoint: [{ "@type": "ContactPoint", telephone: PHONE, contactType: "customer support", availableLanguage: ["fa", "en"], areaServed: "IR", hoursAvailable: "Mo-Su 00:00-23:59" }],
  parentOrganization: { "@type": "Organization", name: "ویرگول", alternateName: "Virgule", url: "https://virgule.studio" },
};

export const breadcrumbLd = (items: [string, string][]) => ({
  "@type": "BreadcrumbList",
  itemListElement: [["خانه", "/"], ...items].map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: SITE_URL + path })),
});

export const faqLd = (items: [string, string][]) => ({
  "@type": "FAQPage",
  mainEntity: items.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
});

/** Toman → IRR (ISO 4217) for schema.org offers. */
export const offerLd = (name: string, description: string, prices: number[], path: string) => ({
  "@type": "Product",
  name,
  description,
  brand: { "@id": ORG_ID },
  url: SITE_URL + path,
  offers: { "@type": "AggregateOffer", priceCurrency: "IRR", lowPrice: Math.min(...prices) * 10, highPrice: Math.max(...prices) * 10, offerCount: prices.length, availability: "https://schema.org/InStock" },
});

/** English pages (/en/…): absolute title, en_US Open Graph, hreflang back to the Persian page */
export function pageMetaEn({ title, description, path, fa }: { title: string; description: string; path: string; fa: string }): Metadata {
  const full = title + " | Gereh Cloud";
  return {
    title: { absolute: full },
    description,
    alternates: { canonical: path, languages: { "fa-IR": fa, en: path, "x-default": fa } },
    openGraph: { title: full, description, url: path, type: "website", locale: "en_US", siteName: "Gereh Cloud", images: ["/og.png"] },
    twitter: { card: "summary_large_image", title: full, description, images: ["/og.png"] },
  };
}

export const EN_PAGES: [en: string, fa: string][] = [["/en", "/"], ["/en/vps", "/vps"], ["/en/hosting", "/hosting"], ["/en/domains", "/domains"], ["/en/about", "/about"], ["/en/devops", "/devops"], ["/en/paas", "/paas"]];
