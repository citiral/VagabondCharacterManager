// The magic tab: spells known, the casting-cost helper, and alchemist formulae.

import { ALCHEMY, DELIVERIES, SPELLS } from "../data.js";
import { classById, formatMoney, spellById } from "../engine.js";
import { esc, option, skillName, warnings } from "../html.js";
import { state } from "../state.js";

const SPELL_FILTERS = [
  ["all", "All"],
  ["known", "Known"],
  ["damage", "Damage"],
  ["plain", "No damage"],
  ["object", "Object"],
];
const SPELL_TYPES = ["Acid", "Cold", "Fire", "Poison", "Shock", "Blunt"];

export function magic(hero, sheet) {
  const cls = classById(hero.classId);
  const known = new Set(hero.spells || []);
  const catalog = SPELLS.filter((spell) => spellVisible(spell, known));
  return `
    <article class="sheet">
      ${warnings(sheet)}
      <p class="kicker">Magic</p>
      <div class="chips" style="justify-content:flex-start">
        <span class="chip">Mana ${hero.mana == null ? sheet.maxMana : hero.mana} / ${sheet.maxMana}</span>
        <span class="chip">Cast max ${sheet.castMax}</span>
        <span class="chip">${sheet.castSkill ? `Casts with ${esc(skillName(sheet.castSkill))}` : "No class casting skill"}</span>
        ${sheet.spellLimit ? `<span class="chip">Spells ${known.size} / ${sheet.spellLimit}</span>` : ""}
      </div>
      ${hero.ancestry === "elf" ? `
        <div class="fields" style="margin-top:12px">
          <label class="field">Naturally Attuned spell
            <select data-act="elf-spell">${option("", "Choose", !hero.elfSpell)}${SPELLS.map((spell) => option(spell.id, spell.name, hero.elfSpell === spell.id)).join("")}</select>
          </label>
          <label class="field">Cast that spell with
            <select data-act="elf-cast">${["arcana", "mysticism", "influence", "survival", "leadership"].map((id) => option(id, skillName(id), hero.elfCastSkill === id)).join("")}</select>
          </label>
        </div>` : ""}
      <h2 style="margin-top:16px">Spells known</h2>
      <div class="spell-list">
        ${knownSpellRows(hero, sheet, cls)}
      </div>
      <div class="two" style="margin-top:16px">
        <section>
          <h2>Add a spell</h2>
          <div class="spell-tools">
            <input id="spell-query" class="search" data-ui="spellQuery" placeholder="Search spells" value="${esc(state.spellQuery)}">
          </div>
          <div class="spell-filters">
            ${SPELL_FILTERS.map(([id, label]) => `<button class="ghost ${state.spellFilter === id ? "on" : ""}" data-act="spell-filter" data-filter="${id}">${label}</button>`).join("")}
            <select data-act="spell-type" aria-label="Damage type">${option("", "Any type", !state.spellType)}${SPELL_TYPES.map((type) => option(type, type, state.spellType === type)).join("")}</select>
          </div>
          <div class="spell-list scroll" data-scroll="spells">
            ${catalog.map((spell) => spellLine(spell, catalogAction(spell, known, cls))).join("") || `<p class="muted">No spells match.</p>`}
          </div>
        </section>
        <section>
          ${caster(hero, sheet)}
          ${hero.classId === "alchemist" ? formulae(hero, sheet) : ""}
        </section>
      </div>
    </article>`;
}

function catalogAction(spell, known, cls) {
  if (!known.has(spell.id)) return { action: "spell-add", label: "Add" };
  if (cls?.requiredSpell === spell.id) return { note: "Class spell" };
  return { action: "spell-forget", label: "Remove" };
}

function spellVisible(spell, known) {
  const query = state.spellQuery.trim().toLowerCase();
  if (query) {
    const hay = `${spell.name} ${spell.summary} ${spell.damage || ""}`.toLowerCase();
    if (!hay.includes(query)) return false;
  }
  if (state.spellFilter === "known" && !known.has(spell.id)) return false;
  if (state.spellFilter === "damage" && !spell.damage) return false;
  if (state.spellFilter === "plain" && spell.damage) return false;
  if (state.spellFilter === "object" && !spell.object) return false;
  if (state.spellType && spell.damage !== state.spellType) return false;
  if (state.spellFilter !== "known" && known.has(spell.id)) return false;
  return true;
}

function knownSpellRows(hero, sheet, cls) {
  const rows = [];
  const seen = new Set();
  for (const id of hero.spells || []) {
    const spell = spellById(id);
    if (!spell) continue;
    seen.add(id);
    const locked = cls?.requiredSpell === id;
    rows.push(spellLine(spell, locked
      ? { note: "Class spell" }
      : { action: "spell-forget", label: "Remove" }));
  }
  if (hero.elfSpell && !seen.has(hero.elfSpell)) {
    const spell = spellById(hero.elfSpell);
    if (spell) {
      seen.add(spell.id);
      rows.push(spellLine(spell, { note: "Naturally Attuned" }));
    }
  }
  for (const secret of sheet.secretSpells) {
    if (seen.has(secret.id)) continue;
    const spell = spellById(secret.id);
    if (!spell) continue;
    seen.add(secret.id);
    rows.push(spellLine(spell, { note: "Magical Secret" }));
  }
  return rows.join("") || `<p class="muted">No spells yet.</p>`;
}

