// The party every connected browser shares.
// Edits are broadcast immediately and written to the database a few seconds later,
// on a single queue so two saves can't pass each other.

import { snapshot, type HeroRecord, type HeroRow, type HeroStore } from "./store.ts";

const FLUSH_MS = 8000;

type Player = { id: string; username: string };
type Denied = { error: string; status: number; hero?: HeroRecord };
type Edited = { hero: HeroRecord } | Denied;

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
    const rows: HeroRow[] = [];
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
        ownerId: hero.ownerId ?? null,
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
    const stamped = {
      ...hero,
      updatedAt: Date.now(),
      // A save never moves a hero between accounts. Claim and release do that.
      ownerId: previous ? previous.ownerId ?? null : hero.ownerId ?? null,
      ownerName: previous ? previous.ownerName ?? "" : hero.ownerName ?? "",
    };
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

  function edit(hero: HeroRecord, user: Player, except?: WebSocket): Edited {
    if (!party) party = [];
    const previous = party.find((entry) => entry.id === hero.id);
    if (previous && previous.ownerId !== user.id) {
      return {
        error: previous.ownerId ? "This hero belongs to someone else." : "Claim this hero before editing it.",
        status: 403,
        hero: previous,
      };
    }
    const stamped = publish({
      ...hero,
      ownerId: previous ? previous.ownerId ?? null : user.id,
      ownerName: previous ? previous.ownerName || user.username : user.username,
    }, except);
    return { hero: stamped ?? hero };
  }

  async function persistNow(hero: HeroRecord, user: Player): Promise<Edited> {
    return await enqueue(async () => {
      await ensureParty();
      const edited = edit(hero, user);
      if ("error" in edited) return edited;
      const stamped = edited.hero;
      const json = snapshot(stamped);
      if (persisted.get(stamped.id) === json) return { hero: stamped };
      try {
        await store.upsert([{
          id: stamped.id,
          name: String(stamped.name || ""),
          json,
          updatedAt: Number(stamped.updatedAt) || Date.now(),
          ownerId: stamped.ownerId ?? null,
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
      return { hero: stamped };
    });
  }

  async function claim(id: string, user: Player): Promise<Edited> {
    return await enqueue(async () => {
      await ensureParty();
      const hero = party?.find((entry) => entry.id === id);
      if (!hero) return { error: "Not found", status: 404 };
      if (hero.ownerId === user.id) return { hero };
      if (hero.ownerId) return { error: "Someone else already claimed this hero.", status: 409, hero };
      hero.ownerId = user.id;
      hero.ownerName = user.username;
      let claimed = false;
      try {
        claimed = await store.claim(id, user.id);
      } catch (error) {
        const current = party?.find((entry) => entry.id === id);
        if (current?.ownerId === user.id) {
          current.ownerId = null;
          current.ownerName = "";
        }
        throw error;
      }
      const current = party?.find((entry) => entry.id === id) ?? hero;
      if (!claimed) {
        if (current.ownerId === user.id) {
          current.ownerId = null;
          current.ownerName = "";
        }
        return { error: "Someone else already claimed this hero.", status: 409, hero: current };
      }
      current.ownerId = user.id;
      current.ownerName = user.username;
      broadcast({ type: "upsert", hero: current });
      return { hero: current };
    });
  }

  async function release(id: string, userId: string): Promise<Edited> {
    return await enqueue(async () => {
      await ensureParty();
      const hero = party?.find((entry) => entry.id === id);
      if (!hero) return { error: "Not found", status: 404 };
      if (hero.ownerId !== userId) {
        return {
          error: hero.ownerId ? "Only the owner can release this hero." : "This hero is already unclaimed.",
          status: 403,
          hero,
        };
      }
      const ok = await store.release(id, userId);
      const current = party?.find((entry) => entry.id === id) ?? hero;
      if (!ok) return { error: "Only the owner can release this hero.", status: 403, hero: current };
      current.ownerId = null;
      current.ownerName = "";
      broadcast({ type: "upsert", hero: current });
      return { hero: current };
    });
  }

  async function forget(id: string, userId: string, except?: WebSocket): Promise<{ ok: true } | Denied> {
    return await enqueue(async () => {
      await ensureParty();
      const hero = party?.find((entry) => entry.id === id);
      if (hero && hero.ownerId !== userId) {
        return {
          error: hero.ownerId ? "Only the owner can delete this hero." : "Claim this hero before deleting it.",
          status: 403,
          hero,
        };
      }
      party = (party ?? []).filter((entry) => entry.id !== id);
      dirty.delete(id);
      persisted.delete(id);
      await store.remove(id);
      if ((party ?? []).some((entry) => entry.id === id)) {
        dirty.add(id);
        scheduleFlush();
        return { ok: true as const };
      }
      broadcast({ type: "delete", id }, except);
      return { ok: true as const };
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

  return { ensureParty, edit, persistNow, claim, release, forget, enqueueFlush, shutdown, sockets };
}

export type Party = ReturnType<typeof createParty>;
