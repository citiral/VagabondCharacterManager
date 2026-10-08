// HTTP API for the party, plus the live socket and the static files.
// Writes go through the party cache; this file only checks the request.

import { blankHero } from "../public/engine.js";
import { json } from "./http.ts";
import { liveSocket } from "./live.ts";
import type { Party } from "./party.ts";
import { serveStatic } from "./static.ts";
import { asHero, HERO_ID, MAX_HERO_BYTES, snapshot } from "./store.ts";

export async function handleRequest(request: Request, party: Party, publicDir: string) {
  const url = new URL(request.url);
  const path = url.pathname;
  const { ensureParty, publish, persistNow, forget } = party;

  if (path === "/api/live") {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return json({ error: "Expected websocket" }, 426);
    return liveSocket(request, party);
  }

  try {
    if (path === "/api/heroes" && request.method === "GET") return json(await ensureParty());

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
