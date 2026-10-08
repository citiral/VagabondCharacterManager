// Clicks and typing. data-act chooses the edit; data-field writes the hero.

import { PACKS } from "./data.js";
import { attackProfile, plainDie, pushLog, rollCheck, rollExpr } from "./dice.js";
import {
  addCatalog,
  ancestryFromD66,
  applyPack,
  assignBase,
  blankHero,
  catalogById,
  classById,
  classFromD66,
  derive,
  formatMoney,
  instantiate,
  normalize,
  packFromD66,
  parseMoney,
  raisesExpected,
  raisesSpent,
  rollD66,
  setStatArray,
  spellById,
  statScore,
  trainingBudget,
  xpToLevel,
} from "./engine.js";
import { current, hydrate, state } from "./state.js";
import { commit, removeRemote, scheduleSave } from "./sync.js";
import { render } from "./ui/render.js";

// Changes to the open hero, and the clicks that make them.
function poolValue(hero, key, sheet) {
  if (key === "hp") return hero.hp == null ? sheet.effectiveMaxHp : hero.hp;
  if (key === "mana") return hero.mana == null ? sheet.maxMana : hero.mana;
  if (key === "luck") return hero.luck == null ? sheet.luckMax : hero.luck;
  return hero[key] || 0;
}

function bumpLevel(hero, spend) {
  const before = derive(hero);
  const cost = xpToLevel(hero.level, hero.pace);
  if (spend && hero.xp < cost) return;
  const hp = hero.hp == null ? before.effectiveMaxHp : hero.hp;
  const mana = hero.mana == null ? before.maxMana : hero.mana;
  const fullHp = hp >= before.effectiveMaxHp;
  const fullMana = mana >= before.maxMana;
  if (spend) hero.xp -= cost;
  hero.level += 1;
  normalize(hero);
  const after = derive(hero);
  hero.hp = fullHp ? after.effectiveMaxHp : hp;
  hero.mana = fullMana ? after.maxMana : mana;
}

document.addEventListener("input", (event) => {
  const el = event.target;
  if (!(el instanceof HTMLElement)) return;
  if (el.dataset.ui) {
    state[el.dataset.ui] = el.value;
    render();
    return;
  }
  if (el.dataset.uiNum) {
    state[el.dataset.uiNum] = Number(el.value);
    render();
    return;
  }
  const hero = current();
  if (!hero || !el.dataset.field) return;
  writeField(hero, el.dataset.field, el.value);
  scheduleSave(hero);
  if (el.dataset.render) render();
});

document.addEventListener("change", (event) => {
  const el = event.target;
  if (!(el instanceof HTMLElement)) return;
  if (el.dataset.act) {
    onAct(el);
    return;
  }
  const hero = current();
  if (!hero || !el.dataset.field) return;
  writeField(hero, el.dataset.field, el.value);
  commit(hero);
});

document.addEventListener("click", (event) => {
  const el = event.target instanceof HTMLElement ? event.target.closest("[data-act]") : null;
  if (!el || el.tagName === "SELECT" || el.tagName === "INPUT" || el.tagName === "TEXTAREA") return;
  onAct(el);
});

function writeField(hero, field, value) {
  if (["name", "player", "concept", "notes"].includes(field)) hero[field] = value;
  else if (field === "wealth") hero.wealth = parseMoney(value);
  else if (field === "hp") hero.hp = Math.max(0, Math.trunc(Number(value) || 0));
  else if (field === "mana") hero.mana = Math.max(0, Math.trunc(Number(value) || 0));
  else if (field === "luck") hero.luck = Math.max(0, Math.trunc(Number(value) || 0));
  else if (field === "xp") hero.xp = Math.max(0, Math.trunc(Number(value) || 0));
  else if (field === "level") hero.level = Math.max(0, Math.trunc(Number(value) || 0));
  else if (field === "studied") hero.studied = Math.max(0, Math.trunc(Number(value) || 0));
}

