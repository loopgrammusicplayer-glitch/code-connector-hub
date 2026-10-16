import { useEffect, useRef, useState } from "react";

/** YouTube embed that listens for player errors (100 removed/private, 101/150/153 embedding or region blocked). */
export function YouTubePlayer({ id, onFail, title = "Trailer" }: { id: string; onFail: () => void; title?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (!/youtube(-nocookie)?\.com$/.test(new URL(e.origin).hostname) || e.source !== ref.current?.contentWindow) return;
      let m: any; try { m = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch { return; }
      got = true;
      if (m?.event === "onError" && !done) { done = true; setErr(true); setTimeout(onFail, 1800); }
    };
    let got = false, done = false;
    addEventListener("message", onMsg);
    // Keep handshaking until the player answers, so errors are always reported even on slow networks.
    const t = setInterval(() => { if (got) clearInterval(t); else listen(); }, 400);
    return () => { removeEventListener("message", onMsg); clearInterval(t); };
  }, [id]);
  const listen = () => ref.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*");
  const cmd = (func: string) => ref.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args: [] }), "*");
  // Browsers block unmuted autoplay, so playback starts muted; the button restores sound.
  const [muted, setMuted] = useState(true);
  const origin = typeof location !== "undefined" ? location.origin : "";
  return (
    <div className="relative aspect-video w-full bg-black">
      <iframe ref={ref} onLoad={listen} className="h-full w-full" src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(origin)}`} title={title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      {muted && !err && (
        <button type="button" onClick={() => { cmd("unMute"); cmd("playVideo"); setMuted(false); }} className="absolute right-3 top-3 rounded-full bg-background/80 px-3 py-1.5 text-xs font-semibold">
          Unmute
        </button>
      )}
      {err && <div className="absolute inset-0 grid place-items-center bg-background/90 p-4 text-center text-sm">This video can't be played here. Trying another official video…</div>}
    </div>
  );
}
