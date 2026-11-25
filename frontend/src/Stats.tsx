import { useEffect, useRef, useState } from "react";
import Chart from "chart.js/auto";
import { useText, useStore, byId, type Hazard } from "./model";
export function Stats({ records }: { records: Hazard[] }) {
  const t = useText(),
    ar = useStore((s) => s.lang === "ar");
  const [summary,setSummary]=useState<Record<string,Record<string,number>>|null>(null),[error,setError]=useState(false);
  useEffect(()=>{setSummary(null);setError(false);const w=new Worker(new URL("./summaryWorker.ts",import.meta.url),{type:"module"});
    w.onmessage=e=>{setSummary(e.data.counts||null);setError(!!e.data.error);};w.onerror=()=>setError(true);w.postMessage(records);return()=>w.terminate();},[records]);
  if(!summary)return <p role="status">{error?t("Statistics unavailable for these geometries","تعذّر حساب الإحصائيات لهذه الأشكال"):t("Computing distinct footprints…","جارٍ حساب المساحات والرصد غير المكرر…")}</p>;
  return (
    <div className="stack">
      {["earthquakes", "oil", "fires"].map((id) => (
        <Graph
          key={id}
          data={summary[id]}
          id={id}
          title={
            id === "earthquakes"
              ? t("Earthquakes by month", "الزلازل شهرياً")
              : id === "oil"
                ? t(
                    "Distinct slick footprint by year · km²",
                    "مساحة البقع بعد دمج التداخل السنوي · كم²",
                  )
                : t("Thermal detections · distinct 1 km cells per day", "الخلايا الحرارية المميزة يومياً حسب البلد · ١ كم")
          }
          ar={ar}
        />
      ))}
    </div>
  );
}
function Graph({data,id,title,ar}:{data:Record<string,number>;id:string;title:string;ar:boolean}){
 const ref=useRef<HTMLCanvasElement>(null);
  const entries = Object.entries(data)
    .sort((a, b) => (id === "fires" ? b[1] - a[1] : a[0].localeCompare(b[0])))
    .slice(0, 15);
  useEffect(() => {
    if (!ref.current || !entries.length) return;
    const c = new Chart(ref.current, {
      type: "bar",
      data: {
        labels: entries.map((x) => x[0]),
        datasets: [
          {
            data: entries.map((x) => x[1]),
            backgroundColor: byId[id].color,
            borderRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true },
          x: { ticks: { maxRotation: 45, autoSkip: true } },
        },
      },
    });
    return () => c.destroy();
  }, [data, id, title]);
  return (
    <section className="graph">
      <h4>{title}</h4>
      {entries.length ? (
        <div>
          <canvas
            ref={ref}
            role="img"
            aria-label={
              title +
              ": " +
              entries.map(([k, v]) => k + " " + v.toFixed(1)).join(", ")
            }
          />
        </div>
      ) : (
        <p>
          {ar
            ? "لا سجلات في الطبقات والفترة المحددة."
            : "No records in the active layers and time window."}
        </p>
      )}
    </section>
  );
}
