import { useEffect, useState } from "react";
import { useStore } from "./model";
type Study = {
  events: { id: number }[];
  assessed: number;
  training: number;
  holdout: number;
  brier: number | null;
  baselineBrier: number | null;
  bins: Record<string, { n: number; severe: number }>;
};
export function ImpactReference() {
  const ar = useStore((s) => s.lang === "ar"),
    t = (en: string, arabic: string) => (ar ? arabic : en);
  const [study, setStudy] = useState<Study | null>(null),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/cartography/impact-reference.json", { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then(setStudy)
      .catch(() => {
        if (!ctrl.signal.aborted) setFailed(true);
      });
    return () => ctrl.abort();
  }, []);
  return (
    <details>
      <summary>
        {t(
          "Historical earthquake damage · NOAA",
          "أضرار الزلازل التاريخية · NOAA",
        )}
      </summary>
      {study ? (
        <>
          <p>
            {t(
              "Significant earthquakes recorded in the region, 1900–2025",
              "الزلازل المؤثرة المسجلة في المنطقة، ١٩٠٠–٢٠٢٥",
            )}{" "}
            · {study.events.length}.{" "}
            {t(
              "Records with a magnitude and a damage assessment",
              "سجلات فيها قوة الزلزال وتقييم الضرر",
            )}{" "}
            · {study.assessed}.
          </p>
          <p>
            {t(
              "Severe or extreme documented damage among assessed events before 2015",
              "حالات الضرر الشديد أو الأقصى ضمن الأحداث المقيّمة قبل ٢٠١٥",
            )}
          </p>
          {Object.entries(study.bins).map(([label, b]) => (
            <div key={label} className="between row">
              <b dir="ltr">{label}</b>
              <span dir="ltr">
                {b.severe} / {b.n}
              </span>
            </div>
          ))}
          <p>
            {t("2015–2025 holdout size", "عدد حالات التحقق من ٢٠١٥ إلى ٢٠٢٥")} ·{" "}
            {study.holdout}.{" "}
            {t(
              "Brier score (lower is better), magnitude groups / regional baseline",
              "خطأ براير (الأقل أفضل)، فئات القوة / المتوسط الإقليمي",
            )}{" "}
            · {study.brier?.toFixed(3)} / {study.baselineBrier?.toFixed(3)}.
          </p>
          <small>
            {t(
              "NOAA selects significant earthquakes. These counts describe recorded cases; city-level damage forecasts require broader impact coverage.",
              "NOAA بتختار الزلازل المؤثرة. الأعداد تخص الحالات المسجلة. توقّع الضرر لكل مدينة محتاج تغطية أوسع للأضرار.",
            )}
          </small>
        </>
      ) : (
        <p>
          {failed
            ? t("Impact records unavailable", "سجل الأضرار غير متاح")
            : "…"}
        </p>
      )}
      <p>
        <a
          href="https://doi.org/10.7289/V5TD9V7K"
          target="_blank"
          rel="noreferrer"
        >
          NOAA NCEI / WDS
        </a>
      </p>
    </details>
  );
}
