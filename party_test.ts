import { createParty } from "./server/party.ts";
import { openSqlite } from "./server/store.ts";

const alice = { id: "user-alice", username: "alice" };
const heroId = "11111111-2222-4333-8444-555555555555";

Deno.test("two server instances sharing one database stay in step", async () => {
  const dir = await Deno.makeTempDir();
  const oldStores = await openSqlite(dir);
  const newStores = await openSqlite(dir);
  const oldRevision = createParty(oldStores.heroes);
  const newRevision = createParty(newStores.heroes);
  try {
    await oldRevision.persistNow({ id: heroId, name: "Before" }, alice);
    await newRevision.ensureParty();

    await oldRevision.persistNow({ id: heroId, name: "After" }, alice);
    const saved = (await newStores.heroes.list()).find((hero) => hero.id === heroId);
    if (saved?.name !== "After") throw new Error("the edit wasn't written right away: " + saved?.name);

    const seen = (await newRevision.reloadParty()).find((hero) => hero.id === heroId);
    if (seen?.name !== "After") throw new Error("the new instance served a stale hero: " + seen?.name);
    if (seen?.ownerId !== alice.id) throw new Error("ownership was lost on reload");
  } finally {
    await oldRevision.shutdown();
    await newRevision.shutdown();
  }
});
