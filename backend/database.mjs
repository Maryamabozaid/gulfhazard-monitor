import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { restriction, profile } from "./licensing.mjs";
import { fileURLToPath } from "node:url";
const folder = path.resolve(fileURLToPath(new URL("../", import.meta.url)), process.env.DATA_DIR || "data");
mkdirSync(folder, { recursive: true });
const remote = !!process.env.DATABASE_URL;
export const databaseKind = remote ? "PostgreSQL/PostGIS" : "PGlite/PostGIS";
async function connect() {
  if (remote) {
    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 12,
    });
    return {
      query: (sql, args = []) => pool.query(sql, args),
      close: () => pool.end(),
      transaction: async (fn) => {
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          const result = await fn(c);
          await c.query("COMMIT");
          return result;
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        } finally {
          c.release();
        }
      },
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { postgis } = await import("@electric-sql/pglite-postgis");
  const pg = new PGlite(path.join(folder, "postgres"), {
    extensions: { postgis },
  });
  return {
    query: (sql, args = []) => pg.query(sql, args),
    close: () => pg.close(),
    transaction: (fn) => pg.transaction(fn),
  };
}
export const db = await connect();
export const first = async (sql, args = []) =>
  (await db.query(sql, args)).rows[0];
await db.transaction(async (c) => {
  if (remote) await c.query("SELECT pg_advisory_xact_lock(54721221)");
  for (const sql of [
    "CREATE EXTENSION IF NOT EXISTS postgis",
    "CREATE TABLE IF NOT EXISTS migrations (name text PRIMARY KEY)",
    "CREATE TABLE IF NOT EXISTS responses (key text PRIMARY KEY,layer text NOT NULL,at text NOT NULL,data bytea NOT NULL)",
    "CREATE INDEX IF NOT EXISTS resp_recent ON responses(layer,at)",
    "CREATE TABLE IF NOT EXISTS accounts(id text PRIMARY KEY,email text NOT NULL UNIQUE,hash text NOT NULL,role text NOT NULL CHECK(role IN ('viewer','analyst','admin')),active boolean NOT NULL DEFAULT true)",
    "CREATE TABLE IF NOT EXISTS sessions(token text PRIMARY KEY,account text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,expires timestamptz NOT NULL)",
    "CREATE TABLE IF NOT EXISTS login_limits(key text PRIMARY KEY,n integer NOT NULL,until_at timestamptz NOT NULL)",
    "CREATE TABLE IF NOT EXISTS rules(id text PRIMARY KEY,body text NOT NULL,created text NOT NULL,owner_id text REFERENCES accounts(id),region geometry(Geometry,4326))",
    "CREATE INDEX IF NOT EXISTS rules_region ON rules USING gist(region)",
    "CREATE TABLE IF NOT EXISTS notifications(rule text NOT NULL,event text NOT NULL,title text NOT NULL,created text NOT NULL,PRIMARY KEY(rule,event))",
    "CREATE TABLE IF NOT EXISTS deliveries(rule text,event text,channel text,sent text,PRIMARY KEY(rule,event,channel))",
    "CREATE TABLE IF NOT EXISTS outbox(rule text REFERENCES rules(id) ON DELETE CASCADE,event text,channel text,payload jsonb NOT NULL,state text NOT NULL DEFAULT 'pending',attempts integer NOT NULL DEFAULT 0,available timestamptz NOT NULL DEFAULT now(),lease text,PRIMARY KEY(rule,event,channel))",
    "CREATE INDEX IF NOT EXISTS pending_jobs ON outbox(state,available)",
    "CREATE TABLE IF NOT EXISTS providers(profile text,layer text,success text,failure text,problem text,down boolean DEFAULT false,PRIMARY KEY(profile,layer))",
  ])
    await c.query(sql);
  const old = path.join(folder, "monitor.sqlite");
  if (
    !existsSync(old) ||
    (await c.query("SELECT 1 FROM migrations WHERE name='legacy-sqlite-v1'"))
      .rows.length
  )
    return;
  // Keep the old database intact. Import committed rows in one transaction.
  const { DatabaseSync } = await import("node:sqlite");
  const legacy = new DatabaseSync(old, { readOnly: true });
  try {
    for (const r of legacy.prepare("SELECT * FROM responses").iterate()) {
      if (profile === "research" && !restriction(r.layer))
        await c.query(
          "INSERT INTO responses VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [profile + "|" + r.key, r.layer, r.at, r.data],
        );
    }
    for (const r of legacy.prepare("SELECT * FROM rules").iterate()) {
      if (!restriction(JSON.parse(r.body).layer))
        await c.query(
          "INSERT INTO rules(id,body,created) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [r.id, r.body, r.created],
        );
    }
    for (const [table, cols] of [
      ["notifications", ["rule", "event", "title", "created"]],
      ["deliveries", ["rule", "event", "channel", "sent"]],
    ]) {
      for (const r of legacy.prepare("SELECT * FROM " + table).iterate())
        await c.query(
          "INSERT INTO " +
            table +
            " SELECT $1,$2,$3,$4 WHERE EXISTS(SELECT 1 FROM rules WHERE id=$1) ON CONFLICT DO NOTHING",
          cols.map((k) => r[k]),
        );
    }
    await c.query("INSERT INTO migrations VALUES('legacy-sqlite-v1')");
  } finally {
    legacy.close();
  }
});
