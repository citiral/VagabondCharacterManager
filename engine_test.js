import { PACKS } from "./public/data.js";
import {
  addCatalog,
  ancestryFromD66,
  applyPack,
  blankHero,
  catalogById,
  classFromD66,
  derive,
  formatMoney,
  itemSlots,
  normalize,
  perkAllowed,
  setStatArray,
  spellLimit,
  statScore,
  xpToLevel,
} from "./public/engine.js";

function hero(patch) {
  const next = blankHero();
  Object.assign(next, patch);
  if (patch.base) next.base = { ...next.base, ...patch.base };
  if (patch.raises) next.raises = { ...next.raises, ...patch.raises };
  return normalize(next);
}

Deno.test("money uses 1 gold = 100 silver = 1000 copper", () => {
  if (formatMoney(3000) !== "3g") throw new Error(formatMoney(3000));
  if (formatMoney(870) !== "87s") throw new Error(formatMoney(870));
  if (formatMoney(1460) !== "1g 46s") throw new Error(formatMoney(1460));
  if (formatMoney(1) !== "1c") throw new Error(formatMoney(1));
});

Deno.test("human fighter sheet math", () => {
  const h = hero({
    ancestry: "human",
    classId: "fighter",
    level: 1,
    base: { might: 5, dexterity: 5, awareness: 5, reason: 5, presence: 3, luck: 3 },
    raises: { might: 1, dexterity: 0, awareness: 0, reason: 0, presence: 0, luck: 0 },
  });
  const d = derive(h);
  if (statScore(h, "might") !== 6) throw new Error("might");
  if (d.maxHp !== 6) throw new Error("hp " + d.maxHp);
  if (d.endure !== 8) throw new Error("endure " + d.endure);
  if (d.reflex !== 10) throw new Error("reflex " + d.reflex);
  if (d.will !== 12) throw new Error("will " + d.will);
  if (d.speed !== 30) throw new Error("speed " + d.speed);
  if (d.trainingBudget !== 4) throw new Error("trainings " + d.trainingBudget);
  if (!d.skills.find((s) => s.id === "melee" && s.trained && s.dc === 8)) throw new Error("melee");
  if (!d.skills.find((s) => s.id === "sneak" && !s.trained && s.dc === 15)) throw new Error("sneak");
  if (d.slots.map((slot) => slot.key).join(",") !== "human,fighter-0,creation") {
    throw new Error("perks " + d.slots.map((slot) => slot.label).join(", "));
  }
  if (d.expectedRaises !== 1 || d.spentRaises !== 1) throw new Error("raises");
});

Deno.test("caster scaling matches the class tables", () => {
  const luminary = hero({ classId: "luminary", level: 5, ancestry: "dwarf" });
  const d = derive(luminary);
  if (d.maxMana !== 20 || d.castMax !== 7) throw new Error(`luminary mana ${d.maxMana} ${d.castMax}`);
  if (spellLimit(luminary) !== 6) throw new Error("luminary spells");
  if (!luminary.spells.includes("life")) throw new Error("life");
  if (d.maxHp !== statScore(luminary, "might") * 5 + 5) throw new Error("dwarf tough hp");

  const druid = hero({ classId: "druid", level: 1 });
  if (spellLimit(druid) !== 2 || derive(druid).maxMana !== 2 || derive(druid).castMax !== 2) {
    throw new Error("druid");
  }
  const wizard = hero({ classId: "wizard", level: 10 });
  const w = derive(wizard);
  if (w.maxMana !== 40 || w.castMax !== 12 || spellLimit(wizard) !== 8) throw new Error("wizard");
});

