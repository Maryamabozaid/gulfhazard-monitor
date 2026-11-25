import { useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { ChevronsLeftRight } from "lucide-react";
import { ago, useStore } from "./model";
import {
  compareOptions,
  isScene,
  providerFor,
  type ComparePair,
} from "./compareImagery";
import { imageryNote } from "./autoImagery";

export type TileStatus =
  | "loading"
  | "partial"
  | "unavailable"
  | "loaded"
  | "gaps"
  | "no_coverage";

const tileLabels = {
  loading: ["Loading…", "جارٍ التحميل…"],
  partial: ["Some tiles unavailable", "بعض الصور غير متاحة"],
  unavailable: ["Imagery unavailable", "الصورة غير متاحة"],
  loaded: ["Tiles loaded", "تم تحميل الصور"],
  gaps: ["Partial coverage", "تغطية جزئية"],
  no_coverage: ["No coverage in view", "لا توجد تغطية ظاهرة"],
};

type Props = {
  initial: number;
  onSplit: (percent: number) => void;
  status: [TileStatus, TileStatus];
  images: ComparePair;
  onZoomArea: (bounds: number[]) => void;
};

function Divider({ initial, onSplit }: Pick<Props, "initial" | "onSplit">) {
  const ar = useStore((s) => s.lang === "ar");
  const [percent, setPercent] = useState(initial);
  const drag = useRef<{
    id: number;
    left: number;
    width: number;
    offset: number;
  } | null>(null);
  const pending = useRef(0);
  const next = useRef(initial);
  useLayoutEffect(() => () => cancelAnimationFrame(pending.current), []);

  function paint() {
    pending.current = 0;
    onSplit(next.current);
    setPercent(next.current);
  }
  function position(value: number) {
    next.current = Math.max(0, Math.min(100, value));
    if (!pending.current) pending.current = requestAnimationFrame(paint);
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (d?.id === e.pointerId)
      position((100 * (e.clientX - d.left - d.offset)) / d.width);
  }

  return (
    <div
      className="swipe-line"
      style={{ left: percent + "%" }}
      role="slider"
      aria-label={ar ? "فاصل المقارنة" : "Comparison divider"}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      aria-valuetext={
        ar
          ? `الصورة اليسرى ${Math.round(percent)}٪`
          : `Left image ${Math.round(percent)}%`
      }
      tabIndex={0}
      onPointerDown={(e) => {
        if (!e.isPrimary || e.button !== 0 || drag.current) return;
        const el = e.currentTarget;
        const box = el.parentElement!.getBoundingClientRect();
        if (!box.width) return;
        e.preventDefault();
        el.focus({ preventScroll: true });
        el.setPointerCapture(e.pointerId);
        drag.current = {
          id: e.pointerId,
          left: box.left,
          width: box.width,
          offset: e.clientX - box.left - (box.width * percent) / 100,
        };
      }}
      onPointerMove={move}
      onPointerUp={(e) => {
        if (!drag.current || drag.current.id !== e.pointerId) return;
        move(e);
        e.currentTarget.releasePointerCapture(e.pointerId);
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onKeyDown={(e) => {
        const n = next.current,
          step = e.shiftKey ? 10 : 1;
        const moves: Record<string, number> = {
          ArrowLeft: n - step,
          ArrowRight: n + step,
          ArrowDown: n - step,
          ArrowUp: n + step,
          PageDown: n - 10,
          PageUp: n + 10,
          Home: 0,
          End: 100,
        };
        if (!(e.key in moves)) return;
        e.preventDefault();
        position(moves[e.key]);
      }}
    >
      <span>
        <ChevronsLeftRight size={21} aria-hidden="true" />
      </span>
      <output
        aria-hidden="true"
        dir="ltr"
        className="split-readout"
        style={{
          transform:
            percent < 10
              ? "translateX(0)"
              : percent > 90
                ? "translateX(-100%)"
                : "translateX(-50%)",
        }}
      >
        A {Math.round(percent)}% · B {100 - Math.round(percent)}%
      </output>
    </div>
  );
}

export function CompareControls({
  initial,
  onSplit,
  status,
  images,
  onZoomArea,
}: Props) {
  const dates = useStore((s) => s.compareDates);
  const ar = useStore((s) => s.lang === "ar");
  const products = useStore((s) => s.compareProducts);
  const hazards = useStore((s) => s.compareHazards);
  const t = (en: string, arabic: string) => (ar ? arabic : en);
  return (
    <>
      <Divider initial={initial} onSplit={onSplit} />
      <div className="compare-dates glass" dir="ltr">
        {dates.map((date, i) => {
          const side = i === 0 ? t("Left", "اليسار") : t("Right", "اليمين");
          const product = products[i],
            { image, message, latest } = images[i];
          const state =
            message === "no_day"
              ? t("No published image", "لا توجد صورة منشورة") +
                (latest ? t(" · Last published ", " · آخر نشر ") + latest : "")
              : message === "searching"
                ? t("Checking coverage…", "جارٍ التحقق من التغطية…")
                : message
                  ? imageryNote(message, ar) || imageryNote("provider", ar)
                  : tileLabels[status[i]][ar ? 1 : 0];
          return (
            <section
              key={i}
              className="compare-side"
              dir={ar ? "rtl" : "ltr"}
              aria-label={side}
            >
              <header>
                <b aria-hidden="true">{i === 0 ? "A" : "B"}</b>
                <strong>{side}</strong>
                <span>{providerFor(product)}</span>
              </header>
              <div className="compare-fields">
                <select
                  aria-label={side + " · " + t("Satellite", "القمر الصناعي")}
                  value={product}
                  onChange={(e) => {
                    const pair: [string, string] = [...products];
                    pair[i] = e.target.value;
                    useStore.getState().patch({ compareProducts: pair });
                  }}
                >
                  {compareOptions
                    .filter(([id]) => id !== "change" || i === 1)
                    .map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                </select>
                <input
                  aria-label={
                    side +
                    " · " +
                    t("Target date (UTC)", "التاريخ المطلوب (UTC)")
                  }
                  type="date"
                  max={ago(0)}
                  value={date}
                  onChange={(e) => {
                    if (!e.target.value || !e.target.validity.valid) return;
                    const pair: [string, string] = [...dates];
                    pair[i] = e.target.value;
                    useStore.getState().patch({ compareDates: pair });
                  }}
                />
              </div>
              <div className="compare-status" role="status">
                {state}
              </div>
              <div className="compare-caption">
                {image?.overlay && (
                  <div>
                    {product === "water"
                      ? t(
                          "Blue · potential open water",
                          "أزرق · مياه سطحية محتملة",
                        ) +
                        " · " +
                        image.threshold?.toFixed(1) +
                        " dB"
                      : t(
                          "Blue ≤ −3 dB · amber ≥ +3 dB",
                          "أزرق ≤ −٣ dB · كهرماني ≥ +٣ dB",
                        )}{" "}
                    · 9.6 km
                    {image.items?.length === 2 && (
                      <div>
                        {image.items[0].date.slice(0, 10)} →{" "}
                        {image.items[1].date.slice(0, 10)}
                      </div>
                    )}
                    {image.bounds && (
                      <button
                        type="button"
                        onClick={() => onZoomArea(image.bounds!)}
                      >
                        {t("Zoom to analysis area", "تكبير منطقة التحليل")}
                      </button>
                    )}
                  </div>
                )}
                {isScene(product) ? (
                  image ? (
                    <a href={image.url} target="_blank" rel="noreferrer">
                      {image.name} · {image.date.slice(0, 10)} UTC
                      {image.resolutionLabel
                        ? " · " + image.resolutionLabel
                        : ""}
                    </a>
                  ) : product === "water" || product === "change" ? (
                    t(
                      "Map centre · 12-day radar search per date",
                      "مركز الخريطة · بحث راداري حتى ١٢ يومًا لكل تاريخ",
                    )
                  ) : (
                    t(
                      "Map centre · up to 7 days earlier",
                      "مركز الخريطة · بحث حتى ٧ أيام سابقة",
                    )
                  )
                ) : product === "daily" ? (
                  image && image.id !== "daily" ? (
                    image.name
                  ) : (
                    t(
                      "Same UTC day · Terra → Aqua → NOAA-20",
                      "نفس اليوم العالمي · تيرا ثم أكوا ثم NOAA-20",
                    )
                  )
                ) : product === "mosaic" ? (
                  image && image.id !== "mosaic" ? (
                    image.name
                  ) : (
                    t(
                      "Same-day passes · gaps show the basemap",
                      "مرور القمرين في نفس اليوم · تظهر الخريطة في الفراغات",
                    )
                  )
                ) : (
                  t(
                    "Selected UTC day · coverage varies",
                    "اليوم المختار بالتوقيت العالمي · التغطية متغيرة",
                  )
                )}
              </div>
            </section>
          );
        })}
        <div className="compare-foot" dir={ar ? "rtl" : "ltr"}>
          <label>
            <input
              type="checkbox"
              checked={hazards}
              onChange={(e) =>
                useStore.getState().patch({ compareHazards: e.target.checked })
              }
            />
            {t("Hazard indicators", "علامات المخاطر")}
          </label>
          <small>
            {t(
              "Both sides use the active hazard filters",
              "الناحيتان تعرضان نفس المخاطر حسب الفلاتر المختارة",
            )}
          </small>
          {dates[0] === dates[1] && products[0] === products[1] && (
            <strong>
              {t("Same date on both sides", "نفس التاريخ على الجانبين")}
            </strong>
          )}
        </div>
      </div>
    </>
  );
}
