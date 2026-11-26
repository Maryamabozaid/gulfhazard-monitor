import { useMemo, useState } from "react";
import {
  Radio,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  SlidersHorizontal,
  Ellipsis,
  Database,
  ExternalLink,
  ArrowDownWideNarrow,
  PanelRightClose,
} from "lucide-react";
import {
  useStore,
  useText,
  byId,
  defaults,
  loc,
  fmt,
  dateText,
  measureText,
  type Hazard,
  type Payload,
} from "./model";
import { placeName, sourceMessage } from "./locale";
import { Icon } from "./icons";
export const statusLabel = (s: string, ar: boolean) =>
  ({
    ok: ["Current", "محدّث"],
    empty: ["No records", "لا سجلات"],
    stale: ["Cached", "مخزّن"],
    refreshing: ["Refreshing", "جار التحديث"],
    setup: ["Setup needed", "يلزم الإعداد"],
    error: ["Unavailable", "غير متاح"],
    partial: ["Partial coverage", "تغطية جزئية"],
    loading: ["Connecting", "جار الاتصال"],
  })[s]?.[ar ? 1 : 0] || s;
export function SourceRows({ data }: { data: Record<string, Payload> }) {
  const { active, lang } = useStore(),
    ar = lang === "ar",
    t = useText();
  return (
    <div className="source-list">
      {active.map((id) => {
        const p = data[id] || defaults(id);
        return (
          <div key={id} className="source-row">
            <div className="row between">
              <strong>{p.provider}</strong>
              <span className={"state " + p.status}>
                {statusLabel(p.status, ar)}
              </span>
            </div>
            {p.message && <p>{sourceMessage(p.message, ar)}</p>}
            <small>
              {t("Last successful fetch", "آخر جلب ناجح")} ·{" "}
              {p.lastSuccess
                ? dateText(p.lastSuccess, ar, true) + " UTC"
                : t("Never", "أبداً")}
            </small>
            {p.coverage && (
              <small>{p.coverage.map((s) => s.slice(0, 10)).join(" — ")}</small>
            )}
          </div>
        );
      })}
    </div>
  );
}
export function Feed({
  records,
  data,
  onSelect,
  refresh,
}: {
  records: Hazard[];
  data: Record<string, Payload>;
  onSelect: (f: Hazard) => void;
  refresh: () => void;
}) {
  const { lang, active, patch } = useStore(),
    ar = lang === "ar",
    t = useText(),
    [tab, setTab] = useState("activity"),
    [sort, setSort] = useState("newest"),
    [filter, setFilter] = useState("all"),
    [limit, setLimit] = useState(40),
    [sorting, setSorting] = useState(false);
  const rows = useMemo(() => {
    const groups = new Map<string, { f: Hazard; n: number }>();
    const sorted = records
      .filter((f) => filter === "all" || f.properties.type === filter)
      .sort((a, b) =>
        sort === "value"
          ? (b.properties.severity ?? -Infinity) -
            (a.properties.severity ?? -Infinity)
          : sort === "oldest"
            ? (a.properties.timestamp || "").localeCompare(
                b.properties.timestamp || "",
              )
            : (b.properties.timestamp || "").localeCompare(
                a.properties.timestamp || "",
              ),
      );
    for (const f of sorted) {
      const p = f.properties,
        key =
          p.type === "fires"
            ? [p.type, p.timestamp?.slice(0, 13), p.country, p.satellite].join(
                "|",
              )
            : p.id;
      const existing = groups.get(key);
      if (existing) existing.n++;
      else groups.set(key, { f, n: 1 });
    }
    return [...groups.values()];
  }, [records, sort, filter]);
  const cached = active
    .map((id) => data[id])
    .filter(
      (p) => p && ["refreshing", "stale"].includes(p.status) && p.lastSuccess,
    );
  const issue = active.filter((id) =>
    ["error", "setup", "stale"].includes(data[id]?.status),
  );
  const problem = active.some((id) =>
    ["stale", "partial", "error", "setup"].includes(data[id]?.status),
  );
  return (
    <aside className="feed glass" aria-label={t("Hazard feed", "سجل المخاطر")}>
      <div className="feed-heading">
        <span className="feed-symbol">
          <Radio size={19} />
        </span>
        <h2>{t("Hazard feed", "سجل المخاطر")}</h2>
        <button
          className="iconbtn feed-close"
          aria-label={t("Collapse feed", "إغلاق السجل")}
          onClick={() => patch({ feed: false })}
        >
          <PanelRightClose size={16} />
        </button>
      </div>
      <div className="feed-tabs">
        <button
          className={tab === "activity" ? "sel" : ""}
          onClick={() => setTab("activity")}
        >
          {t("Activity", "النشاط")} <span>{fmt(records.length, ar)}</span>
        </button>
        <button
          className={tab === "sources" ? "sel" : ""}
          onClick={() => setTab("sources")}
        >
          {t("Sources", "المصادر")}
          {problem && <i className="warning-dot" />}
        </button>
        <button
          className="refresh"
          title={t("Refresh sources", "تحديث المصادر")}
          aria-label={t("Refresh sources", "تحديث المصادر")}
          onClick={refresh}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      {tab === "sources" ? (
        <div className="feed-scroll">
          <SourceRows data={data} />
        </div>
      ) : (
        <>
          <div className="feed-sort">
            <div className="selectbox">
              <select
                aria-label={t("Filter feed", "تصفية السجل")}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">
                  {t("All active layers", "كل الطبقات النشطة")}
                </option>
                {active.map((id) => (
                  <option key={id} value={id}>
                    {ar ? byId[id].ar : byId[id].name}
                  </option>
                ))}
              </select>
              <ChevronDown size={13} />
            </div>
            <button
              aria-label={t("Sort feed", "ترتيب السجل")}
              title={t("Sort feed", "ترتيب السجل")}
              onClick={() => setSorting(!sorting)}
            >
              <ArrowDownWideNarrow size={15} />
            </button>
          </div>
          {sorting && (
            <label className="sort-options">
              {t("Order", "الترتيب")}
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="newest">
                  {t("Newest first", "الأحدث أولاً")}
                </option>
                <option value="oldest">
                  {t("Oldest first", "الأقدم أولاً")}
                </option>
                <option value="value">
                  {t("Highest layer value", "أعلى قيمة للطبقة")}
                </option>
              </select>
            </label>
          )}
          <div className="feed-scroll">
            {!rows.length ? (
              <div className="empty">
                <Database size={24} />
                <b>{t("No matching observations", "لا توجد مشاهدات مطابقة")}</b>
                <p>
                  {t(
                    "Check the selected layers, dates and source status.",
                    "تحقق من الطبقات والتواريخ وحالة المصادر.",
                  )}
                </p>
                <SourceRows data={data} />
              </div>
            ) : (
              rows.slice(0, limit).map(({ f, n }, i) => {
                const p = f.properties,
                  l = byId[p.type],
                  time = p.timestamp
                    ? new Intl.DateTimeFormat(loc(ar), {
                        timeZone: "UTC",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      }).format(new Date(p.timestamp))
                    : "";
                const title =
                  p.type === "fires"
                    ? p.country || t("Thermal detection", "رصد حراري")
                    : p.type === "oil"
                      ? p.country === "Offshore"
                        ? t("Offshore slick", "بقعة بحرية")
                        : p.country || t("Potential slick", "بقعة محتملة")
                      : ar && p.title_ar ? p.title_ar : p.title;
                const newDay =
                  p.timestamp?.slice(0, 10) !==
                    rows[i - 1]?.f.properties.timestamp?.slice(0, 10) ||
                  i === 0;
                return (
                  <div key={p.id}>
                    {newDay && (
                      <div className="day-heading">
                        <span>
                          {p.timestamp
                            ? new Intl.DateTimeFormat(loc(ar), {
                                weekday: "short",
                                day: "numeric",
                                month: "short",
                                timeZone: "UTC",
                              }).format(new Date(p.timestamp))
                            : t("Reference layers", "طبقات مرجعية")}
                        </span>
                        <i />
                      </div>
                    )}
                    <button className="event" onClick={() => onSelect(f)}>
                      <div className="event-top">
                        <span className="event-kind" style={{ color: l.color }}>
                          <Icon name={l.id} size={15} />
                          {ar
                            ? l.ar
                            : {
                                earthquakes: "Earthquake",
                                oil: "Oil slick",
                                fires: "Fire detection",
                              }[l.id] || l.name}
                        </span>
                        <time>
                          {time} {time && "UTC"}
                        </time>
                      </div>
                      <b>{placeName(title, ar)}</b>
                      <div className="event-meta">
                        <span>
                          {n > 1
                            ? fmt(n, ar) + " " + t("pixels", "بكسل")
                            : measureText(f)}
                        </span>
                        <i /> <span>{p.source}</span>
                        <ChevronRight size={13} />
                      </div>
                    </button>
                  </div>
                );
              })
            )}
            {rows.length > limit && (
              <button
                className="more-feed"
                onClick={() => setLimit(limit + 40)}
              >
                {t("Load more activity", "عرض المزيد")}
              </button>
            )}
          </div>
        </>
      )}
      {issue.length > 0 && tab === "activity" && (
        <button className="cache-note" onClick={() => setTab("sources")}>
          {issue
            .map(
              (id) =>
                (ar ? byId[id].ar : byId[id].name) +
                " · " +
                statusLabel(data[id].status, ar),
            )
            .join(" / ")}
        </button>
      )}
      {cached.length > 0 && (
        <button className="cache-note" onClick={() => setTab("sources")}>
          {t("Cached observations", "مشاهدات مخزنة")} ·{" "}
          {dateText(cached.map((p) => p.lastSuccess!).sort()[0], ar, true)} UTC
        </button>
      )}
      <button className="feed-bottom" onClick={() => patch({ tool: "stats" })}>
        <Icon name="stats" size={16} />
        {t("View statistics", "عرض الإحصاءات")}
        <ChevronRight size={15} />
      </button>
    </aside>
  );
}
