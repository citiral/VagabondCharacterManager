// The party every connected browser shares.
// Edits are broadcast immediately and written to the database a few seconds later,
// on a single queue so two saves can't pass each other.

import { snapshot, type HeroRecord, type HeroStore } from "./store.ts";

const FLUSH_MS = 8000;

export function createParty(store: HeroStore) {
  let party: HeroRecord[] | null = null;
  let loadingParty: Promise<HeroRecord[]> | null = null;
  const persisted = new Map<string, string>();
  const dirty = new Set<string>();
  const sockets = new Set<WebSocket>();
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let tail: Promise<void> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task);
    tail = run.then(() => {}, () => {});
    return run;
  }

  async function ensureParty() {
    if (party) return party;
    if (!loadingParty) {
      loadingParty = store.list().then((heroes) => {
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
    // A save that changes nothing but the timestamp is ignored, so two browsers
    // don't bounce the same sheet back and forth.
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

  function enqueueFlush() {
    enqueue(flushDirty);
  }

  function shutdown() {
    return enqueue(async () => {
      try {
        await flushDirty();
      } finally {
        await store.close();
      }
    });
  }

  return { ensureParty, publish, persistNow, forget, enqueueFlush, shutdown, sockets };
}

export type Party = ReturnType<typeof createParty>;
