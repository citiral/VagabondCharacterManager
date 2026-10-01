import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFRef,
  PDFString,
  StandardFonts,
} from "./vendor/pdf-lib.esm.min.js";
import {
  ALCHEMY,
  ancestryById,
  classById,
  derive,
  itemSlots,
  normalize,
  perkById,
  spellById,
  weaponDamage,
} from "./engine.js";

const STAT_FIELDS = {
  might: "MIT",
  dexterity: "DEX",
  awareness: "AWR",
  reason: "LOG",
  presence: "PRS",
  luck: "LUK",
};

const SKILL_FIELDS = {
  brawl: ["Brawn Trained", "Brawn Skill Difficulty"],
  finesse: ["Finesse Trained", "Finesse Skill Difficulty"],
  melee: ["Melee Weapons Trained", "Melee Attack Check Difficulty"],
  ranged: ["Ranged Weapons Trained", "Ranged Attack Difficulty"],
  arcana: ["Arcana Trained", "Arcana Skill Difficulty"],
  craft: ["Craft Trained", "Craft Skill Difficulty"],
  detect: ["Detect Trained", "Detect Skill Difficulty"],
  influence: ["Influence Trained", "Influence Skill Difficulty"],
  leadership: ["Leadership Trained", "Leadership Skill Difficulty"],
  medicine: ["Medicine Trained", "Medicine Skill Difficulty"],
  mysticism: ["Mysticism Trained", "Mysticism Skill Difficulty"],
  performance: ["Performance Trained", "Performance Skill Difficulty"],
  sneak: ["Sneak Trained", "Sneak Skill Difficulty"],
  survival: ["Survival Trained", "Survival Skill Difficulty"],
};

const SIZE_CODES = {
  small: "S",
  medium: "M",
  large: "L",
  huge: "H",
  gargantuan: "G",
  colossal: "C",
};

function pdfText(value) {
  return String(value ?? "")
    .replace(/[–—−]/g, "-")
    .replace(/×/g, "x")
    .replace(/[·•]/g, "*")
    .replace(/…/g, "...")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\n\r\t\x20-\x7E]/g, "");
}

function num(value) {
  const n = Number(value) || 0;
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 10) / 10);
}

function coins(copper) {
  let n = Math.trunc(Number(copper) || 0);
  const sign = n < 0 ? -1 : 1;
  n = Math.abs(n);
  return {
    g: sign * Math.floor(n / 1000),
    s: Math.floor((n % 1000) / 10),
    c: n % 10,
  };
}

function setText(form, name, value) {
  const field = form.getTextField(name);
  let text = pdfText(value);
  const max = field.getMaxLength();
  if (max && text.length > max) text = text.slice(0, max);
  field.setText(text);
}

function setBox(form, name, on) {
  const box = form.getCheckBox(name);
  if (on) box.check();
  else box.uncheck();
}

function selectChoice(form, name, value) {
  const field = form.getDropdown(name);
  if (!value || !field.getOptions().includes(value)) return false;
  field.select(value);
  return true;
}

function rewriteScript(text, armorPenalty) {
  let next = text.replaceAll("===", "==");
  if (
    armorPenalty > 0 &&
    next.includes('getField("DEX")') &&
    next.includes('getField("AWR")') &&
    next.includes("event.value = 20 - (b + c)")
  ) {
    next = next.replace(
      "event.value = 20 - (b + c)",
      `event.value = 20 - (b + c) + ${armorPenalty}`,
    );
  }
  return next;
}

