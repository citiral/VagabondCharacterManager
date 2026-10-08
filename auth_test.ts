import { hashPassword, signToken, userIdFromToken, verifyPassword } from "./server/auth.ts";
import { createParty } from "./server/party.ts";
import { handleRequest } from "./server/routes.ts";
import { openSqlite } from "./server/store.ts";

const secret = "test-secret-value-123";
const adminEmail = "me@example.com";
const friendEmail = "friend@example.com";
const password = "correct-horse";

Deno.test("password hash verifies only the same password", async () => {
  const stored = await hashPassword(password);
  if (!await verifyPassword(password, stored)) throw new Error("expected the password to match");
  if (await verifyPassword("wrong-password", stored)) throw new Error("expected a different password to fail");
  if (await verifyPassword(password, "pbkdf2-sha256$1$aaaa$bbbb")) throw new Error("expected a cheap hash to be refused");
});

Deno.test("token names the user until it expires or is altered", async () => {
  const token = await signToken(secret, "user-1");
  if (await userIdFromToken(secret, token) !== "user-1") throw new Error("expected the subject");
  if (await userIdFromToken("other-secret-value", token) !== null) throw new Error("expected a different secret to fail");
  const expired = await signToken(secret, "user-1", Date.now() - 31 * 24 * 60 * 60 * 1000);
  if (await userIdFromToken(secret, expired) !== null) throw new Error("expected an expired token to fail");
  const [header, payload, signature] = token.split(".");
  const flipped = `${header}.${payload}.${signature.slice(0, -1)}${signature.endsWith("a") ? "b" : "a"}`;
  if (await userIdFromToken(secret, flipped) !== null) throw new Error("expected a tampered token to fail");
});

