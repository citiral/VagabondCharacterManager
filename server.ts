import { loadLocalEnv, env } from "./server/env.ts";
import { handleRequest } from "./server/routes.ts";
import { createParty } from "./server/party.ts";
import { openPostgres, openSqlite } from "./server/store.ts";

const root = import.meta.dirname!;
await loadLocalEnv(root);

const connectionString = env("DATABASE_URL");
const publicDir = `${root}/public`;
const port = Number(env("PORT") || 8080);

const store = connectionString ? await openPostgres(connectionString) : await openSqlite(`${root}/data`);
const party = createParty(store);

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

Deno.serve({ port, hostname: "0.0.0.0" }, (request) => handleRequest(request, party, publicDir));
console.log(`Vagabond hero record at http://localhost:${port}`);
