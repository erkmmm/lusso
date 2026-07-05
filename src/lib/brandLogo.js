// Lusso logo for jsPDF documents. Fetched once from /brand and cached as a
// data URL; callers fall back to the text wordmark if it can't load (e.g.
// offline, or Node-side tests where fetch has no origin).
export const LOGO_ASPECT = 1593 / 467; // width / height of lusso-black.png

let cached;
export async function getLogoDataUrl() {
  if (cached !== undefined) return cached;
  try {
    const res = await fetch('/brand/lusso-black.png');
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    cached = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } catch {
    cached = null;
  }
  return cached;
}