Deno.test("an older user table gains a username column", async () => {
  const dir = await Deno.makeTempDir();
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(`${dir}/vagabond.sqlite`);
  db.exec(`CREATE TABLE users (
    id text PRIMARY KEY,
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    status text NOT NULL,
    role text NOT NULL,
    created_at integer NOT NULL
  )`);
  db.close();
  const { heroes, accounts } = await openSqlite(dir);
  try {
    const created = await accounts.create({
      id: crypto.randomUUID(),
      email: "old@example.com",
      username: "Old",
      passwordHash: await hashPassword(password),
      status: "approved",
      role: "user",
      createdAt: Date.now(),
    });
    if (created !== "ok") throw new Error("expected the migrated table to accept a username");
    const account = await accounts.findByEmail("old@example.com");
    if (account?.username !== "Old") throw new Error("expected the username to be stored");
  } finally {
    await heroes.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("only an approved account can open the app", async () => {
  const dir = await Deno.makeTempDir();
  const { heroes, accounts } = await openSqlite(dir);
  const party = createParty(heroes);
  const auth = { secret, adminEmail };
  const publicDir = `${import.meta.dirname}/public`;

  async function send(path: string, init: RequestInit = {}) {
    return await handleRequest(new Request(`http://localhost${path}`, init), party, accounts, auth, publicDir);
  }

  function form(body: Record<string, string>) {
    return { method: "POST", body: new URLSearchParams(body) };
  }

  function tokenFrom(response: Response) {
    const cookie = response.headers.get("set-cookie") ?? "";
    return cookie.match(/^auth=([^;]*)/)?.[1] ?? "";
  }

  try {
    const home = await send("/");
    if (home.status !== 303 || home.headers.get("location") !== "/login") throw new Error("expected the sheet to redirect to login");
    const api = await send("/api/heroes");
    if (api.status !== 401) throw new Error("expected the party API to refuse a stranger");

    const registered = await send("/register", form({ username: "Friend", email: friendEmail, password }));
    const registeredText = await registered.text();
    if (registered.status !== 200 || !registeredText.includes("waiting for approval")) throw new Error("expected a pending registration");
    if (registered.headers.get("set-cookie")) throw new Error("a pending account must not receive a token");

    const waiting = await send("/login", form({ email: friendEmail, password }));
    const waitingText = await waiting.text();
    if (!waitingText.includes("waiting for approval") || waiting.headers.get("set-cookie")) {
      throw new Error("a pending login must stay on the page without a token");
    }
    const wrong = await send("/login", form({ email: friendEmail, password: "not-the-password" }));
    if (!(await wrong.text()).includes("Email or password is wrong.")) throw new Error("expected a generic login failure");

    const admin = await send("/register", form({ username: "Me", email: "Me@Example.com", password }));
    const adminToken = tokenFrom(admin);
    if (admin.status !== 303 || !adminToken) throw new Error("expected the admin address to be signed in");

    const approvals = await send("/admin", { headers: { cookie: `auth=${adminToken}` } });
    if (approvals.status !== 200 || !(await approvals.text()).includes("Friend")) {
      throw new Error("expected the admin page to list the pending account");
    }

    const taken = await send("/register", form({ username: "friend", email: "other@example.com", password }));
    if (taken.status !== 409 || !(await taken.text()).includes("That username is taken.")) {
      throw new Error("expected a duplicate username to be refused");
    }

    const friend = await accounts.findByEmail(friendEmail);
    if (!friend) throw new Error("missing friend");
    const rejected = await send(`/admin/users/${friend.id}/reject`, { method: "POST", headers: { cookie: `auth=${adminToken}` } });
    if (rejected.status !== 303) throw new Error("expected reject to redirect");
    const declined = await send("/login", form({ email: friendEmail, password }));
    if (!(await declined.text()).includes("This account was declined.")) throw new Error("expected a declined login");

    const approved = await send(`/admin/users/${friend.id}/approve`, { method: "POST", headers: { cookie: `auth=${adminToken}` } });
    if (approved.status !== 303) throw new Error("expected approve to redirect");
    const signedIn = await send("/login", form({ email: friendEmail, password }));
    const friendToken = tokenFrom(signedIn);
    if (signedIn.status !== 303 || !friendToken) throw new Error("expected an approved login to set a token");

    const partyResponse = await send("/api/heroes", { headers: { cookie: `auth=${friendToken}` } });
    if (partyResponse.status !== 200) throw new Error("expected an approved account to read the party");
    const me = await send("/api/me", { headers: { cookie: `auth=${friendToken}` } });
    const profile = await me.json();
    if (me.status !== 200 || profile.username !== "Friend") throw new Error("expected the signed-in username");
    const hidden = await send("/admin", { headers: { cookie: `auth=${friendToken}` } });
    if (hidden.status !== 404) throw new Error("expected a non-admin to miss the approval page");

    await send(`/admin/users/${friend.id}/reject`, { method: "POST", headers: { cookie: `auth=${adminToken}` } });
    const kicked = await send("/api/heroes", { headers: { cookie: `auth=${friendToken}` } });
    if (kicked.status !== 401) throw new Error("expected rejection to close an existing token");
  } finally {
    await party.shutdown();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("an account without a username chooses one before the sheet", async () => {
  const dir = await Deno.makeTempDir();
  const { heroes, accounts } = await openSqlite(dir);
  const party = createParty(heroes);
  const auth = { secret, adminEmail: "keeper@example.com" };
  const publicDir = `${import.meta.dirname}/public`;
  const send = (path: string, init: RequestInit = {}) =>
    handleRequest(new Request(`http://localhost${path}`, init), party, accounts, auth, publicDir);

  try {
    await accounts.create({
      id: crypto.randomUUID(),
      email: "keeper@example.com",
      username: "",
      passwordHash: await hashPassword(password),
      status: "approved",
      role: "user",
      createdAt: Date.now(),
    });
    const signedIn = await send("/login", {
      method: "POST",
      body: new URLSearchParams({ email: "keeper@example.com", password }),
    });
    const token = signedIn.headers.get("set-cookie")?.match(/^auth=([^;]*)/)?.[1] ?? "";
    const home = await send("/", { headers: { cookie: `auth=${token}` } });
    if (home.status !== 303 || home.headers.get("location") !== "/username") {
      throw new Error("expected the sheet to wait for a username");
    }
    const saved = await send("/username", {
      method: "POST",
      headers: { cookie: `auth=${token}` },
      body: new URLSearchParams({ username: "Keeper" }),
    });
    if (saved.status !== 303 || saved.headers.get("location") !== "/") throw new Error("expected the username to be saved");
    const me = await send("/api/me", { headers: { cookie: `auth=${token}` } });
    if ((await me.json()).username !== "Keeper") throw new Error("expected the chosen username");
  } finally {
    await party.shutdown();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("an older hero table can be claimed", async () => {
  const dir = await Deno.makeTempDir();
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(`${dir}/vagabond.sqlite`);
  db.exec(`CREATE TABLE heroes (
    id text PRIMARY KEY,
    name text NOT NULL DEFAULT '',
    document text NOT NULL,
    updated_at integer NOT NULL
  )`);
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO heroes (id, name, document, updated_at) VALUES (?, ?, ?, ?)`).run(
    id,
    "Old",
    JSON.stringify({ id, name: "Old", notes: "from before accounts" }),
    Date.now(),
  );
  db.close();
  const { heroes, accounts } = await openSqlite(dir);
  try {
    const ownerId = crypto.randomUUID();
    await accounts.create({
      id: ownerId,
      email: "keeper@example.com",
      username: "Keeper",
      passwordHash: await hashPassword(password),
      status: "approved",
      role: "user",
      createdAt: Date.now(),
    });
    const listed = await heroes.list();
    const sheet = listed[0] as { ownerId?: string | null; notes?: string };
    if (listed.length !== 1 || sheet?.ownerId || sheet?.notes !== "from before accounts") {
      throw new Error("expected the old hero to stay unclaimed");
    }
    if (!await heroes.claim(id, ownerId)) throw new Error("expected claim");
    const claimed = await heroes.list();
    if (claimed[0].ownerId !== ownerId || claimed[0].ownerName !== "Keeper") throw new Error("expected the claim to stick");
    if (await heroes.claim(id, crypto.randomUUID())) throw new Error("expected a second claim to fail");
    if (!await heroes.release(id, ownerId)) throw new Error("expected release");
    if ((await heroes.list())[0].ownerId) throw new Error("expected release to clear the owner");
  } finally {
    await heroes.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("only the owner can edit a hero, and an unclaimed hero can be claimed", async () => {
  const dir = await Deno.makeTempDir();
  const { heroes, accounts } = await openSqlite(dir);
  const party = createParty(heroes);
  const auth = { secret, adminEmail };
  const publicDir = `${import.meta.dirname}/public`;
  const send = (path: string, init: RequestInit = {}) =>
    handleRequest(new Request(`http://localhost${path}`, init), party, accounts, auth, publicDir);

  const strayId = crypto.randomUUID();

  try {
    await heroes.upsert([{
      id: strayId,
      name: "Stray",
      json: JSON.stringify({ id: strayId, name: "Stray", notes: "found on the road" }),
      updatedAt: Date.now(),
      ownerId: null,
    }]);
    await accounts.create({
      id: crypto.randomUUID(),
      email: friendEmail,
      username: "Friend",
      passwordHash: await hashPassword(password),
      status: "approved",
      role: "user",
      createdAt: Date.now(),
    });
    const admin = await send("/register", {
      method: "POST",
      body: new URLSearchParams({ username: "Me", email: adminEmail, password }),
    });
    const adminToken = admin.headers.get("set-cookie")?.match(/^auth=([^;]*)/)?.[1] ?? "";
    const friend = await send("/login", {
      method: "POST",
      body: new URLSearchParams({ email: friendEmail, password }),
    });
    const friendToken = friend.headers.get("set-cookie")?.match(/^auth=([^;]*)/)?.[1] ?? "";
    const friendAccount = await accounts.findByEmail(friendEmail);
    const adminAccount = await accounts.findByEmail(adminEmail);
    if (!friendAccount || !adminAccount || !friendToken || !adminToken) throw new Error("expected both accounts to sign in");

    const as = (token: string, method: string, body?: unknown) => ({
      method,
      headers: { cookie: `auth=${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const created = await send("/api/heroes", as(friendToken, "POST", { name: "Briar", notes: "carries a lamp" }));
    const briar = await created.json();
    if (created.status !== 201 || briar.ownerId !== friendAccount.id || briar.ownerName !== "Friend" || briar.notes !== "carries a lamp") {
      throw new Error("expected a new hero to belong to its creator");
    }

    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(`${dir}/vagabond.sqlite`);
    const stored = db.prepare(`SELECT document, owner_id FROM heroes WHERE id = ?`).get(briar.id) as { document: string; owner_id: string };
    db.close();
    if (stored.owner_id !== friendAccount.id || stored.document.includes("ownerId")) {
      throw new Error("expected ownership to stay out of the sheet");
    }

    const seen = await send(`/api/heroes/${briar.id}`, as(adminToken, "GET"));
    const viewed = await seen.json();
    if (seen.status !== 200 || viewed.notes !== "carries a lamp" || viewed.ownerName !== "Friend") {
      throw new Error("expected another player to see the same sheet");
    }

    const stolen = await send(`/api/heroes/${briar.id}`, as(adminToken, "PUT", { ...viewed, notes: "rewritten", ownerId: adminAccount.id }));
    if (stolen.status !== 403) throw new Error("expected another player to be refused");
    const afterSteal = await (await send(`/api/heroes/${briar.id}`, as(friendToken, "GET"))).json();
    if (afterSteal.notes !== "carries a lamp" || afterSteal.ownerId !== friendAccount.id) {
      throw new Error("expected a refused edit to leave the hero alone");
    }

    const removed = await send(`/api/heroes/${briar.id}`, as(adminToken, "DELETE"));
    if (removed.status !== 403) throw new Error("expected another player to be refused a delete");

    const kept = await send(`/api/heroes/${briar.id}`, as(friendToken, "PUT", { ...afterSteal, notes: "lamp trimmed" }));
    const trimmed = await kept.json();
    if (kept.status !== 200 || trimmed.notes !== "lamp trimmed" || trimmed.ownerId !== friendAccount.id) {
      throw new Error("expected the owner to save");
    }

    const strayEdit = await send(`/api/heroes/${strayId}`, as(friendToken, "PUT", { id: strayId, name: "Stray", notes: "taken without claiming" }));
    if (strayEdit.status !== 403 || !(await strayEdit.json()).error.includes("Claim")) {
      throw new Error("expected an unclaimed hero to be read-only");
    }
    const strayDelete = await send(`/api/heroes/${strayId}`, as(adminToken, "DELETE"));
    if (strayDelete.status !== 403) throw new Error("expected an unclaimed hero to stay until it is claimed");

    const tooSoon = await send(`/api/heroes/${briar.id}/claim`, as(adminToken, "POST"));
    if (tooSoon.status !== 409) throw new Error("expected a claimed hero to refuse a second owner");
    const released = await send(`/api/heroes/${briar.id}/release`, as(friendToken, "POST"));
    const free = await released.json();
    if (released.status !== 200 || free.ownerId !== null) throw new Error("expected release to clear the owner");
    const reclaimed = await send(`/api/heroes/${briar.id}/claim`, as(adminToken, "POST"));
    const mine = await reclaimed.json();
    if (reclaimed.status !== 200 || mine.ownerId !== adminAccount.id || mine.ownerName !== "Me" || mine.notes !== "lamp trimmed") {
      throw new Error("expected release to let someone else claim the same sheet");
    }
    const lockedOut = await send(`/api/heroes/${briar.id}`, as(friendToken, "PUT", { ...mine, notes: "nope" }));
    if (lockedOut.status !== 403) throw new Error("expected the previous owner to lose edit access");

    const strayClaim = await send(`/api/heroes/${strayId}/claim`, as(friendToken, "POST"));
    const stray = await strayClaim.json();
    if (strayClaim.status !== 200 || stray.ownerId !== friendAccount.id || stray.notes !== "found on the road") {
      throw new Error("expected an old hero to be claimable");
    }
    const dropped = await send(`/api/heroes/${strayId}`, as(friendToken, "DELETE"));
    if (dropped.status !== 200) throw new Error("expected the owner to delete");
    const gone = await send(`/api/heroes/${strayId}`, as(adminToken, "GET"));
    if (gone.status !== 404) throw new Error("expected the deleted hero to be gone");
  } finally {
    await party.shutdown();
    await Deno.remove(dir, { recursive: true });
  }
});
