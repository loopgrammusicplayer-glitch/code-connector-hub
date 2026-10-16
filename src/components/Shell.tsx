import { Link, useNavigate } from "@tanstack/react-router";
import { Bell, Bookmark, CalendarDays, Compass, Gamepad2, Home, Mail, Search, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { setState, useStore, getState } from "@/lib/store";
import { dueAlerts } from "@/lib/taste";
import { autoLowData, isSlowNetwork } from "@/lib/speed";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { prefetchDiscover } from "@/components/Browse";

const NAV = [
  { to: "/", label: "Home", icon: Home },
  { to: "/explore", label: "Explore", icon: Compass },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/watchlist", label: "Saved", icon: Bookmark },
  { to: "/game", label: "Game", icon: Gamepad2 },
] as const;

function useAlerts() {
  useEffect(() => {
    const s = getState();
    const today = new Date().toISOString().slice(0, 10);
    const due = dueAlerts(s.watchlist, s.seenAlerts, today);
    if (!due.length) return;
    setState((st) => ({
      ...st,
      seenAlerts: [...st.seenAlerts, ...due.map((d) => `${d.key}@${d.date}`)].slice(-1000),
      alerts: [...due.map((d) => ({ key: d.key, text: `${d.title} releases ${d.date === today ? "today" : d.date}`, at: Date.now() })), ...st.alerts].slice(0, 50),
    }));
    if ("Notification" in window && Notification.permission === "granted")
      for (const d of due.slice(0, 3)) new Notification("LOOPGRAM release alert", { body: `${d.title} — ${d.date}` });
  }, []);
}

export function Shell({ children }: { children: React.ReactNode }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const lowData = useStore((s) => s.lowData);
  const alertCount = useStore((s) => s.alerts.length);
  const [offline, setOffline] = useState(false);
  useAlerts();
  useEffect(() => {
    const on = () => setOffline(!navigator.onLine);
    autoLowData();
    // Background warm-up of Game + Explore data (same query keys as those pages) so they open instantly.
    const warm = setTimeout(() => {
      if (isSlowNetwork()) return;
      void qc.prefetchQuery({ queryKey: ["game"], queryFn: () => api({ a: "game" }), staleTime: 30 * 60_000 });
      void qc.prefetchQuery({ queryKey: ["genres"], queryFn: () => api({ a: "genres" }), staleTime: Infinity });
      prefetchDiscover(qc, "movie", "popularity.desc");
    }, 1500);
    on(); addEventListener("online", on); addEventListener("offline", on);
    if ("serviceWorker" in navigator) {
      const h = location.hostname;
      const blocked = !import.meta.env.PROD || window.self !== window.top || /^(id-)?preview--/.test(h) || /(^|\.)lovableproject(-dev)?\.com$/.test(h) || /(^|\.)beta\.lovable\.dev$/.test(h) || new URLSearchParams(location.search).get("sw") === "off";
      if (blocked) navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.active?.scriptURL.endsWith("/sw.js") && r.unregister())).catch(() => {});
      else navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    return () => { clearTimeout(warm); removeEventListener("online", on); removeEventListener("offline", on); };
  }, []);
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
        <Link to="/" className="flex items-center gap-1.5 text-lg font-black tracking-tight" aria-label="LOOPGRAM home">
          <span className="flex h-7 w-9 items-center justify-center rounded-md bg-primary text-xs text-primary-foreground">▶</span>LOOPGRAM
        </Link>
        <form className="mx-auto hidden max-w-xl flex-1 md:flex" onSubmit={(e) => { e.preventDefault(); if (q.trim()) nav({ to: "/search", search: { q: q.trim() } }); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search movies, TV, people" aria-label="Search"
            className="h-10 flex-1 rounded-l-full border bg-background px-4 text-sm outline-none focus:border-ring" />
          <button className="h-10 rounded-r-full border border-l-0 bg-secondary px-5" aria-label="Submit search"><Search className="h-4 w-4" /></button>
        </form>
        <div className="ml-auto flex items-center gap-1 md:ml-0">
          <Link to="/search" search={{ q: "" }} className="rounded-full p-2 hover:bg-accent md:hidden" aria-label="Search"><Search className="h-5 w-5" /></Link>
          <button onClick={() => setState((s) => ({ ...s, lowData: !s.lowData }))} className="rounded-full p-2 hover:bg-accent" aria-pressed={lowData} aria-label={lowData ? "Low-data mode on" : "Low-data mode off"} title="Low-data mode">
            {lowData ? <WifiOff className="h-5 w-5" /> : <Wifi className="h-5 w-5" />}
          </button>
          <Link to="/watchlist" className="relative rounded-full p-2 hover:bg-accent" aria-label={`Alerts (${alertCount})`}>
            <Bell className="h-5 w-5" />{alertCount > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" />}
          </Link>
        </div>
      </header>
      <div className="flex">
        <nav className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-20 shrink-0 flex-col items-center gap-1 pt-2 md:flex" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} className="flex w-16 flex-col items-center gap-1 rounded-lg py-3 text-[10px] hover:bg-accent" activeProps={{ className: "bg-accent font-bold" }} activeOptions={{ exact: n.to === "/" }}>
              <n.icon className="h-5 w-5" />{n.label}
            </Link>
          ))}
          <Link to="/az" className="flex w-16 flex-col items-center gap-1 rounded-lg py-3 text-[10px] hover:bg-accent" activeProps={{ className: "bg-accent font-bold" }}>A–Z</Link>
          <Link to="/compare" className="flex w-16 flex-col items-center gap-1 rounded-lg py-3 text-[10px] hover:bg-accent" activeProps={{ className: "bg-accent font-bold" }}>Compare</Link>
        </nav>
        <main className="min-w-0 flex-1">
          {offline && <p className="bg-secondary px-4 py-2 text-center text-xs">You're offline. Showing saved content where available.</p>}
          {children}
        </main>
      </div>
      <footer className="mt-8 border-t" aria-label="Contact LOOPGRAM">
        <div className="flex items-center justify-center gap-2 px-4 py-3">
          <a href="https://wa.me/256758630994" target="_blank" rel="noopener noreferrer" aria-label="Contact LOOPGRAM on WhatsApp"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:bg-accent">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-5 w-5"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" /></svg>
          </a>
          <a href="mailto:loopgramofficial@gmail.com" aria-label="Email LOOPGRAM"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:bg-accent">
            <Mail className="h-5 w-5" aria-hidden />
          </a>
        </div>
        <div aria-hidden className="md:hidden" style={{ height: "calc(4rem + env(safe-area-inset-bottom))" }} />
      </footer>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-background/95 backdrop-blur md:hidden" aria-label="Main mobile" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {NAV.map((n) => (
          <Link key={n.to} to={n.to} className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] text-muted-foreground" activeProps={{ className: "!text-foreground font-bold" }} activeOptions={{ exact: n.to === "/" }}>
            <n.icon className="h-5 w-5" />{n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
