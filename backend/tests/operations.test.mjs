import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createServer as http } from "node:http";
import { createServer as tcp } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

// Tests have their own PostgreSQL cluster and use only loopback delivery sinks.
delete process.env.DATABASE_URL;
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "gh-accounts-"));
process.env.DATA_PROFILE = "commercial";
process.env.REQUIRE_LOGIN = "true";
process.env.COOKIE_SECURE = "false";
const listen = (server) =>
  new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server.address().port)),
  );
const calls = [],
  mail = [];
const webhook = http(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const data = JSON.parse(Buffer.concat(chunks));
  calls.push({ key: req.headers["idempotency-key"], data });
  res.writeHead(calls.length === 1 ? 503 : 200).end();
});
const smtp = tcp((socket) => {
  socket.write("220 localhost SMTP test\r\n");
  let buf = "",
    message = null;
  socket.on("data", (bytes) => {
    buf += bytes;
    let i;
    while ((i = buf.indexOf("\r\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (message !== null) {
        if (line !== ".") {
          message.push(line);
          continue;
        }
        mail.push(message.join("\n"));
        message = null;
      } else if (line === "DATA") {
        message = [];
        socket.write("354 Continue\r\n");
        continue;
      } else if (line === "QUIT") {
        socket.end("221 Bye\r\n");
        return;
      }
      socket.write("250 OK\r\n");
    }
  });
});
process.env.ALERT_WEBHOOK_URL = "http://127.0.0.1:" + (await listen(webhook));
process.env.SMTP_URL = "smtp://127.0.0.1:" + (await listen(smtp));
process.env.ALERT_EMAIL_FROM = "monitor@localhost";
process.env.ALERT_EMAIL_TO = "test@localhost";
const { app } = await import("../app.mjs");
const { enqueue, drainOutbox } = await import("../alerts.mjs");
const { db } = await import("../database.mjs");
const api = http(app);
const base = "http://127.0.0.1:" + (await listen(api)) + "/api";
const password = randomBytes(24).toString("hex");
function request(url, cookie, body, method = body ? "POST" : "GET") {
  return fetch(base + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
const cookie = (response) => response.headers.get("set-cookie")?.split(";")[0];
after(async () => {
  await Promise.all(
    [api, webhook, smtp].map((s) => new Promise((resolve) => s.close(resolve))),
  );
  await db.close();
});
test("accounts isolate rules, restrict the commercial profile, and deliver with a durable retry", async () => {
  assert.equal((await request("/catalog")).status, 401);
  const admin = cookie(
    await request("/auth/setup", null, {
      email: "admin@example.test",
      password,
    }),
  );
  assert.ok(admin);
  assert.equal(
    (
      await request("/auth/setup", null, {
        email: "second@example.test",
        password,
      })
    ).status,
    409,
  );
  for (const role of ["viewer", "analyst"]) {
    assert.equal(
      (
        await request("/accounts", admin, {
          email: role + "@example.test",
          role,
          password,
        })
      ).status,
      201,
    );
  }
  const viewer = cookie(
    await request("/auth/login", null, {
      email: "viewer@example.test",
      password,
    }),
  );
  const analyst = cookie(
    await request("/auth/login", null, {
      email: "analyst@example.test",
      password,
    }),
  );
  assert.equal((await request("/accounts", viewer)).status, 403);
  const restricted = await (
    await request("/layers/oil?start=2024-01-01&end=2024-01-02", viewer)
  ).json();
  assert.equal(restricted.status, "setup");
  assert.deepEqual(restricted.features, []);
  const rule = {
    name: "Test rule",
    layer: "earthquakes",
    center: [45, 24],
    radius: 10,
    minimum: 4,
    channel: "webhook",
  };
  assert.equal((await request("/alerts", viewer, rule)).status, 403);
  for (const channel of ["webhook", "email"]) {
    const response = await request("/alerts", analyst, { ...rule, channel });
    assert.equal(response.status, 201);
    const { id } = await response.json();
    const event = {
      id: "fixture",
      title: "Local delivery test",
      timestamp: "2024-01-01T00:00:00Z",
      source_url: "https://example.test/",
    };
    await Promise.all(
      [1, 2].map(() => enqueue({ ...rule, channel, id }, event)),
    );
  }
  assert.equal(
    (await (await request("/alerts", viewer)).json()).rules.length,
    0,
  );
  assert.equal(
    (await (await request("/alerts", analyst)).json()).notifications.length,
    2,
  );
  await Promise.all([drainOutbox(), drainOutbox()]);
  await db.query("UPDATE outbox SET available=now() WHERE state='pending'");
  await drainOutbox();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].key, calls[1].key);
  assert.equal(calls[1].data.event.id, "fixture");
  assert.equal(mail.length, 1);
  assert.match(mail[0], /Message-ID:\s+<[^>]+@gulfhazard\.local>/i);
  assert.equal(
    Number((await db.query("SELECT count(*) AS n FROM deliveries")).rows[0].n),
    2,
  );
  await db.query(
    "UPDATE outbox SET state='sending',available=now()-interval '1 minute' WHERE channel='email'",
  );
  await drainOutbox();
  assert.equal(mail.length, 1);
  assert.equal(
    (await (await request("/alerts", analyst)).json()).issues.length,
    1,
  );
  assert.equal((await request("/auth/logout", viewer, {})).status, 204);
  assert.equal((await request("/catalog", viewer)).status, 401);
});
test("OAuth renewal uses the provider expiry and coalesces concurrent requests", async () => {
  const { clientToken } = await import("../oauth.mjs");
  const original = globalThis.fetch,
    clock = Date.now;
  let grants = 0,
    now = clock();
  process.env.TEST_CLIENT_ID = "local-test";
  process.env.TEST_CLIENT_SECRET = password;
  globalThis.fetch = async () =>
    Response.json({ access_token: String(++grants), expires_in: 120 });
  Date.now = () => now;
  try {
    assert.deepEqual(
      await Promise.all(
        [1, 2].map(() => clientToken("TEST", "https://example.test/")),
      ),
      ["1", "1"],
    );
    now += 61000;
    assert.equal(await clientToken("TEST", "https://example.test/"), "2");
  } finally {
    Date.now = clock;
    globalThis.fetch = original;
  }
});
