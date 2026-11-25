import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
if (!process.env.DATABASE_URL)
  throw Error(
    "Use the local Account button for embedded PostgreSQL. This command targets DATABASE_URL.",
  );
const { createAccount } = await import("../backend/accounts.mjs");
const { db } = await import("../backend/database.mjs");
let muted = false;
const output = new Writable({
  write(chunk, _encoding, done) {
    if (!muted) process.stdout.write(chunk);
    done();
  },
});
const rl = createInterface({
  input: process.stdin,
  output,
  terminal: !!process.stdin.isTTY,
});
try {
  const email = await rl.question("Administrator email: ");
  process.stdout.write("Administrator password (12+ characters): ");
  muted = true;
  const password = await rl.question("");
  muted = false;
  process.stdout.write("\n");
  await createAccount({ email, password }, true);
  console.log("Administrator created.");
} finally {
  rl.close();
  await db.close();
}
