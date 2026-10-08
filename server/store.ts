// Where heroes are stored. Postgres when DATABASE_URL is set, otherwise a SQLite file.
// Both speak the same HeroStore interface; the rest of the server doesn't care which.

export const HERO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_HERO_BYTES = 180_000;

export type HeroRecord = {
  id: string;
  name?: string;
  createdAt?: number;
  updatedAt?: number;
};

export type HeroRow = { id: string; name: string; json: string; updatedAt: number };

export type HeroStore = {
  list(): Promise<HeroRecord[]>;
  upsert(rows: HeroRow[]): Promise<void>;
  remove(id: string): Promise<void>;
  close(): Promise<void>;
};

export function asHero(value: unknown): HeroRecord | null {
  if (!value || typeof value !== "object") return null;
  return value as HeroRecord;
}

export function snapshot(hero: HeroRecord) {
  return JSON.stringify(hero);
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

export async function openPostgres(url: string): Promise<HeroStore> {
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

export async function openSqlite(dir: string): Promise<HeroStore> {
  const { DatabaseSync } = await import("node:sqlite");
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
