import {
  ALCHEMY,
  ANCESTRIES,
  ARMORS,
  CATALOG,
  CLASSES,
  GEAR,
  PACKS,
  PERKS,
  SKILLS,
  SPELLS,
  STATS,
  STAT_ARRAYS,
  WEAPONS,
} from "./data.js";

const STAT_IDS = STATS.map((s) => s.id);

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

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export function automaticTrainings(hero) {
  const list = [];
  const cls = classById(hero.classId);
  if (cls && hero.level >= 1) list.push(...cls.trainings);
  if (hero.ancestry === "elf") list.push("detect");
  return [...new Set(list)];
}

export function trainingBudget(hero) {
  const reason = statScore(hero, "reason");
  const fromReason = Math.ceil(reason / 2);
  const fromHuman = hero.ancestry === "human" ? 1 : 0;
  const fromPerks = countPerk(hero, "new-training");
  return fromReason + fromHuman + fromPerks;
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

function grantedClassPerks(classId) {
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

function manaPool(hero) {
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

function knownSpells(hero) {
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

function speedFromDex(dex) {
  if (dex <= 3) return 25;
  if (dex <= 5) return 30;
  return 35;
}

export function itemSlots(item) {
  if (!item) return 0;
  if (item.equipped && item.zeroWhenWorn) return 0;
  const size = item.slots ?? item.slotSize ?? 1;
  const qty = item.qty || 1;
  if (size === 0) return qty > 0 ? Math.ceil(qty / 10) : 0;
  return size * qty;
}

function stepDie(die, steps) {
  const ladder = ["d4", "d6", "d8", "d10", "d12"];
  const index = ladder.indexOf(die);
  if (index < 0) return die;
  const next = index + steps;
  if (next < ladder.length) return ladder[next];
  return `d12+${next - (ladder.length - 1)}`;
}

export function weaponDamage(item) {
  let die = item.damage || "d4";
  if (item.grip === "v" && item.gripMode === "2h" && die !== "1") die = stepDie(die, 1);
  return die;
}

export function instantiate(entry, qty = 1) {
  return {
    uid: crypto.randomUUID(),
    catalogId: entry.id,
    name: entry.name,
    kind: entry.kind,
    qty: entry.kind === "weapon" || entry.kind === "armor" ? 1 : qty,
    slots: entry.slots ?? 1,
    value: entry.value ?? 0,
    equipped: false,
    types: entry.types ? [...entry.types] : [],
    props: entry.props ? [...entry.props] : [],
    range: entry.range || "",
    grip: entry.grip || "",
    gripMode: entry.grip === "2h" ? "2h" : "1h",
    damage: entry.damage || "",
    rating: entry.rating || 0,
    might: entry.might || 0,
    capacity: entry.capacity || 0,
    zeroWhenWorn: !!entry.zeroWhenWorn,
    blurb: entry.blurb || entry.type || "",
    type: entry.type || "",
  };
}

export function addCatalog(hero, catalogId, qty = 1) {
  const entry = catalogById(catalogId);
  if (!entry) return;
  if (entry.kind === "weapon" || entry.kind === "armor") {
    for (let i = 0; i < qty; i++) hero.items.push(instantiate(entry, 1));
    return;
  }
  if (entry.stack) {
    const existing = hero.items.find((item) => item.catalogId === catalogId);
    if (existing) {
      existing.qty += qty;
      return;
    }
  }
  hero.items.push(instantiate(entry, qty));
}

export function applyPack(hero, packId) {
  const pack = PACKS.find((p) => p.id === packId);
  if (!pack) return;
  hero.items = [];
  hero.wealth = pack.wealth;
  for (const [id, qty] of pack.items) addCatalog(hero, id, qty);
  const backpack = hero.items.find((item) => item.catalogId === "backpack");
  if (backpack) backpack.equipped = true;
  const armor = hero.items.find((item) => item.kind === "armor");
  if (armor) armor.equipped = true;
  let weaponSlots = 0;
  for (const item of hero.items) {
    if (item.kind !== "weapon") continue;
    if (weaponSlots + (item.slots || 0) > 3) continue;
    item.equipped = true;
    weaponSlots += item.slots || 0;
  }
}

function dieSize(token) {
  if (token === "1") return 0;
  const match = /^d(\d+)/.exec(token || "");
  return match ? Number(match[1]) : 0;
}

export function derive(hero) {
  const warnings = [];
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

export { ALCHEMY, ANCESTRIES, ARMORS, CATALOG, CLASSES, GEAR, PACKS, PERKS, SKILLS, SPELLS, STATS, STAT_ARRAYS, WEAPONS, dieSize };
