import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import nodemailer from "nodemailer";
import { buffer, point, polygonToLine, booleanIntersects } from "@turf/turf";
import { db, getLayer } from "./store.mjs";
import { restriction } from "./licensing.mjs";
import { day, addDays, inside } from "./net.mjs";

const bahrain = JSON.parse(
  readFileSync(new URL("../gis/public/cartography/land.geojson", import.meta.url)),
).features.find((f) => f.properties.iso3 === "BHR");
const shore = polygonToLine(bahrain);
export const alertArea = (rule) =>
  buffer(
    rule.target === "bahrain-coast" ? shore : point(rule.center),
    rule.radius,
    { units: "kilometers" },
  );

export const channels = () => [
  "inbox",
  ...(process.env.ALERT_WEBHOOK_URL ? ["webhook"] : []),
  ...(process.env.SMTP_URL &&
  process.env.ALERT_EMAIL_TO &&
  process.env.ALERT_EMAIL_FROM
    ? ["email"]
    : []),
];
export async function rules(user) {
  const rows = (
    await db.query(
      user && user.role !== "admin"
        ? "SELECT * FROM rules WHERE owner_id=$1 ORDER BY created DESC"
        : "SELECT * FROM rules ORDER BY created DESC",
      user && user.role !== "admin" ? [user.id] : [],
    )
  ).rows;
  return rows
    .map((r) => ({ id: r.id, ...JSON.parse(r.body), created: r.created }))
    .filter((r) => !restriction(r.layer));
}
export async function addRule(input, user) {
  const {
    name,
    layer,
    center,
    radius,
    minimum,
    channel,
    target = "point",
  } = input;
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.length > 100 ||
    !["earthquakes", "fires", "oil", "floods"].includes(layer) ||
    restriction(layer) ||
    !["point", "bahrain-coast"].includes(target) ||
    !Array.isArray(center) ||
    center.length !== 2 ||
    !center.every(Number.isFinite) ||
    !inside(center) ||
    !Number.isFinite(radius) ||
    radius < 1 ||
    radius > 500 ||
    !Number.isFinite(minimum) ||
    !channels().includes(channel)
  )
    throw Error("Invalid rule fields.");
  const id = randomUUID(),
    created = new Date().toISOString();
  const rule = {
    name: name.trim(),
    target,
    layer,
    center,
    radius,
    minimum,
    channel,
  };
  await db.transaction(async (c) => {
    await c.query("LOCK TABLE rules IN SHARE ROW EXCLUSIVE MODE");
    if (
      (
        await c.query(
          "SELECT count(*) AS n FROM rules WHERE owner_id IS NOT DISTINCT FROM $1",
          [user?.id || null],
        )
      ).rows[0].n >= 50
    )
      throw Error("Rule limit reached.");
    await c.query(
      "INSERT INTO rules(id,body,created,owner_id,region) VALUES($1,$2,$3,$4,ST_SetSRID(ST_GeomFromGeoJSON($5),4326))",
      [
        id,
        JSON.stringify(rule),
        created,
        user?.id || null,
        JSON.stringify(alertArea(rule).geometry),
      ],
    );
  });
  return id;
}
let running = false;
export async function checkAlerts() {
  if (running) return;
  running = true;
  try {
    for (const rule of await rules()) {
      const end = day(Date.now()),
        result = await getLayer(rule.layer, addDays(end, -1), end);
      if (!["ok", "partial"].includes(result.status)) continue;
      const area = alertArea(rule);
      for (const f of result.features) {
        const p = f.properties;
        if (
          !p.timestamp ||
          (rule.layer === "fires" && p.industrial_reason) ||
          p.timestamp < rule.created ||
          p.severity == null ||
          p.severity < rule.minimum ||
          !booleanIntersects(area, f)
        )
          continue;
        await enqueue(rule, p);
      }
    }
  } catch {
    console.warn("Alert check incomplete. Pending deliveries will be retried.");
  } finally {
    running = false;
  }
}

export async function enqueue(rule, p) {
  const message = [rule.name, p.title, p.timestamp, p.source_url].join(" · ");
  const created = new Date().toISOString();
  await db.transaction(async (c) => {
    if (
      !(
        await c.query("SELECT id FROM rules WHERE id=$1 FOR KEY SHARE", [
          rule.id,
        ])
      ).rows.length
    )
      return;
    await c.query(
      "INSERT INTO notifications VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [rule.id, p.id, message, created],
    );
    if (rule.channel !== "inbox")
      await c.query(
        "INSERT INTO outbox(rule,event,channel,payload) SELECT $1,$2,$3,$4::jsonb WHERE NOT EXISTS(SELECT 1 FROM deliveries WHERE rule=$1 AND event=$2 AND channel=$3) ON CONFLICT DO NOTHING",
        [
          rule.id,
          p.id,
          rule.channel,
          JSON.stringify({ rule: rule.name, event: p, message }),
        ],
      );
  });
}
export async function drainOutbox() {
  // SMTP has no delivery receipt transaction shared with our database. Keep
  // uncertain sends for review. Webhook consumers can deduplicate by stable key.
  await db.query(
    "UPDATE outbox SET state=CASE WHEN channel='email' THEN 'review' ELSE 'pending' END WHERE state='sending' AND available<now()",
  );
  for (let i = 0; i < 30; i++) {
    const lease = randomUUID();
    const permitted = ["earthquakes", "oil", "fires", "floods"].filter(
      (id) => !restriction(id),
    );
    const job = (
      await db.query(
        "WITH pick AS (SELECT o.rule,o.event,o.channel FROM outbox o JOIN rules r ON r.id=o.rule WHERE o.state='pending' AND o.available<=now() AND r.body::jsonb->>'layer' = ANY($2::text[]) ORDER BY o.available FOR UPDATE OF o SKIP LOCKED LIMIT 1) UPDATE outbox o SET state='sending',lease=$1,attempts=attempts+1,available=now()+interval '2 minutes' FROM pick p WHERE (o.rule,o.event,o.channel)=(p.rule,p.event,p.channel) RETURNING o.*",
        [lease, permitted],
      )
    ).rows[0];
    if (!job) break;
    const key = job.rule + "-" + job.event;
    try {
      if (job.channel === "webhook") {
        const r = await fetch(process.env.ALERT_WEBHOOK_URL, {
          method: "POST",
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": key,
          },
          body: JSON.stringify(job.payload),
          signal: AbortSignal.timeout(10000),
        });
        await r.body?.cancel();
        if (!r.ok) throw Error();
      } else {
        await nodemailer
          .createTransport(process.env.SMTP_URL, {
            connectionTimeout: 10000,
            socketTimeout: 15000,
          })
          .sendMail({
            from: process.env.ALERT_EMAIL_FROM,
            to: process.env.ALERT_EMAIL_TO,
            subject: "GulfHazard · " + job.payload.rule,
            text: job.payload.message,
            messageId:
              "<" +
              Buffer.from(key).toString("base64url") +
              "@gulfhazard.local>",
          });
      }
      await db.transaction(async (c) => {
        await c.query(
          "INSERT INTO deliveries VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [job.rule, job.event, job.channel, new Date().toISOString()],
        );
        await c.query("UPDATE outbox SET state='sent' WHERE lease=$1", [lease]);
      });
    } catch {
      await db.query(
        "UPDATE outbox SET state=$1,available=now()+($2::int * interval '1 second') WHERE lease=$3",
        [
          job.channel === "email" || job.attempts >= 6 ? "review" : "pending",
          Math.min(3600, 30 * 2 ** job.attempts),
          lease,
        ],
      );
    }
  }
}
