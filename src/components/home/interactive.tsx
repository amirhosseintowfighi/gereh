"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BTN_G, BTN_P, GLASS, GLASS_STRONG } from "@/lib/cls";
import { CPU_STEPS, DISK_STEPS, LOCS, OSES, PRESETS, RAM_STEPS, SITE_REC, TLDS, configPrice, parseDomain } from "@/lib/catalog";
import { EMAIL_RE, fa, hashStr, toman } from "@/lib/format";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { IconTile, SectionHead } from "../ui";
import { Num, Switch, Tabs, prefersReducedMotion, useInView, useTween } from "../ui-client";

/* ================= domain input ================= */
const PLACEHOLDERS = ["mybrand.ir", "cafe-online.com", "studio.io", "shop.cloud", "startup.dev"];
export function DomainInput({ value, onChange, onSearch, loading = false, big = true }: { value: string; onChange: (v: string) => void; onSearch: () => void; loading?: boolean; big?: boolean }) {
  const [ph, setPh] = useState(0);
  useEffect(() => { if (value) return; const t = setInterval(() => setPh((p) => (p + 1) % PLACEHOLDERS.length), 2200); return () => clearInterval(t); }, [value]);
  return (
    <form role="search" onSubmit={(e) => { e.preventDefault(); onSearch(); }}
      className="flex items-center gap-2 rounded-2xl bg-black/20 border border-white/15 p-1.5 focus-within:border-white/40 focus-within:bg-black/25 transition">
      <span className="hidden sm:grid w-10 place-items-center text-white/50"><Icon name="globe" size={20} /></span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} dir="ltr" placeholder={PLACEHOLDERS[ph]} aria-label="نام دامنه" autoCapitalize="none" autoCorrect="off" spellCheck={false}
        className={"flex-1 min-w-0 bg-transparent outline-none placeholder:text-white/30 text-left px-3 " + (big ? "h-12 text-lg" : "h-11")} />
      <button type="submit" disabled={loading} className={BTN_P + " px-5 sm:px-7 " + (big ? "h-12" : "h-11")}>
        <Icon name={loading ? "loader-circle" : "search"} size={18} className={loading ? "animate-spin" : ""} /> <span>بررسی</span>
      </button>
    </form>
  );
}
export function DomainSearchBox({ big = false }: { big?: boolean }) {
  const { searchDomain } = useApp();
  const [q, setQ] = useState("");
  return <DomainInput big={big} value={q} onChange={setQ} onSearch={() => searchDomain(q)} />;
}

