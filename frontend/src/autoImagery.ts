import { useEffect } from "react";
import type { CameraView } from "./gis/mapApi";
import { useStore } from "./model";

const notes: Record<string, [string, string]> = {
  no_pair:["No matching radar track across the two windows. Try different dates.","مفيش لقطتين مختلفتين من نفس مسار الرادار. جرّبي تاريخين مختلفين."],
  invalid_query:["Choose a centre inside the region and an earlier day on side A for change detection.","اختاري مركز داخل منطقة الرصد وتاريخ أقدم في الجهة A لكشف التغيّر."],
  searching: [
    "Checking acquisitions at the map centre…",
    "جارٍ البحث عن لقطات تغطي مركز الخريطة…",
  ],
  overview: ["Daily regional overview.", "نظرة إقليمية من الصورة اليومية."],
  matched: ["Selected for this map scale.", "اختيرت اللقطة حسب مقياس الخريطة."],
  alternative: [
    "Another sensor supplied the usable scene.",
    "القمر البديل وفّر لقطة مناسبة.",
  ],
  cloudy: [
    "Available scene has high cloud cover.",
    "تغطية السحب مرتفعة في اللقطة المتاحة.",
  ],
  coarse_empty: [
    "No detailed scene in this window. Showing daily regional imagery.",
    "مفيش لقطة تفصيلية خلال الفترة. المعروض صورة إقليمية يومية.",
  ],
  coarse_outage: [
    "Detailed imagery service unavailable. Showing daily regional imagery.",
    "خدمة الصور التفصيلية غير متاحة. المعروض صورة إقليمية يومية.",
  ],
  no_scene: [
    "No acquisition covers the map centre in this window.",
    "لا توجد لقطة تغطي مركز الخريطة خلال الفترة المحددة.",
  ],
  no_pixels: [
    "Matching scenes contain no valid pixels at the map centre.",
    "اللقطات المتاحة لا تحتوي على بكسلات صالحة عند مركز الخريطة.",
  ],
  provider: [
    "Imagery service unavailable. Try again.",
    "تعذّر الاتصال بخدمة الصور. جرّبي مرة أخرى.",
  ],
  renderer: [
    "The provider found a scene but its image tiles are unavailable.",
    "تم العثور على لقطة لكن بلاطات الصورة غير متاحة.",
  ],
};
export const imageryNote = (code: string, ar: boolean) =>
  notes[code]?.[ar ? 1 : 0] || "";
export function useAutoImagery(camera: CameraView | null) {
  const choice = useStore((s) => s.autoImagery),
    mode = useStore((s) => s.mode);
  const lon = camera?.center[0].toFixed(4),
    lat = camera?.center[1].toFixed(4);
  const metre = camera
    ? (156543.033928 * Math.cos((camera.center[1] * Math.PI) / 180)) /
      2 ** (camera.zoom + 1)
    : Infinity;
  const band = metre > 200 ? "overview" : metre > 32 ? "medium" : "fine";
  useEffect(() => {
    if (!choice || !lon || !lat || mode !== "explore") return;
    const ctrl = new AbortController();
    const current = () =>
      !ctrl.signal.aborted && useStore.getState().autoImagery === choice;
    const patch = useStore.getState().patch;
    const timer = window.setTimeout(async () => {
      if (!current()) return;
      patch({ autoNote: "searching" });
      try {
        const qs = new URLSearchParams({
          lon,
          lat,
          band,
          date: choice.date,
          lookback: String(choice.lookback),
        });
        const res = await fetch("/api/imagery/auto?" + qs, {
          signal: ctrl.signal,
        });
        const data = await res.json();
        if (!current()) return;
        if (res.ok) patch({ imagery: data.image, autoNote: data.reason });
        else patch({ imagery: null, autoNote: data.code || "provider" });
      } catch {
        if (current()) patch({ imagery: null, autoNote: "provider" });
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [choice, mode, lon, lat, band]);
}
