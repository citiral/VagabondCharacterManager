// The magic tab: spells known, casting, and alchemist formulae.

import { ALCHEMY, DELIVERIES, SPELLS } from "../data.js";
import { castCost, castPayment, castSkillFor, classById, formatMoney, spellById, spellDice } from "../engine.js";
import { esc, option, skillName, warnings } from "../html.js";
import { canEdit, state } from "../state.js";

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
  const settings = castSettings(hero, sheet);
  const mana = hero.mana == null ? sheet.maxMana : hero.mana;
  return `
    <article class="sheet">
      ${warnings(sheet)}
      <p class="kicker">Magic</p>
      <div class="chips" style="justify-content:flex-start;align-items:center">
        <span class="chip mana-chip">
          <button class="icon" data-act="pool" data-key="mana" data-delta="-1" aria-label="Spend 1 mana">−</button>
          Mana <b>${mana}</b> / ${sheet.maxMana}
          <button class="icon" data-act="pool" data-key="mana" data-delta="1" aria-label="Regain 1 mana">+</button>
        </span>
        <span class="chip">Cast max ${sheet.castMax}</span>
        ${sheet.tapped ? `<span class="chip">Tapped ${sheet.tapped} max HP until rest</span>` : ""}
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
      <div class="two" style="margin-top:16px">
        <section>
          <h2>Spells known</h2>
          <div class="spell-list">
            ${knownSpellRows(hero, sheet, cls, settings.spell?.id)}
          </div>
        </section>
        <section>
          ${caster(hero, sheet, settings)}
        </section>
      </div>
      <div class="${hero.classId === "alchemist" ? "two" : ""}" style="margin-top:16px">
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
        ${hero.classId === "alchemist" ? `<section>${formulae(hero, sheet)}</section>` : ""}
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

function knownSpellRows(hero, sheet, cls, selected) {
  const rows = [];
  const seen = new Set();
  const cast = (spell, extra = []) => [{ action: "cast-pick", label: "Cast", on: spell.id === selected }, ...extra];
  for (const id of hero.spells || []) {
    const spell = spellById(id);
    if (!spell) continue;
    seen.add(id);
    const locked = cls?.requiredSpell === id;
    rows.push(spellLine(spell, locked
      ? { note: "Class spell", buttons: cast(spell) }
      : { buttons: cast(spell, [{ action: "spell-forget", label: "Remove" }]) }));
  }
  if (hero.elfSpell && !seen.has(hero.elfSpell)) {
    const spell = spellById(hero.elfSpell);
    if (spell) {
      seen.add(spell.id);
      rows.push(spellLine(spell, { note: "Naturally Attuned", buttons: cast(spell) }));
    }
  }
  for (const secret of sheet.secretSpells) {
    if (seen.has(secret.id)) continue;
    const spell = spellById(secret.id);
    if (!spell) continue;
    seen.add(secret.id);
    rows.push(spellLine(spell, { note: "Magical Secret", buttons: cast(spell) }));
  }
  return rows.join("") || `<p class="muted">No spells yet.</p>`;
}

function spellLine(spell, { note = "", action = "", label = "", buttons = [] } = {}) {
  const tags = [spell.damage, spell.heal ? "Healing" : "", spell.object ? "Object" : ""].filter(Boolean);
  if (action) buttons = [{ action, label }];
  return `
    <div class="spell-row ${buttons.some((button) => button.on) ? "on" : ""}">
      <span class="spell-copy">
        <span class="spell-name"><strong>${esc(spell.name)}</strong>${note ? `<small class="muted">${esc(note)}</small>` : ""}</span>
        <small class="muted">${esc(spell.summary)}</small>
      </span>
      <span class="spell-tag">${tags.length ? esc(tags.join(" · ")) : "—"}</span>
      <span class="spell-buttons">${buttons.map((button) => `<button class="${button.on ? "primary" : "ghost"}" data-act="${button.action}" data-id="${spell.id}">${esc(button.label)}</button>`).join("")}</span>
    </div>`;
}

// The casting panel's choices, read from UI state. actions.js casts with the same settings.
export function castSettings(hero, sheet) {
  const knownIds = sheet.knownSpells;
  const spellId = spellById(state.castSpell) ? state.castSpell : knownIds[0] || "";
  const spell = spellById(spellId);
  const rolls = !!(spell?.damage || spell?.heal);
  const opts = {
    delivery: state.delivery || "remote",
    dice: rolls ? Math.max(0, Math.trunc(state.dice ?? (spell.heal ? 0 : 1))) : 0,
    effect: state.effect !== false,
    upcast: Math.max(0, Math.trunc(state.upcast || 0)),
    targets: Math.max(1, Math.trunc(state.targets || 1)),
    attuned: state.attuned !== false,
  };
  const cost = castCost(hero, spell, opts);
  return {
    spell,
    known: knownIds.includes(spellId),
    opts,
    cost,
    skill: spell ? castSkillFor(hero, sheet, spell.id) : null,
    dice: spellDice(hero, spell, opts.dice),
    check: state.castCheck !== false,
    over: cost.mana > sheet.castMax,
    pay: castPayment(hero, sheet, cost.mana),
  };
}

function caster(hero, sheet, settings) {
  const { spell, opts, cost, skill, dice, check, over, pay } = settings;
  const knownIds = sheet.knownSpells;
  const others = SPELLS.filter((entry) => !knownIds.includes(entry.id));
  const spellOptions = `
    ${knownIds.length ? `<optgroup label="Known">${knownIds.map((id) => option(id, spellById(id)?.name || id, id === spell?.id)).join("")}</optgroup>` : option("", "Choose a spell", !spell)}
    <optgroup label="Other spells">${others.map((entry) => option(entry.id, entry.name, entry.id === spell?.id)).join("")}</optgroup>`;
  const attunedSpell = hero.ancestry === "elf" && spell && hero.elfSpell === spell.id;
  const editable = canEdit(hero);
  let blocked = "";
  if (!spell) blocked = "Pick a spell to cast.";
  else if (over) blocked = `That is over the cast max of ${sheet.castMax}.`;
  else if (editable && !pay.ok) blocked = `Not enough mana: ${pay.pool} left.`;
  const price = pay.fromHp ? `${pay.fromMana} mana + ${pay.fromHp} HP` : `${cost.mana} mana`;
  const diceText = dice ? `${dice.expr} ${dice.kind}${dice.explodeOn.length ? `, explodes on ${dice.explodeOn.join(" and ")}` : ""}` : "";
  return `
    <h2>Cast a spell</h2>
    <p class="muted">Damage or an effect is free. Both together cost 1. Each damage die after the first costs 1. Then pay the delivery.</p>
    <div class="fields">
      <label class="field">Spell
        <select data-act="cast-spell">${spellOptions}</select>
      </label>
      <label class="field">Delivery
        <select data-act="cast-delivery">${DELIVERIES.map((entry) => option(entry.id, `${entry.name} (${entry.cost})`, entry.id === opts.delivery)).join("")}</select>
      </label>
      <label class="field">${spell?.heal ? "Healing dice" : "Damage dice"}
        <input id="cast-dice" data-ui-num="dice" type="number" min="0" max="12" value="${opts.dice}" ${spell?.damage || spell?.heal ? "" : "disabled"}>
      </label>
      <label class="field">Delivery upcast
        <input id="cast-upcast" data-ui-num="upcast" type="number" min="0" value="${opts.upcast}">
      </label>
      ${opts.delivery === "remote" ? `<label class="field">Targets<input id="cast-targets" data-ui-num="targets" type="number" min="1" value="${opts.targets}"></label>` : ""}
      <label class="check"><input type="checkbox" data-act="cast-effect" ${opts.effect ? "checked" : ""}> Include the effect</label>
      <label class="check"><input type="checkbox" data-act="cast-check" ${check ? "checked" : ""}> Roll a cast check</label>
      ${attunedSpell ? `<label class="check"><input type="checkbox" data-act="cast-attuned" ${opts.attuned ? "checked" : ""}> Naturally Attuned discount (once a round)</label>` : ""}
    </div>
    <div class="cast-out">
      <b>${cost.mana} mana</b>
      <div>${esc(spell?.name || "Spell")} · ${esc(cost.delivery.name)}${diceText ? ` · ${esc(diceText)}` : ""}${opts.effect ? " · effect" : ""}</div>
      <small>${esc(cost.parts.map((part) => `${part.label} ${part.mana < 0 ? "−" : "+"}${Math.abs(part.mana)}`).join(" · "))}</small>
      <small>${esc(cost.delivery.note || "")}</small>
      ${check && skill ? `<div>Cast check: ${esc(skill.name)} ${skill.dc}${sheet.castCrit < 20 ? `, crit on ${sheet.castCrit}+` : ""}</div>` : ""}
      ${pay.fromHp ? `<div>Tap: ${pay.fromHp} HP pays the rest, and max HP drops by as much until rest.</div>` : ""}
      ${blocked ? `<div>${esc(blocked)}</div>` : ""}
      <div class="row cast-actions">
        <button class="primary" data-act="cast" ${blocked ? "disabled" : ""}>Cast · ${esc(price)}</button>
        ${dice ? `<button class="ghost" data-act="cast-roll">Roll ${esc(dice.expr)} only</button>` : ""}
      </div>
      ${spell && !settings.known ? `<small>${esc(spell.name)} isn't on this hero's spell list.</small>` : ""}
    </div>`;
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
