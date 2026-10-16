import { toast } from "sonner";

function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Native share sheet when available; otherwise copy the link. Always gives visible feedback. */
export async function shareLink(opts: { title?: string; text?: string; url: string }) {
  if (navigator.share) {
    try {
      await navigator.share(opts);
      return;
    } catch (e: any) {
      if (e?.name === "AbortError") return; // user closed the sheet
    }
  }
  const payload = opts.text ? `${opts.text} ${opts.url}` : opts.url;
  try {
    await navigator.clipboard.writeText(payload);
    toast.success("Link copied");
    return;
  } catch {}
  if (legacyCopy(payload)) toast.success("Link copied");
  else toast("Copy this link", { description: payload, duration: 10000 });
}