function onAct(el) {
  const act = el.dataset.act;
  const hero = current();
  if (act === "new") return createHero();
  if (act === "import") return document.querySelector("#import-file")?.click();
  if (act === "export-all") return download("vagabond-party.json", state.heroes);
  if (act === "party") { state.party = !state.party; render(); return; }
  if (act === "tab") { state.party = false; state.tab = el.dataset.tab; render(); return; }
  if (act === "select") { state.id = el.dataset.id; state.party = false; localStorage.setItem("vagabond-id", state.id); render(); return; }
  if (act === "open") { state.id = el.dataset.id; state.party = false; state.tab = "record"; localStorage.setItem("vagabond-id", state.id); render(); return; }
  if (act === "favor") { state.favor = Number(el.dataset.value); render(); return; }
  if (act === "explode") { state.explode = !state.explode; render(); return; }
  if (act === "tray") {
    state.trayMin = !state.trayMin;
    localStorage.setItem("vagabond-tray", state.trayMin ? "min" : "open");
    render();
    return;
  }
  if (act === "die") return pushAndRender(plainDie(Number(el.dataset.sides)));
  if (act === "d66") return pushAndRender({ title: "d66", detail: String(rollD66()), pass: true });
  if (act === "question") { state.qs[Number(el.dataset.i)] = el.checked; render(); return; }
  if (act === "loot") { state.loot = el.checked; render(); return; }
  if (act === "gear-cat") { state.gearCat = el.value; render(); return; }
  if (act === "spell-filter") { state.spellFilter = el.dataset.filter || "all"; render(); return; }
  if (act === "spell-type") { state.spellType = el.value; render(); return; }
  if (act === "cast-spell") { state.castSpell = el.value; state.dice = spellById(el.value)?.damage ? 1 : 0; render(); return; }
  if (act === "cast-delivery") { state.delivery = el.value; render(); return; }
  if (act === "cast-effect") { state.effect = el.checked; render(); return; }
  if (!hero) return;

  if (act === "ancestry") hero.ancestry = el.value;
  else if (act === "class") hero.classId = el.value;
  else if (act === "pace") hero.pace = el.value;
  else if (act === "draken") hero.drakenWard = el.value;
  else if (act === "array") setStatArray(hero, Number(el.dataset.index));
  else if (act === "custom") hero.customStats = !hero.customStats;
  else if (act === "base") {
    if (hero.customStats) hero.base[el.dataset.stat] = Number(el.value);
    else assignBase(hero, el.dataset.stat, Number(el.value));
  } else if (act === "raise") {
    const stat = el.dataset.stat;
    const delta = Number(el.dataset.delta);
    const spent = raisesSpent(hero);
    const expected = raisesExpected(hero);
    if (delta > 0 && statScore(hero, stat) < 7 && (hero.customStats || spent < expected)) hero.raises[stat] = (hero.raises[stat] || 0) + 1;
    if (delta < 0 && (hero.raises[stat] || 0) > 0) hero.raises[stat] -= 1;
  } else if (act === "training") {
    const rows = [];
    const budget = Math.max(trainingBudget(hero), (hero.trainings || []).length);
    for (let i = 0; i < budget; i++) rows.push(hero.trainings[i] || "");
    rows[Number(el.dataset.index)] = el.value;
    const unique = [];
    for (const id of rows) if (id && !unique.includes(id)) unique.push(id);
    hero.trainings = unique;
  } else if (act === "elf-skill") hero.elfSkill = el.value;
  else if (act === "elf-spell") hero.elfSpell = el.value;
  else if (act === "elf-cast") hero.elfCastSkill = el.value;
  else if (act === "perk") hero.perkChoices[el.dataset.slot] = el.value;
  else if (act === "secret") hero.magicalSecrets[el.dataset.slot] = el.value;
  else if (act === "roll-ancestry") {
    const found = rollTable(ancestryFromD66);
    if (found) hero.ancestry = found.id;
  } else if (act === "roll-class") {
    const found = rollTable(classFromD66);
    if (found) hero.classId = found.id;
  } else if (act === "roll-array") setStatArray(hero, Math.floor(Math.random() * 8));
  else if (act === "roll-pack") {
    const found = rollTable(packFromD66);
    if (found && confirm(`Take the ${found.name} pack? This replaces carried gear.`)) applyPack(hero, found.id);
  } else if (act === "apply-pack") {
    const id = document.querySelector("#pack-select")?.value;
    const pack = PACKS.find((entry) => entry.id === id);
    if (pack && confirm(`Take the ${pack.name} pack? This replaces carried gear.`)) applyPack(hero, pack.id);
  } else if (act === "buy") return buy(hero, el.dataset.id);
  else if (act === "equip") toggleEquip(hero, el.dataset.uid);
  else if (act === "qty") changeQty(hero, el.dataset.uid, Number(el.dataset.delta));
  else if (act === "sell") sell(hero, el.dataset.uid);
  else if (act === "drop") hero.items = hero.items.filter((item) => item.uid !== el.dataset.uid);
  else if (act === "grip") {
    const item = hero.items.find((entry) => entry.uid === el.dataset.uid);
    if (item) item.gripMode = item.gripMode === "2h" ? "1h" : "2h";
  } else if (act === "custom") addCustom(hero);
  else if (act === "spell-add") toggleList(hero, "spells", el.dataset.id, true);
  else if (act === "spell-forget") {
    if (classById(hero.classId)?.requiredSpell === el.dataset.id) return;
    toggleList(hero, "spells", el.dataset.id, false);
  }
  else if (act === "formula") toggleList(hero, "formulae", el.dataset.id, el.checked);
  else if (act === "condition") {
    hero.conditions = hero.conditions.includes(el.dataset.name)
      ? hero.conditions.filter((name) => name !== el.dataset.name)
      : [...hero.conditions, el.dataset.name];
  } else if (act === "delta") {
    const key = el.dataset.key;
    hero[key] = Math.max(0, (hero[key] || 0) + Number(el.dataset.delta));
    if (key === "fatigue") hero.fatigue = Math.min(5, hero.fatigue);
  } else if (act === "pool") {
    const sheet = derive(hero);
    const key = el.dataset.key;
    const next = Math.max(0, poolValue(hero, key, sheet) + Number(el.dataset.delta));
    hero[key] = next;
  } else if (act === "rest") rest(hero);
  else if (act === "breather") breather(hero);
  else if (act === "new-shift") hero.breatherUsed = false;
  else if (act === "level-up") bumpLevel(hero, true);
  else if (act === "destiny") bumpLevel(hero, false);
  else if (act === "award") return award();
  else if (act === "delete") return removeHero(hero);
  else if (act === "duplicate") return copyHero(hero);
  else if (act === "export-one") return download(`${hero.name || "hero"}.json`, hero);
  else if (act === "export-pdf") {
    exportPdf(hero);
    return;
  }
  else if (act === "roll-skill") return rollSkill(hero, el.dataset.skill);
  else if (act === "roll-save") return rollSave(hero, el.dataset.save);
  else if (act === "roll-weapon") return rollWeapon(hero, el.dataset.uid);
  else if (act === "roll-unarmed") return rollWeapon(hero, null);
  else return;
  commit(hero);
}

