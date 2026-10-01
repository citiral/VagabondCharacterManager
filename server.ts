import { blankHero } from "./public/engine.js";

function env(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

async function loadLocalEnv() {
  if (env("DATABASE_URL")) return;
  try {
    const text = await Deno.readTextFile(`${import.meta.dirname}/.env`);
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (env(key) === undefined) Deno.env.set(key, value);
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

await loadLocalEnv();

const connectionString = env("DATABASE_URL");

const publicDir = `${import.meta.dirname}/public`;
const port = Number(env("PORT") || 8080);
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".ico": "image/x-icon",
};

type HeroRecord = {
  id: string;
  name?: string;
  createdAt?: number;
  updatedAt?: number;
};

type HeroRow = { id: string; name: string; json: string; updatedAt: number };

type HeroStore = {
  list(): Promise<HeroRecord[]>;
  upsert(rows: HeroRow[]): Promise<void>;
  remove(id: string): Promise<void>;
  close(): Promise<void>;
};

const store = connectionString ? await openPostgres(connectionString) : await openSqlite();

async function openPostgres(url: string): Promise<HeroStore> {
  const { Pool } = await import("npm:pg");
  const localDb = /localhost|127\.0\.0\.1/.test(url);
  const pool = new Pool({
    connectionString: url,
    max: 5,
    ssl: localDb ? undefined : { rejectUnauthorized: false },
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS heroes (
      id text PRIMARY KEY,
      name text NOT NULL DEFAULT '',
      document jsonb NOT NULL,
      updated_at bigint NOT NULL
    )
  `);
  console.log("Party stored in Postgres");
  return {
    async list() {
      const result = await pool.query(`SELECT document FROM heroes ORDER BY name`);
      return result.rows.flatMap((row: { document: unknown }) => {
        const hero = readDocument(row.document);
        return hero ? [hero] : [];
      });
    },
    async upsert(rows) {
      if (!rows.length) return;
      await pool.query(
        `INSERT INTO heroes (id, name, document, updated_at)
         SELECT id, name, document::jsonb, updated_at
         FROM unnest($1::text[], $2::text[], $3::text[], $4::bigint[])
           AS t(id, name, document, updated_at)
         ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name,
             document = EXCLUDED.document,
             updated_at = EXCLUDED.updated_at`,
        [rows.map((row) => row.id), rows.map((row) => row.name), rows.map((row) => row.json), rows.map((row) => row.updatedAt)],
      );
    },
    async remove(id) {
      await pool.query(`DELETE FROM heroes WHERE id = $1`, [id]);
    },
    async close() {
      await pool.end();
    },
  };
}

async function openSqlite(): Promise<HeroStore> {
  const { DatabaseSync } = await import("node:sqlite");
  const dir = `${import.meta.dirname}/data`;
  await Deno.mkdir(dir, { recursive: true });
  const file = `${dir}/vagabond.sqlite`;
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS heroes (
      id text PRIMARY KEY,
      name text NOT NULL DEFAULT '',
      document text NOT NULL,
      updated_at integer NOT NULL
    )
  `);
  const upsertOne = db.prepare(
    `INSERT INTO heroes (id, name, document, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       document = excluded.document,
       updated_at = excluded.updated_at`,
  );
  const removeOne = db.prepare(`DELETE FROM heroes WHERE id = ?`);
  const listAll = db.prepare(`SELECT document FROM heroes ORDER BY name`);
  console.log(`Party stored in ${file}`);
  return {
    list() {
      return Promise.resolve(listAll.all().flatMap((row) => {
        const hero = readDocument((row as { document: unknown }).document);
        return hero ? [hero] : [];
      }));
    },
    upsert(rows) {
      if (!rows.length) return Promise.resolve();
      db.exec("BEGIN");
      try {
        for (const row of rows) upsertOne.run(row.id, row.name, row.json, row.updatedAt);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        return Promise.reject(error);
      }
      return Promise.resolve();
    },
    remove(id) {
      removeOne.run(id);
      return Promise.resolve();
    },
    close() {
      db.close();
      return Promise.resolve();
    },
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function asHero(value: unknown): HeroRecord | null {
  if (!value || typeof value !== "object") return null;
  return value as HeroRecord;
}

function readDocument(value: unknown): HeroRecord | null {
  if (typeof value === "string") {
    try {
      return asHero(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return asHero(value);
}

const FLUSH_MS = 8000;
const MAX_HERO_BYTES = 180_000;

let party: HeroRecord[] | null = null;
let loadingParty: Promise<HeroRecord[]> | null = null;
const persisted = new Map<string, string>();
const dirty = new Set<string>();
const sockets = new Set<WebSocket>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let tail: Promise<void> = Promise.resolve();

function snapshot(hero: HeroRecord) {
  return JSON.stringify(hero);
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task, task);
  tail = run.then(() => {}, () => {});
  return run;
}

async function ensureParty() {
  if (party) return party;
  if (!loadingParty) {
    loadingParty = listHeroes().then((heroes) => {
      party = heroes;
      for (const hero of heroes) persisted.set(hero.id, snapshot(hero));
      return heroes;
    }).catch((error) => {
      loadingParty = null;
      throw error;
    });
  }
  return await loadingParty;
}

function broadcast(message: unknown, except?: WebSocket) {
  const data = JSON.stringify(message);
  for (const socket of sockets) {
    if (socket === except || socket.readyState !== WebSocket.OPEN) continue;
    socket.send(data);
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    enqueue(flushDirty);
  }, FLUSH_MS);
}

async function flushDirty() {
  if (!party || dirty.size === 0) return;
  const ids = [...dirty];
  dirty.clear();
  const rows: { id: string; name: string; json: string; updatedAt: number }[] = [];
  for (const id of ids) {
    const hero = party.find((entry) => entry.id === id);
    if (!hero) continue;
    const json = snapshot(hero);
    if (persisted.get(id) === json) continue;
    rows.push({
      id,
      name: String(hero.name || ""),
      json,
      updatedAt: Number(hero.updatedAt) || Date.now(),
    });
  }
  if (!rows.length) return;
  try {
    await store.upsert(rows);
    for (const row of rows) {
      const current = party.find((entry) => entry.id === row.id);
      if (current && snapshot(current) === row.json) persisted.set(row.id, row.json);
      else dirty.add(row.id);
    }
    if (dirty.size) scheduleFlush();
  } catch (error) {
    for (const row of rows) dirty.add(row.id);
    scheduleFlush();
    console.error(error);
  }
}

function publish(hero: HeroRecord, except?: WebSocket) {
  if (!party) party = [];
  const previous = party.find((entry) => entry.id === hero.id);
  const stamped = { ...hero, updatedAt: Date.now() };
  if (previous && snapshot({ ...previous, updatedAt: 0 }) === snapshot({ ...stamped, updatedAt: 0 })) return previous;
  const index = party.findIndex((entry) => entry.id === hero.id);
  if (index >= 0) party[index] = stamped;
  else party.push(stamped);
  if (persisted.get(stamped.id) !== snapshot(stamped)) dirty.add(stamped.id);
  scheduleFlush();
  broadcast({ type: "upsert", hero: stamped }, except);
  return stamped;
}

async function persistNow(hero: HeroRecord) {
  return await enqueue(async () => {
    const stamped = publish(hero) ?? hero;
    const json = snapshot(stamped);
    if (persisted.get(stamped.id) === json) return stamped;
    try {
      await store.upsert([{
        id: stamped.id,
        name: String(stamped.name || ""),
        json,
        updatedAt: Number(stamped.updatedAt) || Date.now(),
      }]);
    } catch (error) {
      dirty.add(stamped.id);
      scheduleFlush();
      throw error;
    }
    const current = party?.find((entry) => entry.id === stamped.id);
    if (current && snapshot(current) === json) {
      dirty.delete(stamped.id);
      persisted.set(stamped.id, json);
    } else if (current) {
      dirty.add(stamped.id);
      scheduleFlush();
    }
    return stamped;
  });
}

async function forget(id: string, except?: WebSocket) {
  await enqueue(async () => {
    party = (party ?? []).filter((hero) => hero.id !== id);
    dirty.delete(id);
    persisted.delete(id);
    await store.remove(id);
    if ((party ?? []).some((hero) => hero.id === id)) {
      dirty.add(id);
      scheduleFlush();
      return;
    }
    broadcast({ type: "delete", id }, except);
  });
}

function listHeroes() {
  return store.list();
}

async function serveStatic(pathname: string) {
  const clean = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (clean.includes("..") || clean.includes("\\")) return json({ error: "Bad path" }, 400);
  const relative = clean || "index.html";
  const filePath = `${publicDir}/${relative}`;
  try {
    const [root, file] = await Promise.all([Deno.realPath(publicDir), Deno.realPath(filePath)]);
    if (!file.startsWith(root)) return json({ error: "Bad path" }, 400);
    const ext = file.slice(file.lastIndexOf("."));
    const body = await Deno.readFile(file);
    return new Response(body, {
      headers: {
        "content-type": types[ext] ?? "application/octet-stream",
        "cache-control": "no-cache",
      },
    });
  } catch {
    return json({ error: "Not found" }, 404);
  }
}

function liveSocket(request: Request) {
  const { socket, response } = Deno.upgradeWebSocket(request);
  sockets.add(socket);
  socket.onopen = () => {
    ensureParty()
      .then((heroes) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "party", heroes }));
      })
      .catch((error) => {
        console.error(error);
        socket.close();
      });
  };
  socket.onmessage = (event) => {
    let message: { type?: string; hero?: unknown; id?: unknown; error?: string } | null = null;
    try {
      message = typeof event.data === "string" ? JSON.parse(event.data) : null;
    } catch {
      return;
    }
    if (!message || typeof message !== "object") return;
    if (message.type === "ping") {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "pong" }));
      return;
    }
    if (message.type === "flush") {
      enqueue(flushDirty);
      return;
    }
    if (message.type === "delete") {
      const id = String(message.id || "");
      if (!ID.test(id)) return;
      forget(id, socket).catch((error) => console.error(error));
      return;
    }
    if (message.type !== "upsert") return;
    const hero = asHero(message.hero);
    if (!hero || !ID.test(String(hero.id || ""))) return;
    if (snapshot(hero).length > MAX_HERO_BYTES) {
      socket.send(JSON.stringify({ type: "error", error: "That hero is too large to save." }));
      return;
    }
    publish(hero, socket);
  };
  socket.onclose = () => {
    sockets.delete(socket);
    if (sockets.size === 0) enqueue(flushDirty);
  };
  socket.onerror = () => sockets.delete(socket);
  return response;
}

