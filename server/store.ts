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

export type AccountStatus = "pending" | "approved" | "rejected";
export type AccountRole = "admin" | "user";

export type Account = {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
  status: AccountStatus;
  role: AccountRole;
  createdAt: number;
};

export type AccountPublic = Omit<Account, "passwordHash">;

export type AccountStore = {
  findByEmail(email: string): Promise<Account | null>;
  findById(id: string): Promise<Account | null>;
  create(account: Account): Promise<"ok" | "email" | "username">;
  listReview(): Promise<AccountPublic[]>;
  setStatus(id: string, status: AccountStatus): Promise<void>;
  setUsername(id: string, username: string): Promise<"ok" | "username" | "missing">;
};

export type Stores = { heroes: HeroStore; accounts: AccountStore };

type UserRow = {
  id: string;
  email: string;
  password_hash?: string;
  username?: string;
  status: string;
  role: string;
  created_at: number | string;
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

export async function openPostgres(url: string): Promise<Stores> {
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY,
      email text NOT NULL UNIQUE,
      username text NOT NULL DEFAULT '',
      password_hash text NOT NULL,
      status text NOT NULL,
      role text NOT NULL,
      created_at bigint NOT NULL
    )
  `);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username text NOT NULL DEFAULT ''`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username)) WHERE username <> ''`);
  console.log("Party stored in Postgres");

  function accountFrom(row: UserRow | undefined): Account | null {
    return readAccount(row);
  }

  const accounts: AccountStore = {
    async findByEmail(email) {
      const result = await pool.query(
        `SELECT id, email, username, password_hash, status, role, created_at FROM users WHERE email = $1`,
        [email],
      );
      return accountFrom(result.rows[0]);
    },
    async findById(id) {
      const result = await pool.query(
        `SELECT id, email, username, password_hash, status, role, created_at FROM users WHERE id = $1`,
        [id],
      );
      return accountFrom(result.rows[0]);
    },
    async create(account) {
      try {
        await pool.query(
          `INSERT INTO users (id, email, username, password_hash, status, role, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [account.id, account.email, account.username, account.passwordHash, account.status, account.role, account.createdAt],
        );
        return "ok";
      } catch (error) {
        const field = uniqueField(error);
        if (field) return field;
        throw error;
      }
    },
    async listReview() {
      const result = await pool.query(
        `SELECT id, email, username, status, role, created_at FROM users
         WHERE status IN ('pending', 'rejected')
         ORDER BY created_at`,
      );
      return result.rows.flatMap((row: UserRow) => {
        const account = accountFrom(row);
        return account ? [publicAccount(account)] : [];
      });
    },
    async setStatus(id, status) {
      await pool.query(`UPDATE users SET status = $1 WHERE id = $2`, [status, id]);
    },
    async setUsername(id, username) {
      try {
        const result = await pool.query(
          `UPDATE users SET username = $1 WHERE id = $2 AND username = ''`,
          [username, id],
        );
        return result.rowCount ? "ok" : "missing";
      } catch (error) {
        if (uniqueField(error) === "username") return "username";
        throw error;
      }
    },
  };

  return {
    accounts,
    heroes: {
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
  },
  };
}

export async function openSqlite(dir: string): Promise<Stores> {
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY,
      email text NOT NULL UNIQUE,
      username text NOT NULL DEFAULT '',
      password_hash text NOT NULL,
      status text NOT NULL,
      role text NOT NULL,
      created_at integer NOT NULL
    )
  `);
  if (!sqliteColumn(db, "users", "username")) {
    db.exec(`ALTER TABLE users ADD COLUMN username text NOT NULL DEFAULT ''`);
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username)) WHERE username <> ''`);
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
  const userColumns = `id, email, username, password_hash, status, role, created_at`;
  const findEmail = db.prepare(`SELECT ${userColumns} FROM users WHERE email = ?`);
  const findId = db.prepare(`SELECT ${userColumns} FROM users WHERE id = ?`);
  const insertUser = db.prepare(
    `INSERT INTO users (id, email, username, password_hash, status, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const reviewRows = db.prepare(
    `SELECT id, email, username, status, role, created_at FROM users WHERE status IN ('pending', 'rejected') ORDER BY created_at`,
  );
  const updateStatus = db.prepare(`UPDATE users SET status = ? WHERE id = ?`);
  const claimUsername = db.prepare(`UPDATE users SET username = ? WHERE id = ? AND username = ''`);
  console.log(`Party stored in ${file}`);

  const accounts: AccountStore = {
    findByEmail(email) {
      return Promise.resolve(readAccount(findEmail.get(email) as UserRow | undefined));
    },
    findById(id) {
      return Promise.resolve(readAccount(findId.get(id) as UserRow | undefined));
    },
    create(account) {
      try {
        insertUser.run(account.id, account.email, account.username, account.passwordHash, account.status, account.role, account.createdAt);
        return Promise.resolve("ok" as const);
      } catch (error) {
        const field = uniqueField(error);
        if (field) return Promise.resolve(field);
        return Promise.reject(error);
      }
    },
    listReview() {
      return Promise.resolve(reviewRows.all().flatMap((row) => {
        const account = readAccount(row as UserRow);
        return account ? [publicAccount(account)] : [];
      }));
    },
    setStatus(id, status) {
      updateStatus.run(status, id);
      return Promise.resolve();
    },
    setUsername(id, username) {
      try {
        const result = claimUsername.run(username, id) as { changes?: number };
        return Promise.resolve(result.changes ? "ok" as const : "missing" as const);
      } catch (error) {
        if (uniqueField(error) === "username") return Promise.resolve("username" as const);
        return Promise.reject(error);
      }
    },
  };

  return {
    accounts,
    heroes: {
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
  },
  };
}

function readAccount(row: UserRow | undefined): Account | null {
  if (!row) return null;
  const status = row.status === "pending" || row.status === "approved" || row.status === "rejected" ? row.status : null;
  const role = row.role === "admin" || row.role === "user" ? row.role : null;
  if (!status || !role || typeof row.id !== "string" || typeof row.email !== "string") return null;
  return {
    id: row.id,
    email: row.email,
    username: typeof row.username === "string" ? row.username : "",
    passwordHash: typeof row.password_hash === "string" ? row.password_hash : "",
    status,
    role,
    createdAt: Number(row.created_at),
  };
}

function sqliteColumn(db: { prepare(sql: string): { all(): unknown[] } }, table: string, column: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name?: string }[];
  return rows.some((row) => row.name === column);
}

function uniqueField(error: unknown): "email" | "username" | null {
  const message = error instanceof Error ? error.message : "";
  const constraint = error && typeof error === "object" && "constraint" in error ? String(error.constraint) : "";
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const text = `${message} ${constraint}`.toLowerCase();
  if (!text.includes("unique") && code !== "23505") return null;
  if (text.includes("username")) return "username";
  return "email";
}

function publicAccount(account: Account): AccountPublic {
  return {
    id: account.id,
    email: account.email,
    username: account.username,
    status: account.status,
    role: account.role,
    createdAt: account.createdAt,
  };
}
