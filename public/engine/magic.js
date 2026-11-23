// Casting: which skill casts a spell, what a casting costs, and the dice it rolls.

import { DELIVERIES } from "../data.js";
import { countPerk } from "./build.js";

const SECRET_SKILLS = ["arcana", "influence", "mysticism"];

function bestSkill(sheet, ids) {
  const options = sheet.skills.filter((skill) => ids.includes(skill.id));
  options.sort((a, b) => a.dc - b.dc);
  return options[0] || null;
}

export function castSkillFor(hero, sheet, spellId) {
  const byId = (id) => sheet.skills.find((skill) => skill.id === id) || null;
  if (sheet.castSkill && (hero.spells || []).includes(spellId)) return byId(sheet.castSkill);
  if (hero.ancestry === "elf" && hero.elfSpell === spellId) return byId(hero.elfCastSkill || "arcana");
  if (sheet.secretSpells.some((secret) => secret.id === spellId)) return bestSkill(sheet, SECRET_SKILLS);
  if (sheet.castSkill) return byId(sheet.castSkill);
  return bestSkill(sheet, sheet.skills.filter((skill) => skill.cast).map((skill) => skill.id));
}

// Spell-Slinger grows damage dice; Vehement Magic, Assured Healer, and Radiant Healer explode them.
export function spellDice(hero, spell, count) {
  if (!spell || !(count > 0)) return null;
  const heal = !!spell.heal;
  const sides = !heal && hero.classId === "sorcerer" && hero.level >= 4 ? 8 : 6;
  const explodeOn = [];
  if (heal) {
    if (countPerk(hero, "assured-healer")) explodeOn.push(1);
    if (hero.classId === "luminary" && hero.level >= 1) explodeOn.push(sides);
  } else if (countPerk(hero, "vehement-magic")) explodeOn.push(1);
  return { count, sides, explodeOn, heal, expr: `${count}d${sides}`, kind: heal ? "healing" : spell.damage };
}

// Damage and effect together cost 1, each damage die after the first costs 1, and healing
// dice cost 1 each. Delivery, its upcasting, and extra Remote targets are paid on top.
export function castCost(hero, spell, { delivery = "remote", dice = 0, effect = true, upcast = 0, targets = 1, attuned = true } = {}) {
  const info = DELIVERIES.find((entry) => entry.id === delivery) || DELIVERIES[0];
  const parts = [];
  const heal = !!spell?.heal;
  if (dice > 0 && heal) parts.push({ label: `${dice} healing ${dice === 1 ? "die" : "dice"}`, mana: dice });
  if (dice > 0 && !heal && effect) parts.push({ label: "Damage and effect", mana: 1 });
  if (dice > 1 && !heal) parts.push({ label: "Extra damage dice", mana: dice - 1 });
  parts.push({ label: info.name, mana: info.cost });
  const extra = Math.max(0, Math.trunc(upcast) || 0) + (delivery === "remote" ? Math.max(0, (Math.trunc(targets) || 1) - 1) : 0);
  if (extra) parts.push({ label: "Delivery upcast", mana: extra });

  let deliveryCost = info.cost + extra;
  const discount = (label, amount) => {
    const off = Math.min(amount, deliveryCost);
    if (off <= 0) return;
    deliveryCost -= off;
    parts.push({ label, mana: -off });
  };
  if (hero.classId === "wizard" && hero.level >= 4 && extra) {
    discount("Sculpt Spell", Math.min(extra, 1 + Math.floor((hero.level - 4) / 4)));
  }
  if (delivery === "aura" && hero.classId === "revelator" && hero.level >= 1) discount("Nimbus", 1);
  const damaging = dice > 0 && !heal;
  if ((delivery === "aura" || delivery === "cone") && !damaging && countPerk(hero, "harmonic-resonance")) {
    discount("Harmonic Resonance", 1);
  }
  if (attuned && hero.ancestry === "elf" && spell && hero.elfSpell === spell.id) discount("Naturally Attuned", 1);

  const mana = parts.reduce((sum, part) => sum + part.mana, 0);
  return { mana, parts, delivery: info };
}

// Sorcerers can Tap: HP pays whatever mana can't, and max HP drops by that much until rest.
export function castPayment(hero, sheet, mana) {
  const pool = hero.mana == null ? sheet.maxMana : hero.mana;
  const fromMana = Math.min(pool, mana);
  const short = mana - fromMana;
  const tap = hero.classId === "sorcerer" && hero.level >= 1;
  return { fromMana, fromHp: tap ? short : 0, ok: short === 0 || tap, pool };
}