function rollTable(fn) {
  for (let i = 0; i < 40; i++) {
    const found = fn(rollD66());
    if (found) return found;
  }
  return null;
}

function toggleList(hero, key, id, on) {
  const list = new Set(hero[key] || []);
  if (on) list.add(id);
  else list.delete(id);
  hero[key] = [...list];
}

function toggleEquip(hero, uid) {
  const item = hero.items.find((entry) => entry.uid === uid);
  if (!item) return;
  if (item.kind === "armor" && !item.equipped) {
    for (const other of hero.items) if (other.kind === "armor") other.equipped = false;
  }
  item.equipped = !item.equipped;
}

function changeQty(hero, uid, delta) {
  const item = hero.items.find((entry) => entry.uid === uid);
  if (!item) return;
  if (item.kind === "weapon" || item.kind === "armor") return;
  item.qty = Math.max(0, (item.qty || 1) + delta);
  if (item.qty <= 0) hero.items = hero.items.filter((entry) => entry.uid !== uid);
}

function sell(hero, uid) {
  const item = hero.items.find((entry) => entry.uid === uid);
  if (!item) return;
  hero.wealth += (item.value || 0) * (item.qty || 1);
  hero.items = hero.items.filter((entry) => entry.uid !== uid);
}

function buy(hero, id) {
  const entry = catalogById(id);
  if (!entry) return;
  if (!state.loot) {
    if (hero.wealth < entry.value) {
      state.error = `That costs ${formatMoney(entry.value)}. The purse holds ${formatMoney(hero.wealth)}.`;
      render();
      return;
    }
    hero.wealth -= entry.value;
  }
  state.error = "";
  addCatalog(hero, id, 1);
  commit(hero);
}

function addCustom(hero) {
  const name = document.querySelector("#custom-name")?.value?.trim();
  if (!name) return;
  const kind = document.querySelector("#custom-kind")?.value || "gear";
  const slots = Math.max(0, Number(document.querySelector("#custom-slots")?.value || 1));
  const value = parseMoney(document.querySelector("#custom-value")?.value || "0");
  const raw = document.querySelector("#custom-weapon")?.value || "";
  const [damage, range, grip] = raw.split(",").map((part) => part.trim());
  hero.items.push({
    ...instantiate({ id: "custom", name, kind, slots, value, damage: damage || (kind === "weapon" ? "d4" : ""), range: range || "Close", grip: grip || "1h", types: kind === "weapon" ? ["melee"] : [], props: [] }),
    catalogId: null,
  });
  commit(hero);
}

function rest(hero) {
  const before = derive(hero);
  const hp = poolValue(hero, "hp", before);
  if (hp >= before.effectiveMaxHp) hero.fatigue = Math.max(0, (hero.fatigue || 0) - 1);
  const after = derive(hero);
  hero.hp = after.effectiveMaxHp;
  hero.mana = after.maxMana;
  hero.luck = after.luckMax;
  hero.breatherUsed = false;
}

