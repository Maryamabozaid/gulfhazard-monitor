import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt as derive,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { db, first } from "./database.mjs";
const scrypt = promisify(derive);
const hashToken = (v) => createHash("sha256").update(v).digest("hex");
const cookie = "gh_session";
const fail = (status, message) => Object.assign(Error(message), { status });
const emailOf = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");
export const local = (req) =>
  ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress) &&
  /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.get("host") || "");
export const guarded =
  process.env.REQUIRE_LOGIN === "true" ||
  (!!process.env.DATABASE_URL && process.env.REQUIRE_LOGIN !== "false");
async function passwordHash(password, salt = randomBytes(16).toString("hex")) {
  return (
    salt +
    ":" +
    (
      await scrypt(password, salt, 64, {
        N: 32768,
        r: 8,
        p: 1,
        maxmem: 64 * 1024 * 1024,
      })
    ).toString("hex")
  );
}
export async function createAccount(input, bootstrap = false) {
  const email = emailOf(input.email),
    role = bootstrap ? "admin" : input.role;
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254 ||
    !["viewer", "analyst", "admin"].includes(role) ||
    typeof input.password !== "string" ||
    input.password.length < 12 ||
    input.password.length > 256
  )
    throw fail(
      400,
      "Enter a valid email, a role and a password of 12–256 characters.",
    );
  const hash = await passwordHash(input.password),
    id = randomUUID();
  return db.transaction(async (c) => {
    await c.query("LOCK TABLE accounts IN SHARE ROW EXCLUSIVE MODE");
    if (
      bootstrap &&
      (await c.query("SELECT 1 FROM accounts LIMIT 1")).rows.length
    )
      throw fail(409, "An administrator already exists.");
    if (
      (await c.query("SELECT id FROM accounts WHERE email=$1", [email])).rows
        .length
    )
      throw fail(409, "Email already registered.");
    await c.query(
      "INSERT INTO accounts(id,email,role,hash) VALUES($1,$2,$3,$4)",
      [id, email, role, hash],
    );
    return { id, email, role };
  });
}
function token(req) {
  return /(?:^|;\s*)gh_session=([a-f0-9]{64})(?:;|$)/.exec(
    req.get("cookie") || "",
  )?.[1];
}
export async function identity(req) {
  const value = token(req);
  return value
    ? await first(
        "SELECT a.id,a.email,a.role FROM accounts a JOIN sessions s ON s.account=a.id WHERE s.token=$1 AND s.expires>now() AND a.active",
        [hashToken(value)],
      )
    : null;
}
export const requireRole =
  (...roles) =>
  async (req, res, next) => {
    req.user ??= await identity(req);
    if (!req.user)
      return res.status(401).json({ message: "Sign in to continue." });
    if (!roles.includes(req.user.role))
      return res
        .status(403)
        .json({ message: "Your account does not have this permission." });
    next();
  };
const sessionOptions = (req) => ({
  httpOnly: true,
  sameSite: "strict",
  secure: req.secure || process.env.COOKIE_SECURE === "true",
  path: "/",
});
async function issue(req, res, user) {
  const secret = randomBytes(32).toString("hex");
  await db.query("DELETE FROM sessions WHERE expires<=now()");
  await db.query(
    "INSERT INTO sessions VALUES($1,$2,now()+interval '12 hours')",
    [hashToken(secret), user.id],
  );
  res
    .cookie(cookie, secret, { ...sessionOptions(req), maxAge: 12 * 3600000 })
    .json({ user: { id: user.id, email: user.email, role: user.role } });
}
export function accountRoutes(app) {
  app.use("/api", (req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin");
      if (
        (origin &&
          URL.canParse(origin) &&
          new URL(origin).host !== req.get("host")) ||
        (origin && !URL.canParse(origin))
      )
        return res.sendStatus(403);
      if (req.method === "POST" && !req.is("application/json"))
        return res.status(415).json({ message: "Use application/json." });
    }
    next();
  });
  app.use(["/api/auth", "/api/accounts", "/api/alerts"], (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.get("/api/auth/session", async (req, res) =>
    res.json({
      user: (await identity(req)) || null,
      setup: local(req) && !(await first("SELECT id FROM accounts LIMIT 1")),
      required: guarded,
    }),
  );
  app.post("/api/auth/setup", async (req, res) => {
    if (!local(req)) return res.sendStatus(403);
    await issue(req, res, await createAccount(req.body, true));
  });
  app.post("/api/auth/login", async (req, res) => {
    const email = emailOf(req.body.email),
      password = req.body.password;
    if (
      typeof password !== "string" ||
      password.length > 256 ||
      !email ||
      email.length > 254
    )
      throw fail(400, "Invalid login.");
    await db.query("DELETE FROM login_limits WHERE until_at < now()");
    const key = hashToken("login:" + req.socket.remoteAddress);
    const attempts = await first(
      "INSERT INTO login_limits VALUES($1,1,now()+interval '10 minutes') ON CONFLICT(key) DO UPDATE SET n=login_limits.n+1 RETURNING n",
      [key],
    );
    if (attempts.n > 20) throw fail(429, "Try again after ten minutes.");
    const user = await first(
      "SELECT * FROM accounts WHERE email=$1 AND active",
      [email],
    );
    const salt = user?.hash.split(":")[0] || "e8d2b73066d32c14ab81767575a1abe2";
    const computed = await passwordHash(password, salt);
    if (
      !user ||
      !timingSafeEqual(Buffer.from(computed), Buffer.from(user.hash))
    )
      throw fail(401, "Incorrect email or password.");
    await db.query("DELETE FROM login_limits WHERE key=$1", [key]);
    await issue(req, res, user);
  });
  app.post("/api/auth/logout", async (req, res) => {
    if (token(req))
      await db.query("DELETE FROM sessions WHERE token=$1", [
        hashToken(token(req)),
      ]);
    res.clearCookie(cookie, sessionOptions(req)).sendStatus(204);
  });
  app.get("/api/accounts", requireRole("admin"), async (_req, res) =>
    res.json(
      (
        await db.query(
          "SELECT id,email,role,active FROM accounts ORDER BY email",
        )
      ).rows,
    ),
  );
  app.post("/api/accounts", requireRole("admin"), async (req, res) =>
    res.status(201).json(await createAccount(req.body)),
  );
  app.patch("/api/accounts/:id", requireRole("admin"), async (req, res) => {
    const { role, active } = req.body;
    if (
      req.params.id === req.user.id ||
      !["admin", "analyst", "viewer"].includes(role) ||
      typeof active !== "boolean"
    )
      throw fail(400, "Invalid account change.");
    await db.transaction(async (c) => {
      await c.query("LOCK TABLE accounts IN SHARE ROW EXCLUSIVE MODE");
      const author = (
        await c.query("SELECT role,active FROM accounts WHERE id=$1", [
          req.user.id,
        ])
      ).rows[0];
      if (!author?.active || author.role !== "admin")
        throw fail(403, "An active administrator is required.");
      if (
        !(await c.query("SELECT id FROM accounts WHERE id=$1", [req.params.id]))
          .rows.length
      )
        throw fail(404, "Unknown account.");
      await c.query("UPDATE accounts SET role=$1,active=$2 WHERE id=$3", [
        role,
        active,
        req.params.id,
      ]);
      await c.query("DELETE FROM sessions WHERE account=$1", [req.params.id]);
    });
    res.sendStatus(204);
  });
  if (guarded)
    app.use("/api", (req, res, next) =>
      ["/health", "/health/providers"].includes(req.path)
        ? next()
        : requireRole("admin", "analyst", "viewer")(req, res, next),
    );
}