function spellLine(spell, { note = "", action = "", label = "" } = {}) {
  const tags = [spell.damage, spell.object ? "Object" : ""].filter(Boolean);
  return `
    <div class="spell-row">
      <span class="spell-copy">
        <span class="spell-name"><strong>${esc(spell.name)}</strong>${note ? `<small class="muted">${esc(note)}</small>` : ""}</span>
        <small class="muted">${esc(spell.summary)}</small>
      </span>
      <span class="spell-tag">${tags.length ? esc(tags.join(" · ")) : "—"}</span>
      ${action ? `<button class="ghost" data-act="${action}" data-id="${spell.id}">${esc(label)}</button>` : `<span></span>`}
    </div>`;
}

function caster(hero, sheet) {
  const knownIds = sheet.knownSpells;
  const spellId = state.castSpell && knownIds.includes(state.castSpell) ? state.castSpell : knownIds[0] || "burn";
  const spell = spellById(spellId);
  const delivery = state.delivery || "remote";
  const dice = spell?.damage ? (state.dice ?? 1) : 0;
  const effect = state.effect !== false;
  const upcast = state.upcast || 0;
  const targets = state.targets || 1;
  const mana = castMana({ delivery, effect: effect && spell, dice, upcast, targets });
  const over = sheet.castMax && mana > sheet.castMax;
  return `
    <h2>Casting cost</h2>
    <p class="muted">Damage or an effect is free. Both together cost 1. Each damage die after the first costs 1. Then pay the delivery.</p>
    <div class="fields">
      <label class="field">Spell
        <select data-act="cast-spell">${SPELLS.map((entry) => option(entry.id, entry.name, entry.id === spellId)).join("")}</select>
      </label>
      <label class="field">Delivery
        <select data-act="cast-delivery">${DELIVERIES.map((entry) => option(entry.id, `${entry.name} (${entry.cost})`, entry.id === delivery)).join("")}</select>
      </label>
      <label class="field">Damage dice
        <input id="cast-dice" data-ui-num="dice" type="number" min="0" max="12" value="${dice}" ${spell?.damage ? "" : "disabled"}>
      </label>
      <label class="field">Delivery upcast
        <input id="cast-upcast" data-ui-num="upcast" type="number" min="0" value="${upcast}">
      </label>
      <label class="check"><input type="checkbox" data-act="cast-effect" ${effect ? "checked" : ""}> Include the effect</label>
      ${delivery === "remote" ? `<label class="field">Targets<input id="cast-targets" data-ui-num="targets" type="number" min="1" value="${targets}"></label>` : ""}
    </div>
    <div class="cast-out">
      <b>${mana} mana</b>
      <div>${esc(spell?.name || "Spell")} · ${esc(DELIVERIES.find((d) => d.id === delivery)?.name)} ${dice ? `· ${dice}d6 ${esc(spell?.damage || "")}` : ""} ${effect ? "· effect" : ""}</div>
      <small>${esc(DELIVERIES.find((d) => d.id === delivery)?.note || "")}</small>
      ${mana > sheet.castMax ? `<div>That is over the cast max of ${sheet.castMax}.</div>` : ""}
    </div>`;
}

function castMana({ delivery, effect, dice, upcast, targets }) {
  const info = DELIVERIES.find((entry) => entry.id === delivery) || DELIVERIES[0];
  let mana = info.cost + (Number(upcast) || 0);
  if (effect && dice > 0) mana += 1;
  if (dice > 0) mana += Math.max(0, dice - 1);
  if (delivery === "remote") mana += Math.max(0, (Number(targets) || 1) - 1);
  return mana;
}

function formulae(hero, sheet) {
  const known = new Set(hero.formulae || []);
  const cap = sheet.formulaCap;
  return `
    <h2 style="margin-top:16px">Formulae ${known.size} / ${sheet.formulaLimit}</h2>
    <p class="muted">Cap ${esc(formatMoney(cap))}. Crafting still wants 5s of materials and alchemy tools.</p>
    <div class="list-pick" data-scroll="formulae">
      ${ALCHEMY.filter((item) => item.value <= cap || known.has(item.id)).map((item) => `
        <label>
          <input type="checkbox" data-act="formula" data-id="${item.id}" ${known.has(item.id) ? "checked" : ""} ${item.value > cap ? "disabled" : ""}>
          <span><strong>${esc(item.name)}</strong><small class="muted">${esc(item.blurb || item.type)}</small></span>
          <span>${esc(formatMoney(item.value))}</span>
        </label>`).join("")}
    </div>`;
}
