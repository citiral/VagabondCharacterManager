// One socket per browser. The first message is the whole party;
// later messages are a single hero upsert or delete.

import type { Party } from "./party.ts";
import { asHero, HERO_ID, MAX_HERO_BYTES, snapshot } from "./store.ts";

export function liveSocket(request: Request, party: Party) {
  const { socket, response } = Deno.upgradeWebSocket(request);
  const { sockets, ensureParty, publish, forget, enqueueFlush } = party;
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
      enqueueFlush();
      return;
    }
    if (message.type === "delete") {
      const id = String(message.id || "");
      if (!HERO_ID.test(id)) return;
      forget(id, socket).catch((error) => console.error(error));
      return;
    }
    if (message.type !== "upsert") return;
    const hero = asHero(message.hero);
    if (!hero || !HERO_ID.test(String(hero.id || ""))) return;
    if (snapshot(hero).length > MAX_HERO_BYTES) {
      socket.send(JSON.stringify({ type: "error", error: "That hero is too large to save." }));
      return;
    }
    publish(hero, socket);
  };
  socket.onclose = () => {
    sockets.delete(socket);
    if (sockets.size === 0) enqueueFlush();
  };
  socket.onerror = () => sockets.delete(socket);
  return response;
}