/* ================= live provisioning terminal ================= */
const TERM_PLANS = [
  { id: "base", label: "پایه", spec: "2 vCPU / 4 GB RAM / 80 GB NVMe", flag: "std-2" },
  { id: "pro", label: "حرفه‌ای", spec: "4 vCPU / 8 GB RAM / 160 GB NVMe", flag: "pro-4" },
  { id: "ent", label: "سازمانی", spec: "8 vCPU / 16 GB RAM / 320 GB NVMe", flag: "ent-8" },
];
export function Terminal() {
  const [plan, setPlan] = useState("pro");
  const [run, setRun] = useState(0);
  const [typed, setTyped] = useState("");
  const [lines, setLines] = useState<[string, number][]>([]);
  const [sec, setSec] = useState(0);
  const [done, setDone] = useState(false);
  const p = TERM_PLANS.find((x) => x.id === plan)!;
  const cmd = "gereh server create --plan " + p.flag + " --region thr-1 --image ubuntu-24.04";
  useEffect(() => {
    const steps: [string, number][] = [
      ["allocating " + p.spec, 8], ["provisioning NVMe Gen4 volume", 11], ["attaching network, IPv4 + IPv6", 9],
      ["applying firewall and DDoS shield", 7], ["booting Ubuntu 24.04 LTS", 14], ["health checks passed", 5],
    ];
    let alive = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const T = (fn: () => void, ms: number) => timers.push(setTimeout(() => alive && fn(), ms));
    T(() => { setTyped(""); setLines([]); setSec(0); setDone(false); }, 0);
    if (prefersReducedMotion()) { T(() => { setTyped(cmd); setLines(steps); setSec(54); setDone(true); }, 0); return () => { alive = false; timers.forEach(clearTimeout); }; }
    let t = 350;
    for (let i = 1; i <= cmd.length; i++) { const s = cmd.slice(0, i); T(() => setTyped(s), t); t += 18; }
    t += 220; let acc = 0;
    steps.forEach((st) => { t += 360; acc += st[1]; const target = acc; T(() => { setLines((l) => [...l, st]); setSec(target); }, t); });
    T(() => setDone(true), t + 320);
    return () => { alive = false; timers.forEach(clearTimeout); };
  }, [run, cmd, p.spec]);
  const s = useTween(sec, 340);
  const mmss = "00:" + String(Math.round(s)).padStart(2, "0");
  return (
    <div className="relative">
      <div className="absolute -inset-10 rounded-[3rem] pointer-events-none" style={{ background: "radial-gradient(closest-side, rgba(125,180,255,.16), transparent)" }} />
      <div className={GLASS_STRONG + " relative rounded-[1.4rem] overflow-hidden shadow-[0_40px_120px_-30px_rgba(0,0,0,.9)]"}>
        <div className="flex items-center justify-between px-4 h-11 border-b border-white/[0.08] bg-white/[0.03]" dir="ltr">
          <div className="flex gap-2" aria-hidden="true">{["#ff5f57", "#febc2e", "#28c840"].map((c) => <span key={c} className="w-3 h-3 rounded-full" style={{ background: c, opacity: 0.85 }} />)}</div>
          <span className="mono text-[11px] text-white/45">gereh-cli — thr-1</span>
          <span className={"mono text-[11px] tabular " + (done ? "text-emerald-300" : "text-white/60")}>{mmss}</span>
        </div>
        <div className="mono text-[12.5px] leading-[1.9] p-5 h-[300px] sm:h-[318px] overflow-hidden" dir="ltr" aria-label="نمایش ساخت سرور در ترمینال" role="img">
          <div className="text-white/90 break-all"><span className="text-[#9cc9ff]">~</span> <span className="text-white/40">$</span> {typed}{!lines.length && <span className="caret" />}</div>
          {lines.map((l, i) => (
            <div key={i} className="line-in flex justify-between gap-3">
              <span className="text-white/70 truncate"><span className="text-emerald-300">✓</span> {l[0]}</span>
              <span className="text-white/25 shrink-0">+{l[1]}s</span>
            </div>
          ))}
          {lines.length > 0 && !done && <div className="text-white/40 flex items-center gap-2"><Icon name="loader-circle" size={13} className="animate-spin" /> working…</div>}
          {done && (
            <div className="line-in mt-2">
              <div className="text-white"><span className="text-emerald-300">●</span> server ready in <span className="text-[#9cc9ff]">54s</span>  ip 185.143.232.17</div>
              <div className="text-white/90 mt-1"><span className="text-[#9cc9ff]">~</span> <span className="text-white/40">$</span> ssh root@185.143.232.17<span className="caret ml-1" /></div>
            </div>
          )}
        </div>
        <div className="h-[2px] bg-white/[0.06]"><div className="h-full acc-bg transition-all duration-300" style={{ width: (sec / 54) * 100 + "%" }} /></div>
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-white/[0.02]">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar" role="group" aria-label="پلن نمونه">
            {TERM_PLANS.map((x) => (
              <button type="button" key={x.id} onClick={() => setPlan(x.id)} aria-pressed={plan === x.id}
                className={"px-3 h-8 rounded-lg text-xs whitespace-nowrap transition " + (plan === x.id ? "bg-white text-slate-900 font-bold" : "text-white/60 hover:text-white hover:bg-white/[0.07]")}>{x.label}</button>
            ))}
          </div>
          <button type="button" onClick={() => setRun((r) => r + 1)} className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white transition shrink-0">
            <Icon name="refresh-cw" size={14} /> اجرای دوباره
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================= quick start ================= */
export function QuickStart() {
  const { searchDomain, addToCart } = useApp();
  const [tab, setTab] = useState("domain");
  const [q, setQ] = useState("");
  const [preset, setPreset] = useState("p2");
  const [sites, setSites] = useState("3");
  const pr = PRESETS.find((p) => p.id === preset)!;
  const prPrice = configPrice({ cpu: pr.cpu, ram: pr.ram, disk: pr.disk, loc: "thr", os: "ubuntu", ips: 0, backup: false });
  const rec = SITE_REC.find((s) => s.id === sites)!.plan;
  const parsed = parseDomain(q);
  const baseName = "name" in parsed && parsed.name ? parsed.name : "mybrand";
  return (
    <section aria-label="شروع سریع" className="max-w-4xl mx-auto px-4 sm:px-6 pb-24">
      <div className={GLASS_STRONG + " rounded-[1.6rem] p-2.5 sm:p-3"}>
        <Tabs full value={tab} onChange={setTab} label="نوع سرویس" options={[
          { id: "domain", label: "دامنه", icon: "globe" }, { id: "server", label: "سرور ابری", icon: "server" }, { id: "hosting", label: "هاست", icon: "layers" },
        ]} />
        <div className="p-2 sm:p-3 pt-4" role="tabpanel">
          {tab === "domain" && (
            <div key="d" className="fade-in">
              <DomainInput value={q} onChange={setQ} onSearch={() => searchDomain(q)} />
              <div className="mt-3 flex flex-wrap gap-2 justify-center">
                {[".ir", ".com", ".io", ".cloud", ".dev"].map((t) => {
                  const d = TLDS.find((x) => x.tld === t)!;
                  return (
                    <button type="button" key={t} onClick={() => searchDomain(baseName + t)}
                      className="rounded-lg px-3 py-1.5 text-xs flex items-center gap-2 bg-white/[0.04] border border-white/10 hover:bg-white/[0.09] hover:border-white/20 transition">
                      <span className="font-black ltr">{t}</span><span className="text-white/50 tabular">{toman(d.reg)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {tab === "server" && (
            <div key="s" className="fade-in">
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="پیکربندی آماده">
                {PRESETS.map((p) => (
                  <button type="button" role="radio" key={p.id} onClick={() => setPreset(p.id)} aria-checked={preset === p.id}
                    className={"rounded-xl p-3 text-right border transition " + (preset === p.id ? "bg-white/[0.1] border-white/30" : "bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.06]")}>
                    <div className="flex items-center justify-between">
                      <span className="font-extrabold text-sm">{p.name}</span>
                      <span className={"w-4 h-4 rounded-full border-2 grid place-items-center " + (preset === p.id ? "border-white" : "border-white/25")}>{preset === p.id && <span className="w-1.5 h-1.5 rounded-full bg-white" />}</span>
                    </div>
                    <div className="text-[11px] text-white/50 mt-1.5 leading-5">{fa(p.cpu)} هسته، {fa(p.ram)} گیگ رم</div>
                    <div className="text-[11px] text-white/35 hidden sm:block">{p.use}</div>
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 rounded-xl bg-black/30 border border-white/[0.08] p-3">
                <div className="flex items-center gap-3">
                  <Icon name="timer" size={20} className="acc" />
                  <div><div className="text-[11px] text-white/45">آماده در ۵۵ ثانیه، تهران</div>
                    <div className="font-black text-lg tabular"><Num value={prPrice} /> <span className="text-xs font-normal text-white/45">تومان / ماه</span></div></div>
                </div>
                <div className="flex gap-2">
                  <a href="#builder" className={BTN_G + " px-4 h-11 text-sm flex-1 sm:flex-none"}><Icon name="sliders-horizontal" size={16} /> سفارشی‌سازی</a>
                  <button type="button" onClick={() => addToCart({ title: "سرور ابری " + pr.name, meta: fa(pr.cpu) + " هسته، " + fa(pr.ram) + " گیگ رم، " + fa(pr.disk) + " گیگ NVMe، تهران", base: prPrice, icon: "server" })}
                    className={BTN_P + " px-5 h-11 text-sm flex-1 sm:flex-none"}><Icon name="plus" size={16} /> افزودن</button>
                </div>
              </div>
            </div>
          )}
          {tab === "hosting" && (
            <div key="h" className="fade-in">
              <div className="text-sm text-white/60 mb-2.5 text-center">چند وب‌سایت دارید؟</div>
              <div className="flex justify-center"><Tabs size="sm" value={sites} onChange={setSites} label="تعداد سایت" options={SITE_REC.map((s) => ({ id: s.id, label: s.label }))} /></div>
              <div className="mt-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 rounded-xl bg-black/30 border border-white/[0.08] p-3">
                <div className="flex items-center gap-3">
                  <IconTile name="layers" size={18} cls="w-10 h-10 rounded-xl" />
                  <div><div className="text-[11px] text-white/45">پیشنهاد ما: هاست {rec.name}</div><div className="text-xs text-white/65 mt-0.5">{rec.disk}، ترافیک {rec.traffic}</div></div>
                </div>
                <div className="flex items-center gap-3 justify-between">
                  <div className="font-black tabular"><Num value={rec.price} /> <span className="text-xs font-normal text-white/45">تومان / ماه</span></div>
                  <button type="button" onClick={() => addToCart({ title: "هاست " + rec.name, meta: "لینوکس، پرداخت ماهانه", base: rec.price, icon: "layers" })} className={BTN_P + " px-5 h-11 text-sm"}><Icon name="plus" size={16} /> افزودن</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ================= hardware: the chip ================= */
const CPUS = [
  { id: "epyc", tab: "EPYC 7443P", name: "AMD EPYC 7443P", cores: 24, threads: 48, boost: 4.0, cache: 128, ram: 256, port: 10, plan: "BM-3" },
  { id: "xs", tab: "Xeon Silver", name: "Intel Xeon Silver 4314", cores: 16, threads: 32, boost: 3.4, cache: 24, ram: 128, port: 1, plan: "BM-2" },
  { id: "xe", tab: "Xeon E", name: "Intel Xeon E-2388G", cores: 8, threads: 16, boost: 5.1, cache: 16, ram: 64, port: 1, plan: "BM-1" },
];
export function Hardware() {
  const [cpu, setCpu] = useState("epyc");
  const [hover, setHover] = useState<number | null>(null);
  const [ref, seen] = useInView<HTMLElement>(0.3);
  const c = CPUS.find((x) => x.id === cpu)!;
  const COLS = 6, ROWS = 4, CS = 34, GAP = 8, gx = 58, gy = 70;
  const specs = [
    { v: c.cores, l: "هسته فیزیکی" }, { v: c.threads, l: "رشته پردازشی" }, { v: c.boost, d: 1, u: "GHz", l: "فرکانس بوست" },
    { v: c.cache, u: "MB", l: "حافظه کش L3" }, { v: c.ram, u: "GB", l: "رم ECC" }, { v: c.port, u: "Gbps", l: "پورت شبکه" },
  ];
  return (
    <section ref={ref} className="max-w-6xl mx-auto px-4 sm:px-6 pb-28">
      <SectionHead title="قدرت خام، بدون اغراق" sub="سخت‌افزار سرورهای اختصاصی گره. پردازنده را انتخاب کنید؛ هر هسته روشن، یک هسته واقعی است که فقط مال شماست." />
      <div className="flex justify-center mb-10"><Tabs value={cpu} onChange={setCpu} label="پردازنده" options={CPUS.map((x) => ({ id: x.id, label: x.tab }))} /></div>
      <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
        <div className="relative">
          <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(closest-side, rgba(125,180,255,.22), transparent 75%)" }} />
          <svg viewBox="0 0 360 300" className="relative w-full max-w-[460px] mx-auto block" role="img" aria-label={"نمای پردازنده " + c.name}>
            <defs>
              <linearGradient id="pkg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1b2030" /><stop offset="1" stopColor="#0a0d16" /></linearGradient>
              <linearGradient id="pkgEdge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="rgba(255,255,255,.35)" /><stop offset=".5" stopColor="rgba(255,255,255,.06)" /><stop offset="1" stopColor="rgba(255,255,255,.22)" /></linearGradient>
              <linearGradient id="coreGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e0e7ff" /><stop offset="1" stopColor="#7dd3fc" /></linearGradient>
              <linearGradient id="scanGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="rgba(156,201,255,0)" /><stop offset=".85" stopColor="rgba(156,201,255,0)" /><stop offset=".97" stopColor="rgba(156,201,255,.28)" /><stop offset="1" stopColor="rgba(156,201,255,0)" /></linearGradient>
              <clipPath id="dieClip"><rect x="50" y="56" width="260" height="188" rx="12" /></clipPath>
            </defs>
            {Array.from({ length: 22 }, (_, i) => <g key={"p" + i}>
              <rect x={34 + i * 13.6} y="8" width="5" height="12" rx="1.5" fill="rgba(255,255,255,.16)" />
              <rect x={34 + i * 13.6} y="280" width="5" height="12" rx="1.5" fill="rgba(255,255,255,.16)" />
            </g>)}
            {Array.from({ length: 17 }, (_, i) => <g key={"q" + i}>
              <rect x="8" y={36 + i * 13.6} width="12" height="5" rx="1.5" fill="rgba(255,255,255,.16)" />
              <rect x="340" y={36 + i * 13.6} width="12" height="5" rx="1.5" fill="rgba(255,255,255,.16)" />
            </g>)}
            <rect x="20" y="20" width="320" height="260" rx="22" fill="url(#pkg)" stroke="url(#pkgEdge)" strokeWidth="1.2" />
            <rect x="50" y="56" width="260" height="188" rx="12" fill="#070912" stroke="rgba(255,255,255,.1)" />
            <text x="180" y="42" textAnchor="middle" fill="rgba(255,255,255,.45)" fontSize="10" fontFamily="monospace" letterSpacing="2">{c.name.toUpperCase()}</text>
            {Array.from({ length: COLS * ROWS }, (_, i) => {
              const col = i % COLS, row = Math.floor(i / COLS), on = seen && i < c.cores;
              return <rect key={"c" + i} className={"core" + (on ? " on" : "")} x={gx + col * (CS + GAP)} y={gy + row * (CS + GAP)} width={CS} height={CS} rx="6"
                fill="rgba(255,255,255,.05)" stroke={on ? "rgba(255,255,255,.35)" : "rgba(255,255,255,.07)"}
                style={{ transitionDelay: i * 22 + "ms", opacity: on ? 1 : 0.55 }}
                onMouseEnter={() => on && setHover(i)} onMouseLeave={() => setHover(null)} />;
            })}
            <g clipPath="url(#dieClip)" pointerEvents="none">
              <rect className="scan" x="50" y="56" width="260" height="188" style={{ transformBox: "fill-box" }} fill="url(#scanGrad)" />
            </g>
          </svg>
          <div className="text-center text-xs text-white/45 mt-4 h-5">{hover !== null ? "هسته " + fa(hover + 1) + " از " + fa(c.cores) + "، اختصاصی و بدون اشتراک" : "نشانگر را روی هسته‌ها ببرید"}</div>
        </div>
        <div>
          <div className="mono text-xs text-white/40 ltr text-right">{c.name}</div>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-9 mt-6">
            {specs.map((s) => (
              <div key={s.l} className="flex flex-col-reverse">
                <dt className="text-sm text-white/55">{s.l}</dt>
                <dd>
                  <div className="flex items-baseline gap-1.5">
                    <Num value={seen ? s.v : 0} d={s.d || 0} className="text-4xl sm:text-5xl font-black tracking-tight silver tabular" />
                    {s.u && <span className="text-xs text-white/40 ltr">{s.u}</span>}
                  </div>
                  <div className="hairline my-3 opacity-60" />
                </dd>
              </div>
            ))}
          </dl>
          <Link href="/vps#dedicated" className={BTN_G + " mt-10 px-5 h-11 text-sm"}>سرور اختصاصی {c.plan} را ببینید <Icon name="arrow-left" size={16} /></Link>
        </div>
      </div>
    </section>
  );
}

/* ================= live spark (decorative) ================= */
export function LiveSpark({ h = 70 }: { h?: number }) {
  const [pts, setPts] = useState(() => Array.from({ length: 32 }, (_, i) => 36 + Math.sin(i / 3) * 12 + (hashStr("s" + i) % 10)));
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const t = setInterval(() => setPts((p) => [...p.slice(1), Math.max(8, Math.min(92, p[p.length - 1] + (Math.random() - 0.5) * 22))]), 900);
    return () => clearInterval(t);
  }, []);
  const w = 320, step = w / (pts.length - 1);
  const line = pts.map((v, i) => (i ? "L" : "M") + (i * step).toFixed(1) + " " + (h - (v / 100) * h).toFixed(1)).join(" ");
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-white/55 mb-2">
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> بار پردازنده، نمونه زنده</span>
        <span className="font-bold text-white/85 tabular">{fa(Math.round(pts[pts.length - 1]))}٪</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full" style={{ height: h }} aria-hidden="true">
        <defs><linearGradient id="spk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7dd3fc" stopOpacity="0.45" /><stop offset="1" stopColor="#7dd3fc" stopOpacity="0" /></linearGradient></defs>
        <path d={`${line} L ${w} ${h} L 0 ${h} Z`} fill="url(#spk)" />
        <path d={line} fill="none" stroke="#7dd3fc" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

/* ================= server builder ================= */
function Slider({ icon, label, steps, idx, setIdx, fmt }: { icon: string; label: string; steps: number[]; idx: number; setIdx: (i: number) => void; fmt: string }) {
  const fill = (idx / (steps.length - 1)) * 100;
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="flex items-center gap-2 text-sm text-white/75"><Icon name={icon} size={17} className="acc" />{label}</span>
        <span className="font-black text-lg"><Num value={steps[idx]} /> <span className="text-xs font-normal text-white/55">{fmt}</span></span>
      </div>
      <input type="range" dir="rtl" className="rng" min="0" max={steps.length - 1} step="1" value={idx}
        onChange={(e) => setIdx(+e.target.value)} aria-label={label} aria-valuetext={fa(steps[idx]) + " " + fmt} style={{ "--fill": fill + "%" } as React.CSSProperties} />
      <div className="flex justify-between text-[10px] text-white/35 mt-2"><span>{fa(steps[0])}</span><span>{fa(steps[steps.length - 1])}</span></div>
    </div>
  );
}

export function Builder({ id = "builder" }: { id?: string }) {
  const { addToCart } = useApp();
  const [ci, setCi] = useState(2), [ri, setRi] = useState(3), [di, setDi] = useState(4);
  const [loc, setLoc] = useState("thr"), [os, setOs] = useState("ubuntu");
  const [backup, setBackup] = useState(true), [ips, setIps] = useState(0);
  const cfg = { cpu: CPU_STEPS[ci], ram: RAM_STEPS[ri], disk: DISK_STEPS[di], loc, os, ips, backup };
  const final = configPrice(cfg);
  const locObj = LOCS.find((l) => l.id === loc)!;
  const tier = cfg.cpu >= 16 ? "سنگین" : cfg.cpu >= 6 ? "حرفه‌ای" : cfg.cpu >= 2 ? "متعادل" : "سبک";
  const lines = [
    ["پردازنده", fa(cfg.cpu) + " هسته"], ["حافظه", fa(cfg.ram) + " گیگابایت"], ["فضا", fa(cfg.disk) + " گیگ NVMe"],
    ["موقعیت", locObj.label], ["سیستم‌عامل", OSES.find((o) => o.id === os)!.label], ["بکاپ روزانه", backup ? "فعال" : "غیرفعال"],
    ...(ips ? [["آی‌پی اضافه", fa(ips) + " عدد"]] : []),
  ];
  return (
    <section id={id} className="max-w-6xl mx-auto px-4 sm:px-6 pb-24 scroll-mt-28">
      <SectionHead title="سرورتان را خودتان بسازید" sub="منابع را جابه‌جا کنید و قیمت را همان لحظه ببینید. هر زمان بعد از خرید هم قابل تغییر است." />
      <div className="grid lg:grid-cols-[1fr_380px] gap-5 items-start">
        <div className={GLASS + " rounded-[1.75rem] p-5 sm:p-8 space-y-8"}>
          <Slider icon="cpu" label="پردازنده" steps={CPU_STEPS} idx={ci} setIdx={setCi} fmt="هسته" />
          <Slider icon="memory-stick" label="حافظه رم" steps={RAM_STEPS} idx={ri} setIdx={setRi} fmt="گیگابایت" />
          <Slider icon="hard-drive" label="فضای NVMe" steps={DISK_STEPS} idx={di} setIdx={setDi} fmt="گیگابایت" />
          <fieldset>
            <legend className="text-sm text-white/75 mb-3 flex items-center gap-2"><Icon name="map-pin" size={17} className="acc" /> موقعیت دیتاسنتر</legend>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {LOCS.map((l) => (
                <button type="button" key={l.id} onClick={() => setLoc(l.id)} aria-pressed={loc === l.id}
                  className={"rounded-2xl p-3 text-right border transition " + (loc === l.id ? "bg-white/[0.16] border-white/40" : "bg-white/[0.04] border-white/10 hover:bg-white/10")}>
                  <div className="font-bold text-sm">{l.label}</div>
                  <div className="text-[11px] text-white/50 mt-1 flex items-center gap-1"><Icon name="wifi" size={12} /> پینگ {fa(l.ping)}ms{l.foreign ? "، +۱۲٪" : ""}</div>
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-sm text-white/75 mb-3 flex items-center gap-2"><Icon name="terminal" size={17} className="acc" /> سیستم‌عامل</legend>
            <div className="flex flex-wrap gap-2">
              {OSES.map((o) => (
                <button type="button" key={o.id} onClick={() => setOs(o.id)} aria-pressed={os === o.id}
                  className={"px-3.5 py-2 rounded-xl text-sm border transition ltr " + (os === o.id ? "bg-white/[0.16] border-white/40 text-white" : "bg-white/[0.04] border-white/10 text-white/70 hover:bg-white/10")}>{o.label}</button>
              ))}
            </div>
            {os === "win" && <div className="text-[11px] text-amber-200/90 mt-2.5">لایسنس ویندوز {toman(150000)} در ماه به قیمت اضافه می‌شود.</div>}
          </fieldset>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="flex items-center justify-between rounded-2xl bg-white/[0.04] border border-white/10 p-4">
              <div><div className="text-sm font-bold flex items-center gap-2"><Icon name="database-backup" size={16} className="acc" />بکاپ روزانه</div><div className="text-[11px] text-white/45 mt-1">۱۴ نسخه، در دیتاسنتر دوم</div></div>
              <Switch on={backup} onChange={setBackup} label="بکاپ روزانه" />
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-white/[0.04] border border-white/10 p-4">
              <div><div className="text-sm font-bold flex items-center gap-2"><Icon name="hash" size={16} className="acc" />آی‌پی اضافه</div><div className="text-[11px] text-white/45 mt-1">{toman(120000)} برای هر آی‌پی</div></div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setIps((i) => Math.max(0, i - 1))} disabled={ips === 0} className="w-8 h-8 rounded-lg bg-white/10 border border-white/15 grid place-items-center hover:bg-white/20 disabled:opacity-40" aria-label="کم کردن آی‌پی"><Icon name="minus" size={15} /></button>
                <span className="w-6 text-center font-black" aria-live="polite">{fa(ips)}</span>
                <button type="button" onClick={() => setIps((i) => Math.min(8, i + 1))} disabled={ips === 8} className="w-8 h-8 rounded-lg bg-white/10 border border-white/15 grid place-items-center hover:bg-white/20 disabled:opacity-40" aria-label="افزودن آی‌پی"><Icon name="plus" size={15} /></button>
              </div>
            </div>
          </div>
        </div>

        <aside className={GLASS_STRONG + " rounded-[1.75rem] p-6 lg:sticky lg:top-28 shadow-[0_30px_80px_-30px_rgba(0,0,0,.9)]"} aria-label="خلاصه سفارش">
          <div className="flex items-center justify-between">
            <span className="text-sm text-white/60">سرور شما</span>
            <span className="text-[11px] px-2.5 py-1 rounded-full bg-white/10 border border-white/15">کلاس {tier}</span>
          </div>
          <div className="mt-4 space-y-3" aria-hidden="true">
            {([["cpu", ci / (CPU_STEPS.length - 1)], ["memory-stick", ri / (RAM_STEPS.length - 1)], ["hard-drive", di / (DISK_STEPS.length - 1)]] as const).map(([ic, v]) => (
              <div key={ic} className="flex items-center gap-3">
                <Icon name={ic} size={15} className="text-white/45" />
                <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full acc-bg transition-all duration-500" style={{ width: Math.max(6, v * 100) + "%" }} /></div>
              </div>
            ))}
          </div>
          <dl className="mt-6 space-y-2.5 text-sm">
            {lines.map(([k, v]) => <div key={k} className="flex justify-between"><dt className="text-white/50">{k}</dt><dd className="font-medium">{v}</dd></div>)}
          </dl>
          <div className="mt-6 pt-5 border-t border-white/15">
            <div className="flex items-baseline gap-2"><Num value={final} className="text-4xl font-black tracking-tight silver tabular" /><span className="text-sm text-white/55">تومان / ماه</span></div>
            <div className="text-[11px] text-white/45 mt-1">معادل ساعتی حدود {toman(Math.round(final / 720 / 10) * 10)}</div>
          </div>
          <button type="button" onClick={() => addToCart({ title: "سرور ابری سفارشی", meta: fa(cfg.cpu) + " هسته، " + fa(cfg.ram) + " گیگ رم، " + fa(cfg.disk) + " گیگ NVMe، " + locObj.label + (ips ? "، " + fa(ips) + " آی‌پی اضافه" : "") + (backup ? "، بکاپ روزانه" : ""), base: final, icon: "server" })}
            className={BTN_P + " w-full mt-5 py-3.5"}><Icon name="rocket" size={18} /> ساخت این سرور</button>
        </aside>
      </div>
    </section>
  );
}

/* ================= network status & speed test (illustrative) ================= */
const uptimeDays = (seed: string) => Array.from({ length: 60 }, (_, i) => { const h = hashStr(seed + i) % 100; return h < 3 ? "warn" : h < 4 ? "down" : "ok"; });
export function Network() {
  const [sel, setSel] = useState("thr");
  const loc = LOCS.find((l) => l.id === sel)!;
  const [pings, setPings] = useState<Record<string, number>>(() => Object.fromEntries(LOCS.map((l) => [l.id, l.ping])));
  const [hist, setHist] = useState<number[]>(() => Array.from({ length: 30 }, (_, i) => loc.ping + Math.sin(i / 2) * 1.5));
  const [hover, setHover] = useState<number | null>(null);
  const [test, setTest] = useState({ phase: "idle", p: 0, mbps: 0 });
  useEffect(() => {
    const t = setInterval(() => {
      const next = Object.fromEntries(LOCS.map((l) => [l.id, Math.max(1, Math.round(l.ping + (Math.random() - 0.5) * (l.ping * 0.25 + 2)))]));
      setPings(next);
      setHist((h) => [...h.slice(1), next[sel]]);
    }, 1300);
    return () => clearInterval(t);
  }, [sel]);
  const choose = (id: string) => {
    const l = LOCS.find((x) => x.id === id)!;
    setSel(id); setHist(Array.from({ length: 30 }, (_, i) => l.ping + Math.sin(i / 2) * 1.5)); setTest({ phase: "idle", p: 0, mbps: 0 });
  };
  useEffect(() => {
    if (test.phase !== "run") return;
    const t = setInterval(() => setTest((s) => {
      const p = s.p + 4;
      if (p >= 100) return { phase: "done", p: 100, mbps: Math.round(loc.speed * (0.95 + Math.random() * 0.04)) };
      return { phase: "run", p, mbps: Math.round(loc.speed * Math.min(1, p / 55) * (0.88 + Math.random() * 0.14)) };
    }), 70);
    return () => clearInterval(t);
  }, [test.phase, loc.speed]);
  const days = useMemo(() => uptimeDays(sel), [sel]);
  const maxH = Math.max(...hist) * 1.3 || 1;
  const w = 300, hh = 60, step = w / (hist.length - 1);
  const path = hist.map((v, i) => (i ? "L" : "M") + (i * step).toFixed(1) + " " + (hh - (v / maxH) * hh).toFixed(1)).join(" ");
  const R = 52, C = 2 * Math.PI * R;
  return (
    <section id="network" className="max-w-6xl mx-auto px-4 sm:px-6 pb-24 scroll-mt-28">
      <SectionHead title="شبکه‌ای که می‌توانید ببینید" sub="وضعیت دیتاسنترها را دنبال کنید و سرعت اتصال را خودتان بسنجید." />
      <div className="grid lg:grid-cols-[320px_1fr] gap-5">
        <div className="grid grid-cols-2 lg:grid-cols-1 gap-3">
          {LOCS.map((l) => (
            <button type="button" key={l.id} onClick={() => choose(l.id)} aria-pressed={sel === l.id}
              className={"spot rounded-2xl p-4 text-right border backdrop-blur-md transition " + (sel === l.id ? "bg-white/[0.16] border-white/40" : "bg-white/[0.06] border-white/15 hover:bg-white/10")}>
              <div className="flex items-center justify-between">
                <span className="font-extrabold">{l.label}</span>
                <span className="relative flex w-2.5 h-2.5" aria-label="عملیاتی"><span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-50" /><span className="relative w-2.5 h-2.5 rounded-full bg-emerald-400" /></span>
              </div>
              <div className="text-[11px] text-white/45 mt-1">{l.sub}</div>
              <div className="mt-3 flex items-baseline gap-1"><span className="font-black text-xl tabular-nums">{fa(pings[l.id])}</span><span className="text-[11px] text-white/50">ms</span></div>
            </button>
          ))}
        </div>
        <div className={GLASS + " rounded-[1.75rem] p-5 sm:p-7"}>
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-sm text-white/60"><Icon name="activity" size={16} className="acc" /> تأخیر شبکه تا {loc.label}</div>
              <div className="mt-2 flex items-baseline gap-2"><Num value={pings[sel]} className="text-5xl font-black tabular-nums" /><span className="text-white/50">میلی‌ثانیه</span></div>
              <svg viewBox={`0 0 ${w} ${hh}`} preserveAspectRatio="none" className="w-full mt-4" style={{ height: 64 }} aria-hidden="true">
                <path d={path} fill="none" stroke="#7dd3fc" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="flex flex-col items-center shrink-0">
              <div className="relative w-36 h-36">
                <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90" aria-hidden="true">
                  <circle cx="60" cy="60" r={R} stroke="rgba(255,255,255,.1)" strokeWidth="8" fill="none" />
                  <circle cx="60" cy="60" r={R} stroke="#9cc9ff" style={{ transition: "stroke-dashoffset .1s linear" }} strokeWidth="8" fill="none" strokeLinecap="round"
                    strokeDasharray={C} strokeDashoffset={C * (1 - test.p / 100)} />
                </svg>
                <div className="absolute inset-0 grid place-items-center text-center" aria-live="polite">
                  <div><div className="text-2xl font-black tabular-nums">{test.phase === "idle" ? "—" : fa(test.mbps)}</div><div className="text-[11px] text-white/50">مگابیت بر ثانیه</div></div>
                </div>
              </div>
              <button type="button" onClick={() => setTest({ phase: "run", p: 0, mbps: 0 })} disabled={test.phase === "run"} className={BTN_P + " mt-4 px-5 py-2.5 text-sm"}>
                <Icon name={test.phase === "run" ? "loader-circle" : test.phase === "done" ? "refresh-cw" : "play"} size={16} className={test.phase === "run" ? "animate-spin" : ""} />
                {test.phase === "run" ? "در حال سنجش" : test.phase === "done" ? "سنجش دوباره" : "تست سرعت"}
              </button>
            </div>
          </div>
          <div className="mt-8">
            <div className="flex items-center justify-between text-sm mb-3">
              <span className="text-white/60">آپتایم ۶۰ روز گذشته</span>
              <span className="font-bold text-emerald-300">{fa(loc.up, 3)}٪</span>
            </div>
            <div className="relative flex gap-[3px] h-10 items-stretch" onMouseLeave={() => setHover(null)}>
              {days.map((d, i) => (
                <span key={i} onMouseEnter={() => setHover(i)}
                  className={"flex-1 rounded-[3px] transition-transform origin-bottom " + (hover === i ? "scale-y-110 " : "") + (d === "ok" ? "bg-emerald-400/70 hover:bg-emerald-300" : d === "warn" ? "bg-amber-400/80" : "bg-rose-400/80")} />
              ))}
              {hover !== null && (
                <div className="absolute -top-12 pointer-events-none px-3 py-1.5 rounded-lg bg-[#0a0c14]/95 border border-white/15 text-[11px] whitespace-nowrap"
                  style={{ right: Math.min(85, Math.max(0, (hover / days.length) * 100 - 6)) + "%" }}>
                  {fa(days.length - hover)} روز پیش، {days[hover] === "ok" ? "بدون اختلال" : days[hover] === "warn" ? "کندی کوتاه‌مدت" : "قطعی ۴ دقیقه‌ای"}
                </div>
              )}
            </div>
            <div className="flex justify-between text-[10px] text-white/35 mt-2"><span>۶۰ روز پیش</span><span>امروز</span></div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ================= performance comparison ================= */
const METRICS = [
  { id: "ttfb", label: "زمان پاسخ اولیه", unit: "میلی‌ثانیه", gereh: 110, market: 480, better: "low", d: 0 },
  { id: "load", label: "بارگذاری صفحه", unit: "ثانیه", gereh: 0.9, market: 2.8, better: "low", d: 1 },
  { id: "io", label: "سرعت دیسک", unit: "مگابایت بر ثانیه", gereh: 6800, market: 520, better: "high", d: 0 },
];
export function Performance() {
  const [m, setM] = useState("ttfb");
  const [ref, seen] = useInView<HTMLElement>(0.35);
  const met = METRICS.find((x) => x.id === m)!;
  const max = Math.max(met.gereh, met.market);
  const bar = (v: number, mine: boolean) => (
    <div className="flex items-center gap-4">
      <span className={"w-28 shrink-0 text-sm " + (mine ? "font-extrabold" : "text-white/55")}>{mine ? "گره" : "میانگین بازار"}</span>
      <div className="flex-1 h-12 rounded-2xl bg-white/[0.06] overflow-hidden">
        <div className={"h-full rounded-2xl flex items-center justify-end px-4 text-sm font-black transition-all duration-1000 ease-out " + (mine ? "acc-bg" : "bg-white/20")}
          style={{ width: seen ? Math.max(14, (v / max) * 100) + "%" : "0%" }}>{fa(v, met.d)}</div>
      </div>
    </div>
  );
  const ratio = met.better === "low" ? met.market / met.gereh : met.gereh / met.market;
  return (
    <section ref={ref} className="max-w-6xl mx-auto px-4 sm:px-6 pb-24">
      <div className={GLASS + " rounded-[2rem] p-6 sm:p-10 grid grid-cols-1 lg:grid-cols-[1fr_1.3fr] gap-10 items-center"}>
        <div>
          <h2 className="text-[1.7rem] sm:text-4xl font-black leading-[1.4]">سریع‌تر، با عدد و رقم</h2>
          <p className="mt-3 text-white/65 leading-8">میانگین اندازه‌گیری روی یک سایت وردپرسی یکسان، در شش ماه گذشته.</p>
          <div className="mt-8 flex items-baseline gap-2">
            <span className="text-6xl font-black grad-text"><Num value={seen ? ratio : 0} d={1} /></span>
            <span className="text-white/60">برابر {met.better === "low" ? "سریع‌تر" : "بیشتر"}</span>
          </div>
        </div>
        <div className="min-w-0">
          <div className="mb-6 overflow-x-auto no-scrollbar"><Tabs value={m} onChange={setM} label="شاخص" options={METRICS.map((x) => ({ id: x.id, label: x.label }))} /></div>
          <div className="space-y-3">{bar(met.gereh, true)}{bar(met.market, false)}</div>
          <div className="text-[11px] text-white/40 mt-4">واحد: {met.unit}، {met.better === "low" ? "عدد کمتر بهتر است" : "عدد بیشتر بهتر است"}</div>
        </div>
      </div>
    </section>
  );
}

/* ================= steps ================= */
const STEPS = [
  { icon: "sliders-horizontal", t: "سرویس را انتخاب کنید", d: "پلن آماده بردارید یا منابع را دقیق تنظیم کنید." },
  { icon: "fingerprint", t: "حساب بسازید و بپردازید", d: "احراز هویت در دو دقیقه، پرداخت با همه کارت‌های شتاب." },
  { icon: "rocket", t: "آنلاین شوید", d: "سرور در کمتر از یک دقیقه آماده است و اطلاعات ورود ایمیل می‌شود." },
];
export function Steps() {
  const [act, setAct] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => { if (paused || prefersReducedMotion()) return; const t = setInterval(() => setAct((a) => (a + 1) % 3), 3200); return () => clearInterval(t); }, [paused]);
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-24" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <SectionHead title="از انتخاب تا اجرا، کمتر از پنج دقیقه" />
      <ol className="relative grid md:grid-cols-3 gap-4">
        <div aria-hidden="true" className="hidden md:block absolute top-[38px] right-[16%] left-[16%] h-px bg-white/15">
          <div className="h-full acc-bg transition-all duration-700" style={{ width: (act / 2) * 100 + "%" }} />
        </div>
        {STEPS.map((s, i) => (
          <li key={i}>
            <button type="button" onClick={() => setAct(i)} aria-current={act === i ? "step" : undefined}
              className={"relative w-full h-full text-center rounded-[1.75rem] p-6 border backdrop-blur-md transition duration-500 " + (act === i ? "bg-white/[0.14] border-white/35" : "bg-white/[0.05] border-white/10 hover:bg-white/[0.08]")}>
              <span className={"relative z-10 mx-auto w-[52px] h-[52px] rounded-2xl grid place-items-center text-lg font-black transition duration-500 " + (i <= act ? "acc-bg" : "bg-[#0a0c14] border border-white/15 text-white/55")}>{fa(i + 1)}</span>
              <h3 className="mt-5 flex items-center justify-center gap-2 font-extrabold"><Icon name={s.icon} size={18} className="acc" />{s.t}</h3>
              <p className="mt-2 text-sm text-white/60 leading-7">{s.d}</p>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ================= testimonials ================= */
const REVIEWS = [
  { n: "مریم احمدی", r: "مدیر فنی، نوین‌شاپ", q: "بعد از انتقال فروشگاه به سرور ابری گره، زمان بارگذاری صفحه محصول نصف شد. در کمپین یلدا هم بدون حتی یک ثانیه قطعی گذشت." },
  { n: "رضا کریمی", r: "بنیان‌گذار، داده‌پرداز", q: "پشتیبانی واقعا فنی است. نیمه‌شب تیکت زدم و یک مهندس شبکه در کمتر از ده دقیقه مشکل مسیریابی را پیدا کرد." },
  { n: "سارا موسوی", r: "توسعه‌دهنده مستقل", q: "پنل ساده و API تمیزی دارد. سرورهای تست را با ترافورم می‌سازم و ساعتی پرداخت می‌کنم؛ دقیقا همان چیزی که می‌خواستم." },
  { n: "امید رحیمی", r: "مدیر IT، سپهر هلدینگ", q: "سرور اختصاصی EPYC را برای دیتابیس گرفتیم. پایداری در این یک سال بی‌نقص بوده و مدیر حساب‌مان معمولا پیش از ما مشکل را می‌بیند." },
];
export function Testimonials() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => { if (paused || prefersReducedMotion()) return; const t = setInterval(() => setI((x) => (x + 1) % REVIEWS.length), 5500); return () => clearInterval(t); }, [paused]);
  const r = REVIEWS[i];
  return (
    <section aria-roledescription="carousel" aria-label="نظر مشتریان" className="max-w-4xl mx-auto px-4 sm:px-6 pb-24" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <h2 className="sr-only-focusable">نظر مشتریان گره</h2>
      <figure className={GLASS + " rounded-[2rem] p-7 sm:p-12 text-center relative overflow-hidden"}>
        <Icon name="quote" size={44} className="mx-auto acc opacity-80" />
        <blockquote key={i} className="fade-in mt-6 text-lg sm:text-2xl leading-[2] font-medium text-white/90">{r.q}</blockquote>
        <figcaption key={"a" + i} className="fade-in mt-8 flex items-center justify-center gap-3">
          <span className="w-12 h-12 rounded-full acc-bg grid place-items-center font-black" aria-hidden="true">{r.n[0]}</span>
          <div className="text-right"><div className="font-extrabold">{r.n}</div><div className="text-xs text-white/50 mt-0.5">{r.r}</div></div>
        </figcaption>
        <div className="mt-8 flex items-center justify-center gap-4">
          <button type="button" onClick={() => setI((x) => (x - 1 + REVIEWS.length) % REVIEWS.length)} className="w-10 h-10 rounded-full bg-white/10 border border-white/20 grid place-items-center hover:bg-white/20" aria-label="نظر قبلی"><Icon name="chevron-right" size={18} /></button>
          <div className="flex gap-2">{REVIEWS.map((_, k) => <button type="button" key={k} onClick={() => setI(k)} aria-label={"نظر " + fa(k + 1)} aria-current={k === i} className={"h-2 rounded-full transition-all duration-500 " + (k === i ? "w-8 acc-bg" : "w-2 bg-white/25 hover:bg-white/40")} />)}</div>
          <button type="button" onClick={() => setI((x) => (x + 1) % REVIEWS.length)} className="w-10 h-10 rounded-full bg-white/10 border border-white/20 grid place-items-center hover:bg-white/20" aria-label="نظر بعدی"><Icon name="chevron-left" size={18} /></button>
        </div>
      </figure>
    </section>
  );
}

/* ================= FAQ ================= */
export function Faq({ items, id }: { items: [string, string][]; id?: string }) {
  const [open, setOpen] = useState(0);
  return (
    <div id={id} className="space-y-3 scroll-mt-28">
      {items.map(([q, a], i) => (
        <div key={q} className={"rounded-2xl overflow-hidden border backdrop-blur-md transition-colors " + (open === i ? "bg-white/[0.12] border-white/30" : "bg-white/[0.06] border-white/15")}>
          <h3>
            <button type="button" onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i} aria-controls={"faq-" + i + (id || "")} className="w-full flex items-center justify-between gap-4 p-5 text-right font-bold">
              {q}
              <span className={"w-8 h-8 shrink-0 rounded-full grid place-items-center transition duration-300 " + (open === i ? "acc-bg rotate-180" : "bg-white/10")}><Icon name="chevron-down" size={17} /></span>
            </button>
          </h3>
          <div id={"faq-" + i + (id || "")} className="grid transition-all duration-300" style={{ gridTemplateRows: open === i ? "1fr" : "0fr" }}>
            <div className="overflow-hidden"><p className="px-5 pb-5 text-white/65 leading-8 text-sm">{a}</p></div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ================= newsletter ================= */
export function Newsletter() {
  const { notify } = useApp();
  const [email, setEmail] = useState("");
  const [err, setErr] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) { setErr("یک ایمیل معتبر وارد کنید؛ مثلا name@example.com"); return; }
    // ponytail: no newsletter backend yet — POST /newsletter when it exists.
    setErr(""); setEmail(""); notify("عضو خبرنامه شدید؛ اولین ایمیل در راه است", "send");
  };
  return (
    <form onSubmit={submit} className="mt-10 max-w-md mx-auto" noValidate>
      <label htmlFor="nl-email" className="block text-sm text-white/70 mb-3">تخفیف‌ها و خبرهای فنی را ماهی یک بار بگیرید</label>
      <div className="flex gap-2 rounded-2xl bg-black/25 border border-white/20 p-1.5">
        <input id="nl-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" placeholder="name@example.com" aria-invalid={!!err} aria-describedby={err ? "nl-err" : undefined}
          className="flex-1 min-w-0 bg-transparent outline-none px-3 text-left placeholder:text-white/35" />
        <button type="submit" className={BTN_P + " px-5 h-11 text-sm"}><Icon name="send" size={16} /> عضویت</button>
      </div>
      {err && <div id="nl-err" role="alert" className="mt-2 text-xs text-rose-200 flex items-center justify-center gap-1.5"><Icon name="circle-alert" size={14} />{err}</div>}
    </form>
  );
}

