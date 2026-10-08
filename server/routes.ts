// HTTP API for the party, plus login, approval, the live socket, and static files.
// Writes go through the party cache; this file only checks the request.

import { blankHero } from "../public/engine.js";
import { approvedUser, authCookie, clearAuthCookie, dummyPasswordHash, hashPassword, normalizeEmail, normalizeUsername, verifyPassword } from "./auth.ts";
import { json } from "./http.ts";
import { liveSocket } from "./live.ts";
import { adminPage, loginPage, notFoundPage, registerPage, usernamePage } from "./pages.ts";
import type { Party } from "./party.ts";
import { serveStatic } from "./static.ts";
import { asHero, type AccountStore, HERO_ID, MAX_HERO_BYTES, snapshot } from "./store.ts";

export type AuthOptions = { secret: string; adminEmail: string };

const PUBLIC_FILES = new Set(["/styles.css", "/favicon.svg"]);

export async function handleRequest(
  request: Request,
  party: Party,
  accounts: AccountStore,
  auth: AuthOptions,
  publicDir: string,
) {
  const path = new URL(request.url).pathname;

  if (path === "/login" || path === "/register" || path === "/logout" || path === "/username" || path === "/admin" || path.startsWith("/admin/")) {
    try {
      return await handleAccount(request, path, accounts, auth);
    } catch (error) {
      console.error(error);
      return html(loginPage("Something went wrong. Try again."), 500);
    }
  }

  let user;
  try {
    user = await approvedUser(request, accounts, auth.secret);
  } catch (error) {
    console.error(error);
    return json({ error: "Database error" }, 500);
  }
  if (!user) {
    if (path.startsWith("/api/")) return json({ error: "Sign in required." }, 401);
    if (PUBLIC_FILES.has(path)) return serveStatic(publicDir, path);
    return redirect("/login");
  }
  if (!user.username) {
    if (path.startsWith("/api/")) return json({ error: "Choose a username first." }, 403);
    if (PUBLIC_FILES.has(path)) return serveStatic(publicDir, path);
    return redirect("/username");
  }

  const { ensureParty, publish, persistNow, forget } = party;

  if (path === "/api/live") {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return json({ error: "Expected websocket" }, 426);
    return liveSocket(request, party);
  }

  try {
    if (path === "/api/heroes" && request.method === "GET") return json(await ensureParty());

    if (path === "/api/me" && request.method === "GET") return json({ username: user.username, role: user.role });

    if (path === "/api/heroes" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      const hero = asHero(body) ?? blankHero();
      if (!HERO_ID.test(String(hero.id || ""))) hero.id = crypto.randomUUID();
      hero.createdAt = hero.createdAt || Date.now();
      if (snapshot(hero).length > MAX_HERO_BYTES) return json({ error: "That hero is too large to save." }, 413);
      return json(await persistNow(hero), 201);
    }

    const match = path.match(/^\/api\/heroes\/([^/]+)$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      if (!HERO_ID.test(id)) return json({ error: "Bad id" }, 400);
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
  return serveStatic(publicDir, path);
}

async function handleAccount(request: Request, path: string, accounts: AccountStore, auth: AuthOptions) {
  if (path === "/logout") {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    return redirect("/login", clearAuthCookie(request));
  }

  const user = await approvedUser(request, accounts, auth.secret);

  if (path === "/username") return chooseUsername(request, accounts, user);

  if (path === "/admin" || path.startsWith("/admin/")) {
    if (!user || user.role !== "admin") return html(notFoundPage(), 404);
    return review(request, path, accounts);
  }

  if ((path === "/login" || path === "/register") && request.method === "GET" && user) return redirect("/");

  if (path === "/login") {
    if (request.method === "GET") return html(loginPage());
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    return signIn(request, accounts, auth);
  }

  if (path === "/register") {
    if (request.method === "GET") return html(registerPage());
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    return signUp(request, accounts, auth);
  }

  return html(notFoundPage(), 404);
}

async function chooseUsername(request: Request, accounts: AccountStore, user: Awaited<ReturnType<typeof approvedUser>>) {
  if (!user) return redirect("/login");
  if (user.username) return redirect("/");
  if (request.method === "GET") return html(usernamePage());
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const username = normalizeUsername((await request.formData()).get("username"));
  if (!username) return html(usernamePage("Use 2–24 letters or numbers."), 400);
  const result = await accounts.setUsername(user.id, username);
  if (result === "username") return html(usernamePage("That username is taken."), 409);
  if (result !== "ok") return html(usernamePage("Something went wrong. Try again."), 500);
  return redirect("/");
}

async function signIn(request: Request, accounts: AccountStore, auth: AuthOptions) {
  const form = await request.formData();
  const email = normalizeEmail(form.get("email"));
  const raw = form.get("password");
  const password = typeof raw === "string" && raw.length <= 1024 ? raw : "";
  const account = email ? await accounts.findByEmail(email) : null;
  const matches = await verifyPassword(password, account?.passwordHash || dummyPasswordHash);
  if (!account || !matches) return html(loginPage("Email or password is wrong."), 401);
  if (account.status === "pending") return html(loginPage("This account is waiting for approval.", "note"));
  if (account.status === "rejected") return html(loginPage("This account was declined."));
  const cookie = await authCookie(auth.secret, account.id, request);
  return redirect("/", cookie);
}

async function signUp(request: Request, accounts: AccountStore, auth: AuthOptions) {
  const form = await request.formData();
  const email = normalizeEmail(form.get("email"));
  const username = normalizeUsername(form.get("username"));
  const raw = form.get("password");
  const password = typeof raw === "string" ? raw : "";
  if (!username) return html(registerPage("Use 2–24 letters or numbers.", { error: true }), 400);
  if (!email) return html(registerPage("Enter a valid email address.", { error: true }), 400);
  if (password.length < 8 || password.length > 1024) return html(registerPage("Use at least 8 characters.", { error: true }), 400);
  const admin = auth.adminEmail !== "" && email === auth.adminEmail;
  const id = crypto.randomUUID();
  const result = await accounts.create({
    id,
    email,
    username,
    passwordHash: await hashPassword(password),
    status: admin ? "approved" : "pending",
    role: admin ? "admin" : "user",
    createdAt: Date.now(),
  });
  if (result === "email") return html(registerPage("An account with that email already exists.", { error: true }), 409);
  if (result === "username") return html(registerPage("That username is taken.", { error: true }), 409);
  if (!admin) {
    return html(registerPage("Your account is waiting for approval. You can sign in after it is approved.", { done: true }));
  }
  return redirect("/", await authCookie(auth.secret, id, request));
}

async function review(request: Request, path: string, accounts: AccountStore) {
  const match = path.match(/^\/admin\/users\/([^/]+)\/(approve|reject)$/);
  if (match) {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const id = decodeURIComponent(match[1]);
    if (!HERO_ID.test(id)) return html(notFoundPage(), 404);
    await accounts.setStatus(id, match[2] === "approve" ? "approved" : "rejected");
    return redirect("/admin");
  }
  if (path !== "/admin" || request.method !== "GET") return html(notFoundPage(), 404);
  return html(adminPage(await accounts.listReview()));
}

function redirect(location: string, cookie?: string) {
  const headers = new Headers({ location, "cache-control": "no-store" });
  if (cookie) headers.set("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}

function html(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