function breather(hero) {
  if (hero.breatherUsed) return;
  const sheet = derive(hero);
  hero.hp = Math.min(sheet.effectiveMaxHp, poolValue(hero, "hp", sheet) + sheet.scores.might);
  hero.breatherUsed = true;
}

function award() {
  const gain = state.qs.filter(Boolean).length;
  if (!gain) return;
  for (const hero of state.heroes) {
    hero.xp += gain;
    scheduleSave(hero, true);
  }
  state.qs = [false, false, false, false, false, false];
  render();
}

// Skill, save, and weapon rolls.
function rollSkill(hero, id) {
  const sheet = derive(hero);
  const skill = sheet.skills.find((entry) => entry.id === id);
  const critAt = skill.cast && hero.classId === "sorcerer" ? sheet.castCrit : 20;
  rollCheck(skill.name, skill.dc, critAt);
  render();
}

function rollSave(hero, id) {
  const sheet = derive(hero);
  const names = { endure: "Endure", reflex: "Reflex", will: "Will" };
  const dc = sheet[id];
  rollCheck(names[id], dc, 20);
  render();
}

function rollWeapon(hero, uid) {
  const sheet = derive(hero);
  const item = uid
    ? hero.items.find((entry) => entry.uid === uid)
    : { name: "Unarmed", types: ["brawl", "finesse"], props: ["grapple"], damage: "1", grip: "1h" };
  if (!item) return;
  const profile = attackProfile(hero, item, sheet);
  if (!profile.skill) return;
  const critAt = sheet.attackCrit;
  const check = rollCheck(`${item.name} · ${profile.skill.name}`, profile.skill.dc, critAt);
  if (check.pass) {
    const damage = rollExpr(profile.damage, state.explode);
    state.log[0].detail += `. Damage ${damage.total} (${damage.text})`;
  }
  render();
}

function pushAndRender(entry) {
  pushLog(entry);
  render();
}

// Heroes on the server: create, copy, delete, import, export.
async function removeHero(hero) {
  if (!confirm(`Delete ${hero.name || "this hero"}?`)) return;
  await removeRemote(hero.id);
  state.heroes = state.heroes.filter((entry) => entry.id !== hero.id);
  state.id = state.heroes[0]?.id || "";
  localStorage.setItem("vagabond-id", state.id);
  render();
}

async function copyHero(hero) {
  const copy = hydrate(structuredClone(hero));
  copy.id = crypto.randomUUID();
  copy.name = `${hero.name || "Hero"} copy`;
  copy.createdAt = Date.now();
  const response = await fetch("/api/heroes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(copy),
  });
  if (!response.ok) return;
  const saved = hydrate(await response.json());
  if (!state.heroes.some((entry) => entry.id === saved.id)) state.heroes.push(saved);
  state.id = saved.id;
  localStorage.setItem("vagabond-id", saved.id);
  render();
}

async function createHero() {
  const hero = blankHero();
  hero.name = "New hero";
  const response = await fetch("/api/heroes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(hero),
  });
  if (!response.ok) {
    state.error = "Couldn't create a hero.";
    render();
    return;
  }
  const saved = hydrate(await response.json());
  if (!state.heroes.some((entry) => entry.id === saved.id)) state.heroes.push(saved);
  state.id = saved.id;
  state.tab = "build";
  state.party = false;
  localStorage.setItem("vagabond-id", saved.id);
  render();
}

let pdfBusy = false;

async function exportPdf(hero) {
  if (pdfBusy) return;
  pdfBusy = true;
  try {
    const { downloadHeroRecord } = await import("./sheet-pdf.js");
    await downloadHeroRecord(hero);
  } catch (error) {
    console.error(error);
    state.error = "Couldn't build the PDF sheet.";
    render();
  } finally {
    pdfBusy = false;
  }
}

function download(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

document.addEventListener("change", async (event) => {
  const input = event.target;
  if (input?.id !== "import-file") return;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const incoming = Array.isArray(data) ? data : [data];
    for (const raw of incoming) {
      const hero = hydrate(raw);
      hero.id = crypto.randomUUID();
      hero.name = hero.name || "Imported hero";
      const response = await fetch("/api/heroes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(hero),
      });
      if (response.ok) {
        const saved = hydrate(await response.json());
        if (!state.heroes.some((entry) => entry.id === saved.id)) state.heroes.push(saved);
      }
    }
    state.error = "";
  } catch {
    state.error = "That file isn't a hero record.";
  }
  input.value = "";
  render();
});
