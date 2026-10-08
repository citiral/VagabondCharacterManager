// Live party connection. Edits go out on the websocket; HTTP is the fallback
// when the socket is down.

import { normalize } from "./engine.js";
import { app, current, hydrate, state } from "./state.js";
import { render } from "./ui/render.js";

const outbound = new Map();
let socket = null;
let live = false;
let retryMs = 1000;
let booted = false;
let resolveBoot = () => {};
const bootPromise = new Promise((resolve) => {
  resolveBoot = resolve;
});

function paintSave() {
  const node = document.querySelector(".save-state");
  if (node) node.textContent = state.saving;
}

function adoptParty(heroes, replace) {
  const next = heroes.map(hydrate);
  if (!replace) {
    // A full snapshot must not wipe an edit that hasn't been sent yet.
    for (const id of outbound.keys()) {
      const local = state.heroes.find((hero) => hero.id === id);
      if (!local) continue;
      const index = next.findIndex((hero) => hero.id === id);
      if (index >= 0) next[index] = local;
      else next.push(local);
    }
  }
  state.heroes = next;
  if (!current() && state.heroes[0]) state.id = state.heroes[0].id;
  render();
}

function applyRemoteUpsert(raw) {
  const incoming = hydrate(raw);
  const index = state.heroes.findIndex((hero) => hero.id === incoming.id);
  const local = index >= 0 ? state.heroes[index] : null;
  const active = document.activeElement;
  const field = active?.dataset?.field;
  if (local && field && state.id === incoming.id) incoming[field] = local[field];
  if (index >= 0) state.heroes[index] = incoming;
  else state.heroes.push(incoming);
  if (outbound.has(incoming.id)) outbound.set(incoming.id, incoming);
  render();
}

function applyRemoteDelete(id) {
  if (outbound.has(id)) return;
  const existed = state.heroes.some((hero) => hero.id === id);
  if (!existed) return;
  state.heroes = state.heroes.filter((hero) => hero.id !== id);
  if (state.id === id) state.id = state.heroes[0]?.id || "";
  render();
}

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const next = new WebSocket(`${proto}//${location.host}/api/live`);
  socket = next;
  next.onopen = () => {
    live = true;
    retryMs = 1000;
    state.saving = "Live";
    state.error = "";
    paintSave();
    flushOutbound();
  };
  next.onmessage = (event) => {
    let message = null;
    try { message = JSON.parse(event.data); } catch { return; }
    if (!message) return;
    if (message.type === "party") {
      if (!booted) {
        booted = true;
        state.saving = "Live";
        adoptParty(message.heroes || [], true);
        resolveBoot();
      } else {
        adoptParty(message.heroes || [], false);
      }
      return;
    }
    if (message.type === "upsert") applyRemoteUpsert(message.hero);
    if (message.type === "delete") applyRemoteDelete(message.id);
    if (message.type === "error") {
      state.error = message.error || "The live update was rejected.";
      state.saving = "Not saved";
      render();
    }
  };
  next.onclose = () => {
    if (socket !== next) return;
    live = false;
    state.saving = "Reconnecting…";
    paintSave();
    const wait = retryMs;
    retryMs = Math.min(retryMs * 2, 30000);
    setTimeout(connect, wait);
  };
  next.onerror = () => {
    if (socket === next) next.close();
  };
}

function flushOutbound() {
  if (!outbound.size) {
    state.saving = live ? "Live" : state.saving;
    paintSave();
    return;
  }
  if (live && socket?.readyState === WebSocket.OPEN) {
    for (const hero of outbound.values()) {
      normalize(hero);
      socket.send(JSON.stringify({ type: "upsert", hero }));
    }
    outbound.clear();
    state.saving = "Live";
    state.error = "";
    paintSave();
    return;
  }
  const pending = [...outbound.values()];
  outbound.clear();
  for (const hero of pending) persist(hero);
}

export function scheduleSave(hero, immediate = false) {
  // Keystrokes wait a beat. Purchases and level-ups pass immediate and send now.
  outbound.set(hero.id, hero);
  state.saving = live ? "Live" : "Saving…";
  clearTimeout(state.timer);
  if (immediate && live && socket?.readyState === WebSocket.OPEN) {
    flushOutbound();
    return;
  }
  state.timer = setTimeout(flushOutbound, live ? 350 : 2000);
}

export async function load() {
  app.innerHTML = `<p class="banner">Connecting…</p>`;
  connect();
  const liveBoot = await Promise.race([
    bootPromise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 2500)),
  ]);
  if (liveBoot) return;
  const response = await fetch("/api/heroes");
  if (!response.ok) throw new Error("Could not load the party");
  if (booted) return;
  booted = true;
  state.heroes = (await response.json()).map(hydrate);
  if (!current() && state.heroes[0]) state.id = state.heroes[0].id;
  state.saving = "Saved";
  render();
}

async function persist(hero) {
  normalize(hero);
  const response = await fetch(`/api/heroes/${hero.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(hero),
  });
  state.saving = response.ok ? (live ? "Live" : "Saved") : "Not saved";
  state.error = response.ok ? "" : "The sheet didn't save. Keep this tab open and try again.";
  paintSave();
}

export function commit(hero) {
  if (!hero) return;
  normalize(hero);
  scheduleSave(hero, true);
  render();
}

function pushPending(useSocket) {
  const pending = [...outbound.values()];
  for (const hero of pending) normalize(hero);
  if (useSocket && socket?.readyState === WebSocket.OPEN) {
    for (const hero of pending) socket.send(JSON.stringify({ type: "upsert", hero }));
    outbound.clear();
    socket.send(JSON.stringify({ type: "flush" }));
    return;
  }
  for (const hero of pending) {
    fetch(`/api/heroes/${hero.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-immediate": "1" },
      body: JSON.stringify(hero),
      keepalive: true,
    });
  }
}

export function removeRemote(id) {
  outbound.delete(id);
  if (live && socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "delete", id }));
    return Promise.resolve();
  }
  return fetch(`/api/heroes/${id}`, { method: "DELETE" });
}

export function installLifecycle() {
  setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
  }, 25000);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") pushPending(true);
  });

  window.addEventListener("beforeunload", () => {
    pushPending(socket?.readyState === WebSocket.OPEN);
  });
}
