import { useState, useEffect } from "react";
import { Bell, Trash2 } from "lucide-react";
import { byId, useStore, useText } from "./model";
import { useAccount } from "./Accounts";
export function Alerts() {
  const account=useAccount();
  const t = useText(),
    ar = useStore((s) => s.lang === "ar"),
    restrictions=useStore(s=>s.restrictions),
    [name, setName] = useState(""),
    [target, setTarget] = useState("point"),
    [id, setId] = useState("earthquakes"),
    [center, setCenter] = useState("24.7136, 46.6753"),
    [radius, setRadius] = useState(200),
    [minimum, setMinimum] = useState(4.5),
    [channel, setChannel] = useState("inbox"),
    [result, setResult] = useState<any>({
      rules: [],
      channels: ["inbox"],
      notifications: [],
    }),
    [msg, setMsg] = useState("");
  const api = async (method = "GET", body?: any, path = "") => {
    const res = await fetch("/api/alerts" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw Error((await res.json()).message);
    return res.status === 204 ? null : res.json();
  };
  const load = () =>
    api()
      .then(setResult)
      .catch((e) => setMsg(e.message));
  useEffect(() => {
    if(account.user)void load();
  }, [account.user?.id]);
  if(!account.user)return <button className="primary" onClick={account.open}>{t("Sign in to manage alerts","سجلي الدخول لإدارة التنبيهات")}</button>;
  return (
    <div className="stack">
      {account.user.role!=="viewer" && (
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const [lat, lon] = center.split(",").map(Number);
            await api("POST", {
              name,
              layer: id,
              target,
              center: [lon, lat],
              radius,
              minimum,
              channel,
            });
            setName("");
            setMsg(
              t(
                "Rule saved. Checked every five minutes.",
                "حُفظت القاعدة. تُفحص كل خمس دقائق.",
              ),
            );
            await load();
          } catch (e) {
            setMsg(String(e));
          }
        }}
      >
        <label>
          {t("Rule name", "اسم القاعدة")}
          <input
            value={name}
            required
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("Riyadh earthquake watch", "مراقبة زلازل الرياض")}
          />
        </label>
        <label>
          {t("Layer", "الطبقة")}
          <select
            value={id}
            onChange={(e) => {
              setId(e.target.value);
              setMinimum(e.target.value === "earthquakes" ? 4.5 : 0);
            }}
          >
            {["earthquakes", "oil", "fires", "floods"].filter(id=>!restrictions[id]).map((id) => (
              <option key={id} value={id}>
                {ar ? byId[id].ar : byId[id].name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Alert location", "موقع التنبيه")}
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="point">
              {t("Coordinate radius", "نطاق حول إحداثيات")}
            </option>
            <option value="bahrain-coast">
              {t("Bahrain coastline", "ساحل البحرين")}
            </option>
          </select>
        </label>
        {target === "point" && (
          <label>
            {t("Centre · latitude, longitude", "المركز · خط العرض، خط الطول")}
            <input
              value={center}
              required
              onChange={(e) => setCenter(e.target.value)}
            />
          </label>
        )}
        <div className="two">
          <label>
            {t("Radius (km)", "نصف القطر (كم)")}
            <input
              type="number"
              min="1"
              max="500"
              value={radius}
              onChange={(e) => setRadius(+e.target.value)}
            />
          </label>
          <label>
            {ar ? byId[id].metricAr : byId[id].metric} ≥
            <input
              type="number"
              step="any"
              value={minimum}
              onChange={(e) => setMinimum(+e.target.value)}
            />
          </label>
        </div>
        <label>
          {t("Delivery", "طريقة الإرسال")}
          <select value={channel} onChange={(e) => setChannel(e.target.value)}>
            {result.channels.map((c: string) => (
              <option key={c} value={c}>
                {c === "inbox" ? t("Monitor inbox", "صندوق المنصة") : c}
              </option>
            ))}
          </select>
        </label>
        <button className="primary">
          <Bell size={15} />
          {t("Save alert rule", "حفظ قاعدة التنبيه")}
        </button>
      </form>)}
      {result.issues?.length>0 && <p role="status">{t("Deliveries awaiting review","تنبيهات تحتاج مراجعة الإرسال")} · {result.issues.length}</p>}
      {msg && <p role="status">{msg}</p>}
      {result.rules.map((r: any) => (
        <div className="listrow" key={r.id}>
          <span>
            <b>{r.name}</b>
            <small>
              {r.radius} km · ≥ {r.minimum} · {r.channel}
            </small>
          </span>
          {account.user?.role!=="viewer" && <button
            className="iconbtn"
            aria-label={t("Remove rule", "حذف القاعدة")}
            onClick={async () => {
              try {
                await api("DELETE", null, "/" + r.id);
                await load();
              } catch (e) {
                setMsg(String(e));
              }
            }}
          >
            <Trash2 size={15} />
          </button>}
        </div>
      ))}
      <h4>{t("Alert inbox", "صندوق التنبيهات")}</h4>
      {result.notifications.length ? (
        result.notifications.map((n: any) => (
          <p key={n.rule + n.event}>{n.title}</p>
        ))
      ) : (
        <small>
          {t("No new matching observations.", "لا توجد مشاهدات جديدة مطابقة.")}
        </small>
      )}
    </div>
  );
}
