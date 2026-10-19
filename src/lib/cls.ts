/* Design tokens shared by the site, the customer panel and the admin panel.

   Spacing: page p-4 / sm:p-8 · card p-5 / sm:p-6 (list cards p-2 / sm:p-3 with px-3 rows, tile cards p-3 / sm:p-4) ·
            gap between cards gap-4 (gap-3 for stat rows on phones) · sections mt-4 / space-y-4 · form fields space-y-4, gap-4.
   Radius:  controls (buttons, inputs, selects) rounded-xl · cards rounded-[1.4rem] · tiles inside cards rounded-2xl · badges rounded-md.
   Text:    page title 2xl/1.9rem black · card title base extrabold · body sm · labels xs white/65 · hints 11px white/55 ·
            muted text never below white/50 (WCAG AA on the dark glass).
   Buttons: one height per size, the same for primary, ghost and danger, and the same height as an input of that size:
            BTN_SM 36px (toolbars, table rows, card headers; 14px icons) · BTN_MD 40px (default, next to inputs; 16px icons) ·
            BTN_LG 44px (full-width form submits; 16-18px icons). Square icon buttons: ICON_BTN (36px) / ICON_BTN_MD (40px). */
export const GLASS = "bg-white/[0.055] backdrop-blur-xl border border-white/[0.11] hl";
export const GLASS_SOFT = "bg-white/[0.035] backdrop-blur-xl border border-white/[0.08] hl";
export const GLASS_STRONG = "bg-white/[0.08] backdrop-blur-2xl border border-white/[0.14] hl";
export const BTN = "inline-flex items-center justify-center gap-2 shrink-0 whitespace-nowrap rounded-xl font-bold transition duration-200 active:scale-[.97] select-none disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100";
export const BTN_P = BTN + " btn-p";
export const BTN_G = BTN + " bg-white/[0.06] border border-white/[0.12] text-white hover:bg-white/[0.1] hover:border-white/25";
export const BTN_D = BTN + " bg-rose-500/15 border border-rose-400/30 text-rose-200 hover:bg-rose-500/25";
/** button sizes, appended to BTN_P / BTN_G / BTN_D: `BTN_P + BTN_MD` */
export const BTN_SM = " h-9 px-3 text-xs";
export const BTN_MD = " h-10 px-4 text-sm";
export const BTN_LG = " h-11 px-5 text-sm";
/** an input without a height, for the rare control that needs another one (`INPUT_BASE + " h-9 text-xs"`):
    two height utilities on one element resolve by stylesheet order, not by class order */
export const INPUT_BASE = "w-full rounded-xl bg-white/[0.04] border border-white/[0.12] px-3.5 text-sm outline-none placeholder:text-white/40 hover:border-white/20 focus:border-white/40 focus:bg-white/[0.06] disabled:opacity-60 transition";
/** 40px: the same height as BTN_MD, so inputs, selects and buttons line up in a row */
export const INPUT = INPUT_BASE + " h-10";
/** 36px: compact rows and toolbars, next to BTN_SM */
export const INPUT_SM = INPUT_BASE + " h-9 text-xs";
export const TEXTAREA = "w-full rounded-xl bg-white/[0.04] border border-white/[0.12] p-3.5 text-sm leading-7 outline-none placeholder:text-white/40 hover:border-white/20 focus:border-white/40 focus:bg-white/[0.06] transition resize-none";
