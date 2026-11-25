import { useEffect, useState } from "react";
import { byId, useStore } from "./model";
type Health = {
  layer: string;
  success: string | null;
  failure: string | null;
  problem: string | null;
  down: boolean;
};
export function ProviderHealth({ compact = false }: { compact?: boolean }) {
  const [rows, setRows] = useState<Health[]>([]),
    ar = useStore((s) => s.lang === "ar"),
    patch = useStore((s) => s.patch);
  useEffect(() => {
    const ctrl = new AbortController();
    const load = () =>
      fetch("/api/providers", { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : []))
        .then((r) => {
          if (!ctrl.signal.aborted) setRows(r);
        })
        .catch(() => {});
    void load();
    const timer = setInterval(load, 60000);
    return () => {
      ctrl.abort();
      clearInterval(timer);
    };
  }, []);
  const down = rows.filter((p) => p.down);
  if (compact)
    return down.length ? (
      <button
        className="provider-alert"
        role="status"
        onClick={() => patch({ tool: "info" })}
      >
        {ar ? "تعطل مزوّد" : "Provider outage"} · {down.length}
      </button>
    ) : null;
  return (
    <details open={down.length > 0}>
      <summary>{ar ? "حالة مزوّدي البيانات" : "Provider health"}</summary>
      {rows.map((r) => (
        <p key={r.layer}>
          <b>{ar ? byId[r.layer]?.ar : byId[r.layer]?.name}</b> ·{" "}
          {r.down ? (ar ? "متعطّل" : "Unavailable") : ar ? "متصل" : "Online"}
          <br />
          {ar ? "آخر نجاح" : "Last success"} · {r.success || "—"}
          {r.down && (
            <small>
              {" "}
              · {r.failure} · {r.problem}
            </small>
          )}
        </p>
      ))}
    </details>
  );
}
