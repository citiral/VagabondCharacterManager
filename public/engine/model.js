// The hero document: a blank sheet, stat scores, money, and cleanup before a save.
// Trainings here are the ones that don't depend on perks. Perk slots are in build.js.

import {
  ANCESTRIES,
  CATALOG,
  CLASSES,
  PACKS,
  PERKS,
  SKILLS,
  SPELLS,
  STATS,
  STAT_ARRAYS,
} from "../data.js";

export const STAT_IDS = STATS.map((s) => s.id);

export function blankHero() {
  const base = {};
  STAT_IDS.forEach((id, i) => base[id] = STAT_ARRAYS[0][i]);
  const raises = {};
  STAT_IDS.forEach((id) => raises[id] = 0);
  return {
    id: crypto.randomUUID(),
    name: "",
    player: "",
    concept: "",
    notes: "",
    level: 1,
    xp: 0,
    pace: "normal",
    ancestry: "",
    classId: "",
    drakenWard: "fire",
    elfSkill: "",
    elfCastSkill: "arcana",
    elfSpell: "",
    statArray: 0,
    customStats: false,
    base,
    raises,
    trainings: [],
    perkChoices: {},
    magicalSecrets: {},
    spells: [],
    formulae: [],
    items: [],
    wealth: 3000,
    hp: null,
    mana: null,
    luck: null,
    fatigue: 0,
    studied: 0,
    breatherUsed: false,
    conditions: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function classById(id) {
  return CLASSES.find((c) => c.id === id) || null;
}
export function ancestryById(id) {
  return ANCESTRIES.find((a) => a.id === id) || null;
}
export function perkById(id) {
  return PERKS.find((p) => p.id === id) || null;
}
export function spellById(id) {
  return SPELLS.find((s) => s.id === id) || null;
}
export function catalogById(id) {
  return CATALOG.find((c) => c.id === id) || null;
}

export function parseMoney(text) {
  const source = String(text ?? "").trim();
  if (!source) return 0;
  const pattern = /(\d+)\s*([gsc])/gi;
  let copper = 0;
  let matched = false;
  for (const hit of source.matchAll(pattern)) {
    matched = true;
    const amount = Number(hit[1]);
    const unit = hit[2].toLowerCase();
    copper += unit === "g" ? amount * 1000 : unit === "s" ? amount * 10 : amount;
  }
  if (!matched && /^\d+$/.test(source)) return Number(source) * 10;
  return copper;
}

export function formatMoney(copper) {
  copper = Math.trunc(Number(copper) || 0);
  const sign = copper < 0 ? "−" : "";
  copper = Math.abs(copper);
  const g = Math.floor(copper / 1000);
  const s = Math.floor((copper % 1000) / 10);
  const c = copper % 10;
  const parts = [];
  if (g) parts.push(`${g}g`);
  if (s) parts.push(`${s}s`);
  if (c || !parts.length) parts.push(`${c}c`);
  return sign + parts.join(" ");
}

export function xpToLevel(level, pace) {
  const next = Math.max(1, level + 1);
  if (pace === "quick") return 5;
  if (pace === "epic") return 7 * next;
  if (pace === "saga") return 10 * next;
  return 5 * next;
}

export function statScore(hero, stat) {
  const base = clamp(hero.base?.[stat] ?? 2, 2, 7);
  const raise = hero.raises?.[stat] ?? 0;
  return clamp(base + raise, 2, 7);
}

export function scores(hero) {
  const out = {};
  for (const id of STAT_IDS) out[id] = statScore(hero, id);
  return out;
}

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export function automaticTrainings(hero) {
  const list = [];
  const cls = classById(hero.classId);
  if (cls && hero.level >= 1) list.push(...cls.trainings);
  if (hero.ancestry === "elf") list.push("detect");
  return [...new Set(list)];
}

export function chosenTrainings(hero) {
  const auto = new Set(automaticTrainings(hero));
  const picks = (hero.trainings || []).filter((id) => !auto.has(id) && id !== hero.elfSkill);
  return [...new Set(picks)];
}

export function isTrained(hero, skill) {
  if (automaticTrainings(hero).includes(skill)) return true;
  if (hero.ancestry === "elf" && hero.elfSkill === skill) return true;
  return (hero.trainings || []).includes(skill);
}

export function skillDc(hero, skillId) {
  const skill = SKILLS.find((s) => s.id === skillId);
  const score = statScore(hero, skill.stat);
  const trained = isTrained(hero, skillId);
  return 20 - score * (trained ? 2 : 1);
}

export function normalize(hero) {
  hero.level = Math.max(0, Math.trunc(Number(hero.level) || 0));
  hero.fatigue = clamp(Math.trunc(Number(hero.fatigue) || 0), 0, 5);
  hero.xp = Math.max(0, Math.trunc(Number(hero.xp) || 0));
  hero.wealth = Math.trunc(Number(hero.wealth) || 0);
  hero.studied = Math.max(0, Math.trunc(Number(hero.studied) || 0));
  hero.trainings = [...new Set(hero.trainings || [])];
  hero.spells = [...new Set(hero.spells || [])];
  hero.formulae = [...new Set(hero.formulae || [])];
  hero.items = hero.items || [];
  hero.perkChoices = hero.perkChoices || {};
  hero.magicalSecrets = hero.magicalSecrets || {};
  hero.raises = hero.raises || {};
  hero.base = hero.base || {};
  for (const id of STAT_IDS) {
    hero.base[id] = clamp(Math.trunc(Number(hero.base[id]) || 2), 2, 7);
    hero.raises[id] = Math.max(0, Math.trunc(Number(hero.raises[id]) || 0));
  }
  const cls = classById(hero.classId);
  if (cls?.requiredSpell && hero.level >= 1 && !hero.spells.includes(cls.requiredSpell)) {
    hero.spells.unshift(cls.requiredSpell);
  }
  // Class and ancestry trainings are derived, so they don't also sit in the chosen list.
  const auto = new Set(automaticTrainings(hero));
  hero.trainings = hero.trainings.filter((id) => !auto.has(id));
  if (hero.elfSkill && auto.has(hero.elfSkill)) hero.elfSkill = "";
  if (hero.hp != null) hero.hp = Math.max(0, Math.trunc(Number(hero.hp)));
  if (hero.mana != null) hero.mana = Math.max(0, Math.trunc(Number(hero.mana)));
  if (hero.luck != null) hero.luck = Math.max(0, Math.trunc(Number(hero.luck)));
  hero.conditions = hero.conditions || [];
  return hero;
}

export function rollD66() {
  const tens = 1 + Math.floor(Math.random() * 6);
  const ones = 1 + Math.floor(Math.random() * 6);
  return tens * 10 + ones;
}

export function ancestryFromD66(roll) {
  return ANCESTRIES.find((a) => roll >= a.d66[0] && roll <= a.d66[1]) || null;
}
export function classFromD66(roll) {
  return CLASSES.find((c) => roll >= c.d66[0] && roll <= c.d66[1]) || null;
}
export function packFromD66(roll) {
  return PACKS.find((p) => p.d66 === roll) || null;
}

export function assignBase(hero, stat, value) {
  // Custom scores are typed in. An array only swaps two stats, so the six numbers stay that array.
  value = clamp(value, 2, 7);
  if (hero.customStats) {
    hero.base[stat] = value;
    return;
  }
  const pool = [...STAT_ARRAYS[hero.statArray ?? 0]];
  const current = hero.base[stat];
  if (current === value) return;
  const other = STAT_IDS.find((id) => id !== stat && hero.base[id] === value);
  if (!other) return;
  const next = { ...hero.base, [stat]: value, [other]: current };
  const bag = [...pool];
  for (const id of STAT_IDS) {
    const index = bag.indexOf(next[id]);
    if (index < 0) return;
    bag.splice(index, 1);
  }
  hero.base[stat] = value;
  hero.base[other] = current;
}

export function setStatArray(hero, index) {
  hero.statArray = index;
  hero.customStats = false;
  const pool = STAT_ARRAYS[index];
  STAT_IDS.forEach((id, i) => hero.base[id] = pool[i]);
}