function patchScripts(pdfDoc, armorPenalty) {
  const { context } = pdfDoc;
  for (const [, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const js = obj.get(PDFName.of("JS"));
    if (!js) continue;
    const target = js instanceof PDFRef ? context.lookup(js) : js;
    if (!target || typeof target.decodeText !== "function") continue;
    const text = target.decodeText();
    const next = rewriteScript(text, armorPenalty);
    if (next === text) continue;
    const encoded = PDFString.of(next);
    if (js instanceof PDFRef) context.assign(js, encoded);
    else obj.set(PDFName.of("JS"), encoded);
  }
}

function itemLabel(item) {
  const qty = (item.qty || 1) > 1 ? ` x${item.qty}` : "";
  const mark = item.equipped ? (item.kind === "weapon" ? " (readied)" : " (worn)") : "";
  return `${item.name || "Item"}${qty}${mark}`;
}

function inventoryRows(hero) {
  const items = [...(hero.items || [])].sort((a, b) => Number(b.equipped) - Number(a.equipped));
  const rows = items.map((item) => ({ name: itemLabel(item), slots: itemSlots(item) }));
  if ((hero.fatigue || 0) > 0) rows.push({ name: "Fatigue", slots: hero.fatigue });
  if (rows.length <= 14) return rows;
  const head = rows.slice(0, 13);
  const tail = rows.slice(13);
  head.push({
    name: tail.map((row) => row.name).join(", "),
    slots: tail.reduce((sum, row) => sum + row.slots, 0),
  });
  return head;
}

function gripCode(item, options) {
  const grip = String(item.grip || "").toLowerCase();
  const mode = String(item.gripMode || grip).toLowerCase();
  let code = "1H";
  if (grip === "2h" || mode === "2h") code = "2H";
  if (grip === "v") code = options.includes("V") ? "V" : (mode === "2h" ? "2H" : "1H");
  if (!options.includes(code)) code = options.includes("1H") ? "1H" : "F";
  return code;
}

function weaponProps(item, code) {
  const props = [];
  if (item.range) props.push(item.range);
  for (const id of item.props || []) props.push(id[0].toUpperCase() + id.slice(1));
  if (String(item.grip || "").toLowerCase() === "v" && code !== "V") props.push("Versatile");
  if (String(item.grip || "").toLowerCase() === "v" && item.gripMode === "2h") props.push("held 2H");
  return props.join(", ");
}

function abilityLines(hero, sheet) {
  const lines = [];
  if (hero.player) lines.push(`Player: ${hero.player}`);
  if (hero.concept) lines.push(hero.concept);
  const featureNames = sheet.features.map((feature) => feature.name.toLowerCase());
  const extraTags = sheet.tags.filter((tag) => {
    const text = tag.toLowerCase();
    return !featureNames.some((name) => text === name || text.includes(name));
  });
  if (extraTags.length) lines.push(extraTags.join(", "));
  const granted = new Set();
  for (const feature of sheet.features) {
    lines.push(`${feature.name} (${feature.source}): ${feature.text}`);
    granted.add(String(feature.name || "").toLowerCase());
  }
  for (const grant of sheet.grants) {
    const perk = perkById(grant.id);
    if (!perk || granted.has(perk.name.toLowerCase())) continue;
    lines.push(`${perk.name} (${grant.source}): ${perk.summary || ""}`);
  }
  for (const slot of sheet.slots) {
    const id = hero.perkChoices?.[slot.key];
    if (!id) continue;
    const perk = perkById(id);
    lines.push(`${slot.label}: ${perk?.name || id}. ${perk?.summary || ""}`);
    if (id === "magical-secret") {
      const secret = spellById(hero.magicalSecrets?.[slot.key]);
      if (secret) lines.push(`Magical Secret: ${secret.name}`);
    }
  }
  if (hero.conditions?.length) lines.push(`Conditions: ${hero.conditions.join(", ")}`);
  if (hero.studied) lines.push(`Studied dice: ${hero.studied}`);
  if (sheet.attackCrit < 20) lines.push(`Attack crits on a natural ${sheet.attackCrit} or higher.`);
  if (sheet.castCrit < 20) lines.push(`Cast checks crit on a natural ${sheet.castCrit} or higher.`);
  if (hero.notes) lines.push(hero.notes);
  return lines.join("\n");
}

function magicLines(hero, sheet) {
  const lines = [];
  for (const id of sheet.knownSpells) {
    const spell = spellById(id);
    if (!spell) continue;
    const tags = [spell.damage, spell.object ? "Object" : ""].filter(Boolean);
    lines.push(`${spell.name}${tags.length ? ` (${tags.join(", ")})` : ""}: ${spell.summary || ""}`);
  }
  for (const id of hero.formulae || []) {
    const item = ALCHEMY.find((entry) => entry.id === id);
    if (!item) continue;
    lines.push(`Formula: ${item.name}${item.type ? ` (${item.type})` : ""}: ${item.blurb || ""}`);
  }
  return lines;
}

function fillWeapons(form, sheet) {
  const weapons = sheet.weapons.slice(0, 3);
  for (let i = 1; i <= 3; i++) {
    const item = weapons[i - 1];
    const grip = form.getDropdown(`Grip ${i}`);
    if (!item) {
      setText(form, `Weapon ${i}`, "");
      setText(form, `Weapon Damage ${i}`, "");
      setText(form, `Weapon Properties ${i}`, "");
      if (grip.getOptions().includes("F")) grip.select("F");
      continue;
    }
    const code = gripCode(item, grip.getOptions());
    setText(form, `Weapon ${i}`, item.name);
    setText(form, `Weapon Damage ${i}`, weaponDamage(item));
    setText(form, `Weapon Properties ${i}`, weaponProps(item, code));
    grip.select(code);
  }
}

function fillInventory(form, hero) {
  const rows = inventoryRows(hero);
  let used = 0;
  for (let i = 1; i <= 14; i++) {
    const row = rows[i - 1];
    const slots = row ? row.slots : 0;
    used += slots;
    setText(form, `Inventory ${i}`, row ? row.name : "");
    setText(form, `Item Slot ${i}`, num(Math.min(99, Math.max(0, slots))));
  }
  return used;
}

export async function heroRecordBytes(hero, template) {
  normalize(hero);
  const sheet = derive(hero);
  const pdfDoc = await PDFDocument.load(template);
  patchScripts(pdfDoc, sheet.armorPenalty);
  const form = pdfDoc.getForm();
  const ancestry = ancestryById(hero.ancestry);
  const cls = classById(hero.classId);

  setText(form, "Name", hero.name || "");
  setText(form, "Class", cls?.name || "");
  setText(form, "Ancestry", ancestry?.name || "");
  setText(form, "Level", num(sheet.level));
  setText(form, "XP", num(hero.xp));
  if (ancestry) {
    selectChoice(form, "Being Type", ancestry.type);
    const size = SIZE_CODES[String(ancestry.size || "").toLowerCase()] || "";
    selectChoice(form, "Size", size);
  }

  for (const [stat, field] of Object.entries(STAT_FIELDS)) {
    setText(form, field, num(sheet.scores[stat]));
  }

  for (const skill of sheet.skills) {
    const fields = SKILL_FIELDS[skill.id];
    if (!fields) continue;
    setBox(form, fields[0], skill.trained);
    setText(form, fields[1], num(skill.dc));
  }

  setText(form, "Endure Save Difficulty", num(sheet.endure));
  setText(form, "Reflex Save Difficulty", num(sheet.reflex));
  setText(form, "Will Save Difficulty", num(sheet.will));

  const hp = hero.hp == null ? sheet.effectiveMaxHp : hero.hp;
  const mana = hero.mana == null ? sheet.maxMana : hero.mana;
  const luck = hero.luck == null ? sheet.luckMax : hero.luck;
  setText(form, "Current HP", num(hp));
  setText(form, "Max HP", num(sheet.effectiveMaxHp));
  setText(form, "Current Mana", num(mana));
  setText(form, "Max Mana", num(sheet.maxMana));
  setText(form, "Casting Maximum", num(sheet.castMax));
  setText(form, "Current Luck", num(luck));
  setText(form, "Fatigue", num(sheet.fatigue));
  setText(form, "Armor Rating", num(sheet.armorRating));
  setText(form, "Speed", num(sheet.speed));
  setText(form, "Speed Bonus", num(sheet.speedBonus));
  setText(form, "Crawl Speed", num(sheet.crawl));
  setText(form, "Travel Speed", num(sheet.travel));

  const money = coins(hero.wealth);
  setText(form, "Wealth (g)", num(money.g));
  setText(form, "Wealth (s)", num(money.s));
  setText(form, "Wealth (c)", num(money.c));

  const bonus = Math.max(0, sheet.slotMax - 8 - sheet.scores.might);
  setText(form, "Bonus Item Slots", num(bonus));
  const used = fillInventory(form, hero);
  setText(form, "Occupied Item Slots", num(used));
  setText(form, "Maximum Item Slots", num(8 + sheet.scores.might + bonus));

  fillWeapons(form, sheet);

  const magic = magicLines(hero, sheet);
  const mid = Math.ceil(magic.length / 2);
  const first = magic.length > 8 ? magic.slice(0, mid) : magic;
  const second = magic.length > 8 ? magic.slice(mid) : [];
  setText(form, "Magic 1", first.join("\n"));
  setText(form, "Magic 2", second.join("\n"));
  setText(form, "Abilities", abilityLines(hero, sheet));

  const title = hero.name ? `${hero.name} hero record` : "Vagabond hero record";
  pdfDoc.setTitle(pdfText(title));
  if (hero.player) pdfDoc.setAuthor(pdfText(hero.player));

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  for (const field of form.getFields()) {
    // The sheet's checkmarks are Zapf dingbats. pdf-lib cannot redraw them,
    // and check()/uncheck() already point at the right on/off appearance.
    if (typeof field.isChecked === "function") continue;
    try {
      field.updateAppearances(font);
    } catch (error) {
      console.warn(`Left the original appearance for ${field.getName()}`, error);
    }
  }

  return pdfDoc.save();
}

export async function downloadHeroRecord(hero) {
  const response = await fetch("/hero-record.pdf");
  if (!response.ok) throw new Error(`Hero record template responded ${response.status}`);
  const bytes = await heroRecordBytes(hero, await response.arrayBuffer());
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const base = pdfText(hero.name).replace(/[<>:"/\\|?*]+/g, "").trim() || "hero";
  link.href = url;
  link.download = `${base} hero record.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
