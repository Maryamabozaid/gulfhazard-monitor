import { useMemo, useState, useEffect } from "react";
import { Play, Pause, Clock3, ChevronDown, ChevronUp } from "lucide-react";
import {
  useStore,
  useText,
  cutoff,
  day,
  dateText,
  fmt,
  type Hazard,
} from "./model";
export function Timeline({ all }: { all: Hazard[] }) {
  const { range, period, setDays, lang, cursor, patch } = useStore(),
    t = useText(),
    [playing, setPlaying] = useState(false),
    [fold, setFold] = useState(false);
  const ar = lang === "ar",
    b = cutoff(range, 1),
    a = period ? b - period * 864e5 : Date.parse(range.start);
  const bins = useMemo(() => {
    const bins = Array(72).fill(0);
    for (const f of all) {
      const ts = f.properties.timestamp;
      if (ts) {
        const x = (Date.parse(ts) - a) / (b - a || 1);
        if (x >= 0 && x <= 1) bins[Math.min(71, Math.floor(x * 72))]++;
      }
    }
    return bins;
  }, [all, a, b]);
  const max = Math.max(1, ...bins);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      const val = useStore.getState().cursor + 0.015;
      patch({ cursor: Math.min(1, val) });
      if (val >= 1) setPlaying(false);
    }, 200);
    return () => clearInterval(timer);
  }, [playing, patch]);
  const tick = (r: number) =>
    dateText(new Date(a + (b - a) * r).toISOString(), ar);
  return (
    <section
      className={"timeline glass " + (fold ? "folded" : "")}
      aria-label={t("Event timeline", "الخط الزمني")}
    >
      <div className="timeline-head">
        <Clock3 size={16} />
        <h3>{t("Event timeline", "الخط الزمني")}</h3>
        <div className="periods">
          {[1, 7, 30, 365].map((d, i) => (
            <button
              className={period === d ? "on" : ""}
              key={d}
              onClick={() => {
                setDays(d);
                setPlaying(false);
              }}
            >
              {["24H", "7D", "30D", "1Y"][i]}
            </button>
          ))}
        </div>
        <button
          className="iconbtn"
          aria-label={t("Toggle timeline", "توسيع الخط الزمني")}
          onClick={() => setFold(!fold)}
        >
          {fold ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </div>
      {!fold && (
        <div className="timeline-body">
          <button
            className="play"
            aria-label={
              playing
                ? t("Pause", "إيقاف")
                : t("Play timeline", "تشغيل الخط الزمني")
            }
            onClick={() => {
              if (cursor >= 1) patch({ cursor: 0 });
              setPlaying(!playing);
            }}
          >
            {playing ? (
              <Pause size={15} />
            ) : (
              <Play size={15} fill="currentColor" />
            )}
          </button>
          <div className="track-group" dir="ltr">
            <div
              className="chart-track"
              title={
                dateText(
                  new Date(cutoff(range, cursor)).toISOString(),
                  ar,
                  true,
                ) + " UTC"
              }
            >
              {bins.map((v, i) => (
                <i
                  key={i}
                  style={{
                    height: 2 + (Math.log1p(v) / Math.log1p(max)) * 21 + "px",
                    opacity: i / 72 > cursor ? 0.25 : 1,
                  }}
                />
              ))}
              <span
                className="scrub-line"
                style={{ left: cursor * 100 + "%" }}
              />
              <input
                aria-label={t("Timeline cutoff", "نهاية الخط الزمني")}
                type="range"
                min="0"
                max="1000"
                value={Math.round(cursor * 1000)}
                onChange={(e) => {
                  setPlaying(false);
                  patch({ cursor: +e.target.value / 1000 });
                }}
              />
            </div>
            <div className="ticks">
              {[0, 0.25, 0.5, 0.75, 1].map((v, i) => (
                <span key={v}>
                  {period === 1
                    ? new Date(a + (b - a) * v).toISOString().slice(11, 16)
                    : tick(v)}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