async function handler(request: Request) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/live") {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return json({ error: "Expected websocket" }, 426);
    return liveSocket(request);
  }

  try {
    if (path === "/api/heroes" && request.method === "GET") return json(await ensureParty());

    if (path === "/api/heroes" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      const hero = asHero(body) ?? blankHero();
      if (!ID.test(String(hero.id || ""))) hero.id = crypto.randomUUID();
      hero.createdAt = hero.createdAt || Date.now();
      if (snapshot(hero).length > MAX_HERO_BYTES) return json({ error: "That hero is too large to save." }, 413);
      return json(await persistNow(hero), 201);
    }

    const match = path.match(/^\/api\/heroes\/([^/]+)$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      if (!ID.test(id)) return json({ error: "Bad id" }, 400);
      if (request.method === "GET") {
        const heroes = await ensureParty();
        const hero = heroes.find((entry) => entry.id === id);
        return hero ? json(hero) : json({ error: "Not found" }, 404);
      }
      if (request.method === "PUT") {
        const hero = asHero(await request.json().catch(() => null));
        if (!hero || hero.id !== id) return json({ error: "Bad hero" }, 400);
        if (snapshot(hero).length > MAX_HERO_BYTES) return json({ error: "That hero is too large to save." }, 413);
        if (request.headers.get("x-immediate") === "1") return json(await persistNow(hero));
        return json(publish(hero) ?? hero);
      }
      if (request.method === "DELETE") {
        await forget(id);
        return json({ ok: true });
      }
    }
  } catch (error) {
    console.error(error);
    return json({ error: "Database error" }, 500);
  }

  if (path.startsWith("/api/")) return json({ error: "Not found" }, 404);
  return serveStatic(path);
}

function flushAndExit() {
  enqueue(async () => {
    try {
      await flushDirty();
    } finally {
      await store.close();
    }
  }).finally(() => Deno.exit(0));
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  try {
    Deno.addSignalListener(signal, flushAndExit);
  } catch {
    // Some platforms do not support every signal.
  }
}

Deno.serve({ port, hostname: "0.0.0.0" }, handler);
console.log(`Vagabond hero record at http://localhost:${port}`);