Deno.test("speed, armor, slots, and fatigue", () => {
  const h = hero({
    ancestry: "halfling",
    classId: "hunter",
    level: 6,
    base: { might: 4, dexterity: 6, awareness: 5, reason: 3, presence: 3, luck: 3 },
  });
  addCatalog(h, "light-armor");
  h.items[0].equipped = true;
  addCatalog(h, "backpack");
  h.items.find((i) => i.catalogId === "backpack").equipped = true;
  let d = derive(h);
  if (d.speed !== 35 + 5 + 10) throw new Error("speed " + d.speed);
  if (d.armorPenalty !== 1 || d.armorRating !== 1) throw new Error("armor");
  if (d.slotMax !== 8 + 4 + 3) throw new Error("slots " + d.slotMax);
  h.perkChoices["level-3"] = "skirmisher";
  h.trainings = ["finesse"];
  d = derive(normalize(h));
  if (d.armorPenalty !== 0) throw new Error("skirmisher penalty");
  if (d.speed !== 35 + 5 + 10 + 5) throw new Error("skirmisher speed " + d.speed);

  const orc = hero({ ancestry: "orc", base: { might: 7, dexterity: 3, awareness: 3, reason: 3, presence: 3, luck: 2 } });
  if (derive(orc).slotMax !== 17) throw new Error("orc slots");
  orc.fatigue = 5;
  if (derive(normalize(orc)).effectiveMaxHp !== 0) throw new Error("fatigue");
});

Deno.test("fighter crit range, rogue dice, merchant pockets", () => {
  const fighter = hero({ classId: "fighter", level: 6 });
  if (derive(fighter).attackCrit !== 18) throw new Error("crit");
  const rogue = hero({ classId: "rogue", level: 7 });
  if (derive(rogue).sneakDice !== 3) throw new Error("sneak");
  const merchant = hero({ classId: "merchant", level: 4 });
  if (derive(merchant).slotMax !== 8 + statScore(merchant, "might") + 4) throw new Error("pockets");
});

Deno.test("xp costs and d66 tables", () => {
  if (xpToLevel(1, "normal") !== 10) throw new Error("normal");
  if (xpToLevel(3, "quick") !== 5) throw new Error("quick");
  if (xpToLevel(1, "epic") !== 14) throw new Error("epic");
  if (ancestryFromD66(11)?.id !== "human" || ancestryFromD66(66)?.id !== "orc") throw new Error("ancestry");
  if (classFromD66(25)?.id !== "fighter" || classFromD66(65)?.id !== "wizard") throw new Error("class");
});

Deno.test("every starting pack item exists and a pack fills the sack", () => {
  for (const pack of PACKS) {
    for (const [id] of pack.items) {
      if (!catalogById(id)) throw new Error(`${pack.id} missing ${id}`);
    }
  }
  const h = hero({});
  applyPack(h, "knight");
  const d = derive(h);
  if (h.wealth !== 200) throw new Error("wealth");
  if (!d.wornArmor || d.armorRating !== 3) throw new Error("plate");
  if (d.weaponSlotUsed > 3) throw new Error("hands");
  const rations = h.items.find((i) => i.catalogId === "rations");
  if (itemSlots(rations) !== 1) throw new Error("rations");
});

Deno.test("perk gates", () => {
  const h = hero({
    classId: "fighter",
    level: 1,
    ancestry: "human",
    base: { might: 3, dexterity: 3, awareness: 3, reason: 5, presence: 3, luck: 3 },
  });
  const heavy = { id: "heavy-arms", trainedAll: ["melee"], stats: { might: 7 } };
  if (!perkAllowed(h, heavy, "fighter", "fighter-0")) throw new Error("fighter ignores might");
  const rush = { id: "beat-rush", trainedAll: ["brawl"], stats: { might: 4 } };
  if (!perkAllowed(h, rush, "fighter", "fighter-0")) throw new Error("fighter can take brawl");
  const finesse = { id: "deft-hands", trainedAll: ["finesse"], stats: { dexterity: 4 } };
  if (!perkAllowed(h, finesse, "fighter", "fighter-0")) throw new Error("fighter can take finesse");
  const dwarf = hero({ classId: "fighter", level: 1, ancestry: "dwarf" });
  if (derive(dwarf).slots.length !== 2) throw new Error("starting perk " + derive(dwarf).slots.length);
  if (perkAllowed(h, heavy, "normal", "level-3")) throw new Error("normal respects might");
  const book = { id: "bookworm", stats: { reason: 4 }, repeat: true };
  if (!perkAllowed(h, book, "bard", "bard")) throw new Error("bard");
});

Deno.test("stat array swaps stay inside the pool", () => {
  const h = hero({});
  setStatArray(h, 7);
  if (statScore(h, "might") !== 7 || statScore(h, "luck") !== 2) throw new Error("array");
});
