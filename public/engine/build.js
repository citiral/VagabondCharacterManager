// What a level buys: perk slots, spell limits, and whether a perk's prerequisites are met.

import {
  ancestryById,
  classById,
  isTrained,
  perkById,
  spellById,
  STAT_IDS,
  statScore,
} from "./model.js";

export function trainingBudget(hero) {
  const reason = statScore(hero, "reason");
  const fromReason = Math.ceil(reason / 2);
  const fromHuman = hero.ancestry === "human" ? 1 : 0;
  const fromPerks = countPerk(hero, "new-training");
  return fromReason + fromHuman + fromPerks;
}

function perkChoices(hero) {
  const keys = new Set(perkSlots(hero).map((slot) => slot.key));
  return Object.entries(hero.perkChoices || {})
    .filter(([key, id]) => id && keys.has(key))
    .map(([, id]) => id);
}

export function countPerk(hero, id) {
  let n = perkChoices(hero).filter((p) => p === id).length;
  const ancestry = ancestryById(hero.ancestry);
  if (ancestry?.grantPerks?.includes(id)) n += 1;
  const cls = classById(hero.classId);
  if (cls && hero.level >= 1 && grantedClassPerks(cls.id).includes(id)) n += 1;
  return n;
}

export function grantedClassPerks(classId) {
  const map = {
    alchemist: ["deft-hands"],
    barbarian: ["interceptor"],
    dancer: ["fallaway-reverse"],
    druid: ["shapechanger"],
    luminary: ["assured-healer"],
    magus: ["gish"],
    merchant: ["deft-hands"],
    pugilist: ["dusted-knuckle"],
    revelator: ["gish"],
    rogue: ["resourceful"],
    sorcerer: ["vehement-magic"],
    vanguard: ["protector"],
    wizard: ["bookworm"],
  };
  return map[classId] || [];
}

export function perkSlots(hero) {
  const slots = [];
  const level = hero.level || 0;
  if (hero.ancestry === "human") {
    slots.push({ key: "human", label: "Human Knack", mode: "normal" });
  }
  if (hero.classId === "bard" && level >= 1) {
    slots.push({ key: "bard", label: "Well-Versed", mode: "bard" });
  }
  if (hero.classId === "fighter" && level >= 1) {
    const n = 2 + Math.floor(level / 4);
    for (let i = 0; i < n; i++) {
      slots.push({ key: `fighter-${i}`, label: `Fighting Style ${i + 1}`, mode: "fighter" });
    }
  }
  if (hero.classId === "hunter" && level >= 1) {
    slots.push({ key: "hunter", label: "Survivalist", mode: "hunter" });
  }
  if (hero.classId === "witch" && level >= 1) {
    slots.push({ key: "witch", label: "Occultist", mode: "witch" });
  }
  for (let l = 3; l <= level; l += 2) {
    slots.push({ key: `level-${l}`, label: `Level ${l}`, mode: "normal" });
  }
  return slots;
}

export function raisesExpected(hero) {
  let n = 0;
  if (hero.ancestry === "human") n += 1;
  if (hero.level >= 2) n += Math.floor(hero.level / 2);
  n += countChoice(hero, "advancement");
  return n;
}

function countChoice(hero, id) {
  return perkChoices(hero).filter((p) => p === id).length;
}

export function raisesSpent(hero) {
  return STAT_IDS.reduce((sum, id) => sum + (hero.raises?.[id] || 0), 0);
}

export function spellLimit(hero) {
  const level = hero.level || 0;
  if (level < 1) return 0;
  const cls = classById(hero.classId);
  if (!cls) return 0;
  if (cls.spells === "many") return 4 + Math.floor((level - 1) / 2);
  if (cls.spells === "few") return 2 + Math.floor((level - 1) / 3);
  return 0;
}

export function formulaLimit(hero) {
  if (hero.classId !== "alchemist" || hero.level < 1) return 0;
  return 4 + Math.floor((hero.level - 1) / 3);
}

export function formulaValueCap(hero) {
  if (hero.classId !== "alchemist" || hero.level < 1) return 0;
  return hero.level * 500;
}

export function manaPool(hero) {
  const level = hero.level || 0;
  const cls = classById(hero.classId);
  let max = 0;
  let cast = 0;
  if (cls && level >= 1 && cls.mana === "half") {
    max = 2 * level;
    cast = 1 + Math.ceil(level / 2);
  } else if (cls && level >= 1 && cls.mana === "full") {
    max = 4 * level;
    cast = 2 + level;
  }
  const secrets = countPerk(hero, "secret-of-mana");
  max += secrets * 2;
  cast += secrets;
  return { max, cast };
}

export function knownSpells(hero) {
  const ids = new Set(hero.spells || []);
  if (hero.elfSpell) ids.add(hero.elfSpell);
  const keys = new Set(perkSlots(hero).map((slot) => slot.key));
  for (const [slot, id] of Object.entries(hero.magicalSecrets || {})) {
    if (id && keys.has(slot) && hero.perkChoices?.[slot] === "magical-secret") ids.add(id);
  }
  return ids;
}

function perkListsTraining(perk, skill) {
  return (perk.trainedAll || []).includes(skill) || (perk.trainedAny || []).includes(skill);
}

export function perkAllowed(hero, perk, mode, slotKey) {
  if (!perk) return false;
  const taken = countPerk(hero, perk.id);
  const alreadyHere = hero.perkChoices?.[slotKey] === perk.id;
  const effective = taken - (alreadyHere ? 1 : 0);
  if (effective > 0 && !perk.repeat) return false;
  if (perk.repeatMax && effective >= perk.repeatMax) return false;

  // Feature slots keep only their training gate. Bard waives stat minimums.
  // A perk granted by class or ancestry never comes through here.
  if (mode === "fighter") return perkListsTraining(perk, "melee") || perkListsTraining(perk, "ranged");
  if (mode === "hunter") return perkListsTraining(perk, "survival");
  if (mode === "witch") return perkListsTraining(perk, "mysticism");

  const ignoreStats = mode === "bard";
  if (!ignoreStats && perk.stats) {
    for (const [stat, min] of Object.entries(perk.stats)) {
      if (statScore(hero, stat) < min) return false;
    }
  }
  if (perk.statsAnyUnder != null) {
    const any = STAT_IDS.some((id) => statScore(hero, id) < perk.statsAnyUnder);
    if (!any) return false;
  }
  const trained = (id) => isTrained(hero, id);
  if (perk.trainedAll && !perk.trainedAll.every(trained)) return false;
  if (perk.trainedAny && !perk.trainedAny.some(trained)) return false;
  if (perk.spell === "any") {
    const willLearnSpells = !!classById(hero.classId)?.spells && hero.level >= 1;
    if (knownSpells(hero).size === 0 && !willLearnSpells) return false;
  } else if (perk.spell && !knownSpells(hero).has(perk.spell)) {
    const required = classById(hero.classId)?.requiredSpell;
    if (perk.spell !== required) return false;
  }
  if (perk.spellAny && !perk.spellAny.some((id) => knownSpells(hero).has(id))) return false;
  if (perk.spellTag === "object") {
    const has = [...knownSpells(hero)].some((id) => spellById(id)?.object);
    if (!has) return false;
  }
  return true;
}
