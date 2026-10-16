import { useEffect, useRef, useState } from "react";

/** Plays a full-length video from the owner's R2 bucket (MP4 or HLS). hls.js is loaded only in the browser. */
export function StreamPlayer({ url, kind, title, poster, onFail }: { url: string; kind: "hls" | "mp4"; title: string; poster?: string | null; onFail: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let hls: any;
    if (kind === "mp4" || v.canPlayType("application/vnd.apple.mpegurl")) {
      v.src = url;
    } else {
      import("hls.js").then(({ default: Hls }) => {
        if (!Hls.isSupported()) { setErr(true); return; }
        hls = new Hls();
        hls.on(Hls.Events.ERROR, (_: unknown, d: any) => { if (d?.fatal) { setErr(true); onFail(); } });
        hls.loadSource(url);
        hls.attachMedia(v);
      });
    }
    return () => hls?.destroy();
  }, [url, kind]);
  // Browsers block unmuted autoplay, so playback starts muted; the button restores sound.
  const [muted, setMuted] = useState(true);
  return (
    <div className="relative aspect-video w-full bg-muted">
      <video ref={ref} controls playsInline autoPlay muted={muted} poster={poster ?? undefined} aria-label={title} className="h-full w-full" onError={() => { setErr(true); onFail(); }} />
      {muted && !err && (
        <button type="button" onClick={() => setMuted(false)} className="absolute right-3 top-3 rounded-full bg-background/80 px-3 py-1.5 text-xs font-semibold">
          Unmute
        </button>
      )}
      {err && <div className="absolute inset-0 grid place-items-center bg-background/90 p-4 text-center text-sm">This video couldn't load. Showing the trailer instead…</div>}
    </div>
  );
}
