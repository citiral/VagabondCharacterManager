// derive() folds a hero into the numbers on the record: HP, saves, speed, warnings.

import { ALCHEMY, SKILLS } from "../data.js";
import {
  ancestryById,
  automaticTrainings,
  chosenTrainings,
  clamp,
  classById,
  formatMoney,
  isTrained,
  scores,
  spellById,
  STAT_IDS,
} from "./model.js";
import {
  countPerk,
  formulaLimit,
  formulaValueCap,
  grantedClassPerks,
  knownSpells,
  manaPool,
  perkSlots,
  raisesExpected,
  raisesSpent,
  spellLimit,
  trainingBudget,
} from "./build.js";
import { itemSlots } from "./gear.js";

function speedFromDex(dex) {
  if (dex <= 3) return 25;
  if (dex <= 5) return 30;
  return 35;
}

export function derive(hero) {
  const warnings = [];
  // Filled in as numbers are checked, then printed above the sheet.
  const sc = scores(hero);
  const level = Math.max(0, hero.level || 0);
  const hpLevel = Math.max(1, level);
  const cls = classById(hero.classId);
  const ancestry = ancestryById(hero.ancestry);

  const tough = countPerk(hero, "tough");
  let maxHp = sc.might * hpLevel + tough * level;
  const fatigue = clamp(hero.fatigue || 0, 0, 5);
  const shutdown = fatigue >= 5;
  if (shutdown) warnings.push("At 5 fatigue, max and current HP are 0.");

  const { max: maxMana, cast: castMax } = manaPool(hero);
  const packMule = countPerk(hero, "pack-mule");
  let merchantSlots = 0;
  if (hero.classId === "merchant" && level >= 1) {
    merchantSlots = 2 * (1 + Math.floor((level - 1) / 3));
  }
  const wornPacks = (hero.items || []).filter((item) => item.equipped && item.capacity);
  const packBonus = wornPacks.length ? Math.max(...wornPacks.map((item) => item.capacity)) : 0;
  if (wornPacks.length > 1) warnings.push("Only one worn pack adds item slots. The largest bonus is used.");

  const slotMax = 8 + sc.might + (hero.ancestry === "orc" ? 2 : 0) + merchantSlots + packMule * 2 + packBonus;
  const slotUsed = (hero.items || []).reduce((sum, item) => sum + itemSlots(item), 0) + fatigue;

  // Armor, speed, and the weapons in hand.
  const wornArmor = (hero.items || []).find((item) => item.kind === "armor" && item.equipped) || null;
  const armorCount = (hero.items || []).filter((item) => item.kind === "armor" && item.equipped).length;
  if (armorCount > 1) warnings.push("Only one set of armor can be worn.");
  let armorPenalty = wornArmor ? (wornArmor.slots || 0) : 0;
  const lightIgnored = countPerk(hero, "skirmisher") > 0 && wornArmor?.catalogId === "light-armor";
  if (lightIgnored) armorPenalty = 0;
  const armorRating = (wornArmor?.rating || 0) + (hero.ancestry === "draken" ? 1 : 0);
  if (wornArmor && sc.might < (wornArmor.might || 0)) {
    warnings.push(`${wornArmor.name} restrains you until Might is at least ${wornArmor.might}.`);
  }

  const baseSpeed = speedFromDex(sc.dexterity);
  let bonus = 0;
  if (hero.ancestry === "halfling" || hero.ancestry === "goblin") bonus += 5;
  bonus += countPerk(hero, "treads-lightly") * 5;
  if (countPerk(hero, "skirmisher") && armorPenalty === 0) bonus += 5;
  if (hero.classId === "barbarian" && level >= 2) bonus += 5 * (1 + Math.floor((level - 2) / 4));
  if (hero.classId === "hunter" && level >= 2) bonus += 5 * (1 + Math.floor((level - 2) / 4));
  const speed = baseSpeed + bonus;

  const weapons = (hero.items || []).filter((item) => item.kind === "weapon" && item.equipped);
  const weaponSlotUsed = weapons.reduce((sum, item) => sum + (item.slots || 0), 0);
  if (weaponSlotUsed > 3) warnings.push("Equipped weapons use more than 3 slots.");

  const expectedRaises = raisesExpected(hero);
  const spentRaises = raisesSpent(hero);
  if (!hero.customStats && spentRaises !== expectedRaises) {
    const gap = expectedRaises - spentRaises;
    warnings.push(gap > 0
      ? `${gap} stat increase${gap === 1 ? "" : "s"} still to assign.`
      : `${-gap} stat increase${gap === -1 ? "" : "s"} over the level budget.`);
  }
  for (const id of STAT_IDS) {
    const raw = (hero.base?.[id] ?? 2) + (hero.raises?.[id] ?? 0);
    if (raw > 7) warnings.push(`${id} is capped at 7, so a raise is doing nothing.`);
  }

  const budget = trainingBudget(hero);
  const chosen = chosenTrainings(hero);
  if (chosen.length > budget) warnings.push("More trainings are picked than Reason, ancestry, and perks allow.");
  if (hero.ancestry === "elf" && !hero.elfSkill) warnings.push("Elves train Detect and one other skill.");

  const limit = spellLimit(hero);
  const classSpells = hero.spells || [];
  if (cls?.requiredSpell && !classSpells.includes(cls.requiredSpell)) {
    warnings.push(`This class always knows ${spellById(cls.requiredSpell)?.name}.`);
  }
  if (cls?.damageSpell) {
    const ok = classSpells.some((id) => spellById(id)?.damage);
    if (classSpells.length && !ok) warnings.push("One known spell must have a damage base.");
  }
  if (classSpells.length > limit && limit >= 0 && cls?.spells) {
    warnings.push(`Spell list is over the class limit of ${limit}.`);
  }
  if (hero.ancestry === "elf" && !hero.elfSpell) warnings.push("Elves know one spell from Naturally Attuned.");

  const formulaeMax = formulaLimit(hero);
  if ((hero.formulae || []).length > formulaeMax) warnings.push(`Formulae are over the limit of ${formulaeMax}.`);
  const cap = formulaValueCap(hero);
  for (const id of hero.formulae || []) {
    const item = ALCHEMY.find((a) => a.id === id);
    if (item && item.value > cap) warnings.push(`${item.name} costs more than the alchemy cap (${formatMoney(cap)}).`);
  }

  if (slotUsed > slotMax) warnings.push("Inventory is over capacity. You can't take the Rush action while full.");

  // Trained skills and the three saves.
  const auto = automaticTrainings(hero);
  const skills = SKILLS.map((skill) => {
    const trained = isTrained(hero, skill.id);
    let source = "";
    if (auto.includes(skill.id) && hero.elfSkill !== skill.id) {
      source = skill.id === "detect" && hero.ancestry === "elf" && !(cls?.trainings || []).includes("detect")
        ? "Elf"
        : "Class";
      if (skill.id === "detect" && hero.ancestry === "elf" && (cls?.trainings || []).includes("detect")) source = "Class";
    } else if (hero.elfSkill === skill.id) source = "Elf";
    else if ((hero.trainings || []).includes(skill.id)) source = "Chosen";
    return {
      ...skill,
      trained,
      source,
      dc: 20 - sc[skill.stat] * (trained ? 2 : 1),
      score: sc[skill.stat],
    };
  });

  const endure = 20 - sc.might * 2;
  const reflex = 20 - (sc.dexterity + sc.awareness) + armorPenalty;
  const will = 20 - (sc.reason + sc.presence);

  let attackCrit = 20;
  if (hero.classId === "fighter" && level >= 2) attackCrit = 20 - (1 + Math.floor((level - 2) / 4));
  let castCrit = 20;
  if (hero.classId === "sorcerer" && level >= 4) castCrit = 20 - (1 + Math.floor((level - 4) / 4));

  const sneak = hero.classId === "rogue" && level >= 1 ? 1 + Math.floor((level - 1) / 3) : 0;

  const tags = [];
  if (["dwarf", "goblin", "orc"].includes(hero.ancestry) || countPerk(hero, "infravision")) tags.push("Darksight");
  if (hero.ancestry === "halfling") tags.push("Ignores Reflex hinder");
  if (countPerk(hero, "climber") || (hero.classId === "hunter" && level >= 2)) tags.push("Climb");
  if (countPerk(hero, "swimmer") || (hero.classId === "hunter" && level >= 2)) tags.push("Swim");
  if (hero.ancestry === "draken") tags.push(`Half ${hero.drakenWard} damage`);
  if (sneak) tags.push(`Sneak attack ${sneak}d4`);

  const features = [];
  if (ancestry) features.push(...ancestry.traits.map((t) => ({ source: ancestry.name, ...t })));
  if (cls && level >= 1) {
    for (const feature of cls.features) {
      if (feature.level <= level) features.push({ source: cls.name, name: feature.name, text: feature.text, level: feature.level });
    }
  }
  const nextFeature = cls?.features.find((feature) => feature.level > level) || null;

  const grants = [];
  if (ancestry?.grantPerks) {
    for (const id of ancestry.grantPerks) grants.push({ id, source: ancestry.name });
  }
  if (cls && level >= 1) {
    for (const id of grantedClassPerks(cls.id)) grants.push({ id, source: cls.name });
  }

  const castSkill = cls?.cast || "";
  const activeSlots = new Set(perkSlots(hero).map((slot) => slot.key));
  const secretSpells = Object.entries(hero.magicalSecrets || {})
    .filter(([slot, id]) => id && activeSlots.has(slot) && hero.perkChoices?.[slot] === "magical-secret")
    .map(([slot, id]) => ({ slot, id, name: spellById(id)?.name || id }));

  return {
    scores: sc,
    level,
    maxHp,
    effectiveMaxHp: shutdown ? 0 : maxHp,
    maxMana,
    castMax,
    castSkill,
    luckMax: sc.luck,
    fatigue,
    shutdown,
    baseSpeed,
    speedBonus: bonus,
    speed,
    crawl: speed * 3,
    travel: speed / 5,
    armorRating,
    armorPenalty,
    wornArmor,
    restrained: !!(wornArmor && sc.might < (wornArmor.might || 0)),
    slotMax,
    slotUsed,
    weaponSlotUsed,
    weapons,
    endure,
    reflex,
    will,
    reflexBase: 20 - (sc.dexterity + sc.awareness),
    skills,
    attackCrit,
    castCrit,
    sneakDice: sneak,
    tags,
    features,
    nextFeature,
    grants,
    slots: perkSlots(hero),
    trainingBudget: budget,
    chosenTrainings: chosen,
    automaticTrainings: auto,
    spellLimit: limit,
    formulaLimit: formulaeMax,
    formulaCap: cap,
    warnings,
    expectedRaises,
    spentRaises,
    secretSpells,
    knownSpells: [...knownSpells(hero)],
    className: cls?.name || (level === 0 ? "No class yet" : "Classless"),
    ancestryName: ancestry?.name || "Unchosen",
    beingType: ancestry?.type || "—",
    size: ancestry?.size || "Medium",
  };
}
