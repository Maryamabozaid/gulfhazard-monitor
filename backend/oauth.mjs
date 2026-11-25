import { json, SetupError } from "./net.mjs";
const tokens = new Map(),
  pending = new Map();
export async function clientToken(key, url) {
  const client = process.env[key + "_CLIENT_ID"],
    secret = process.env[key + "_CLIENT_SECRET"];
  if (!client || !secret)
    throw new SetupError("Configure " + key + " client credentials.");
  const entry = tokens.get(key);
  if (entry?.expires > Date.now()) return entry.token;
  if (!pending.has(key)) {
    const work = json(url, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: client,
        client_secret: secret,
      }),
    })
      .then((r) => {
        if (!r.access_token || !Number.isFinite(Number(r.expires_in)))
          throw Error("Provider returned invalid credentials response.");
        tokens.set(key, {
          token: r.access_token,
          expires: Date.now() + Math.max(1, r.expires_in - 60) * 1000,
        });
        return r.access_token;
      })
      .finally(() => pending.delete(key));
    pending.set(key, work);
  }
  return pending.get(key);
}
