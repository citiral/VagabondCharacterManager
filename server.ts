import { loadLocalEnv, env } from "./server/env.ts";
import { handleRequest } from "./server/routes.ts";
import { createParty } from "./server/party.ts";
import { openPostgres, openSqlite } from "./server/store.ts";

const root = import.meta.dirname!;
await loadLocalEnv(root);

const connectionString = env("DATABASE_URL");
const publicDir = `${root}/public`;
const port = Number(env("PORT") || 8080);
const secret = env("AUTH_SECRET") ?? "";
if (secret.length < 16) {
  console.error("Set AUTH_SECRET to a random string of at least 16 characters.");
  Deno.exit(1);
}
const adminEmail = (env("ADMIN_EMAIL") ?? "").trim().toLowerCase();
if (!adminEmail) console.warn("ADMIN_EMAIL is unset. No account can approve new users.");

const stores = connectionString ? await openPostgres(connectionString) : await openSqlite(`${root}/data`);
const party = createParty(stores.heroes);

function flushAndExit() {
  party.shutdown().finally(() => Deno.exit(0));
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  try {
    Deno.addSignalListener(signal, flushAndExit);
  } catch {
    // Some platforms do not support every signal.
  }
}

Deno.serve({ port, hostname: "0.0.0.0" }, (request) => handleRequest(request, party, stores.accounts, { secret, adminEmail }, publicDir));
console.log(`Vagabond hero record at http://localhost:${port}`);
