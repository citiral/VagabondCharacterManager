// The build tab: ancestry, class, stats, trainings, and perks.

import { ANCESTRIES, CLASSES, PERKS, SPELLS, STATS, STAT_ARRAYS } from "../data.js";
import { classById, perkAllowed, perkById } from "../engine.js";
import { esc, option, skillName, warnings } from "../html.js";

export function build(hero, sheet) {
  const budget = sheet.trainingBudget;
  const chosen = [...sheet.chosenTrainings];
  while (chosen.length < Math.max(budget, chosen.length)) chosen.push("");
  const rows = Math.max(budget, chosen.length);
  return `
    <article class="sheet">
      ${warnings(sheet)}
      <p class="kicker">Build</p>
      <h2>Ancestry and class</h2>
      <div class="fields">
        <label class="field">Ancestry
          <select data-act="ancestry">${option("", "Choose", !hero.ancestry)}${ANCESTRIES.map((a) => option(a.id, `${a.name} · ${a.type}, ${a.size}`, hero.ancestry === a.id)).join("")}</select>
        </label>
        <label class="field">Class
          <select data-act="class">${option("", hero.level === 0 ? "None until 1st level" : "Choose", !hero.classId)}${CLASSES.map((c) => option(c.id, c.name, hero.classId === c.id)).join("")}</select>
        </label>
        <div class="field"><span>Roll</span><div class="row"><button class="ghost" data-act="roll-ancestry">d66 ancestry</button><button class="ghost" data-act="roll-class">d66 class</button><button class="ghost" data-act="roll-array">d8 array</button></div></div>
        <label class="field">Level
          <input id="build-level" data-field="level" data-render="1" type="number" min="0" value="${hero.level}">
        </label>
      </div>
      ${hero.ancestry === "draken" ? `<label class="field" style="margin-top:8px">Half damage from
        <select data-act="draken">${["acid", "cold", "fire", "shock"].map((id) => option(id, id[0].toUpperCase() + id.slice(1), hero.drakenWard === id)).join("")}</select>
      </label>` : ""}
      ${classById(hero.classId) ? `<p class="muted">${esc(classById(hero.classId).role)} Key stat: ${esc(classById(hero.classId).key)}. Complexity ${"●".repeat(classById(hero.classId).complexity)}${"○".repeat(5 - classById(hero.classId).complexity)}.</p>` : ""}
      <h2 style="margin-top:16px">Stats</h2>
      <div class="choices" style="margin-bottom:8px">
        ${STAT_ARRAYS.map((array, index) => `<button class="ghost ${!hero.customStats && hero.statArray === index ? "on" : ""}" data-act="array" data-index="${index}">${array.join(" · ")}</button>`).join("")}
        <button class="ghost ${hero.customStats ? "on" : ""}" data-act="custom">Custom scores</button>
      </div>
      <p class="muted">Stat increases spent ${sheet.spentRaises} / ${sheet.expectedRaises}. Human potential, even levels, and Advancement live in the + buttons. Scores cap at 7.</p>
      <div class="stats">
        ${STATS.map((stat) => statEditor(hero, stat, sheet)).join("")}
      </div>
      <h2 style="margin-top:16px">Training</h2>
      <p class="muted">Class and ancestry trainings are locked. You have ${budget} more, from half Reason (rounded up)${hero.ancestry === "human" ? ", the human knack," : ""}${sheet.slots ? "" : ""} plus New Training.</p>
      <div class="chips" style="justify-content:flex-start;margin-bottom:8px">
        ${sheet.automaticTrainings.map((id) => `<span class="chip">◆ ${esc(skillName(id))}</span>`).join("") || `<span class="chip">No locked trainings yet</span>`}
      </div>
      ${Array.from({ length: rows }, (_, index) => trainingSelect(hero, index, chosen[index] || "")).join("")}
      ${hero.ancestry === "elf" ? `<label class="field" style="margin-top:8px">Elven skill, besides Detect
        <select data-act="elf-skill">${option("", "Choose", !hero.elfSkill)}${skillOptions(hero, hero.elfSkill, true)}</select>
      </label>` : ""}
      <h2 style="margin-top:16px">Perks</h2>
      ${sheet.grants.map((grant) => `<div class="feature"><strong>${esc(perkById(grant.id)?.name)}</strong> <small>granted by ${esc(grant.source)}</small><div>${esc(perkById(grant.id)?.summary || "")}</div></div>`).join("")}
      ${sheet.slots.map((slot) => perkSelect(hero, slot)).join("") || `<p class="muted">No perk choices at this level.</p>`}
      <p class="muted">A class feature that hands you a specific perk ignores prerequisites. Fighting Style, Survivalist, Occultist, Well-Versed, and the human knack are the choices above.</p>
    </article>`;
}

function skillOptions(hero, currentId, elf) {
  const blocked = new Set(elf ? ["detect", ...((classById(hero.classId)?.trainings) || [])] : []);
  return ["melee", "brawl", "finesse", "sneak", "detect", "mysticism", "survival", "ranged", "arcana", "craft", "medicine", "influence", "leadership", "performance"]
    .filter((id) => id === currentId || !blocked.has(id))
    .map((id) => option(id, skillName(id), id === currentId))
    .join("");
}

function trainingSelect(hero, index, value) {
  const taken = new Set([...(hero.trainings || []), hero.elfSkill, ...((classById(hero.classId)?.trainings) || [])]);
  if (hero.ancestry === "elf") taken.add("detect");
  const options = ["melee", "brawl", "finesse", "sneak", "detect", "mysticism", "survival", "ranged", "arcana", "craft", "medicine", "influence", "leadership", "performance"]
    .filter((id) => id === value || !taken.has(id) || id === value)
    .map((id) => option(id, skillName(id), id === value))
    .join("");
  return `<label class="train-slot"><span>Training ${index + 1}</span><select data-act="training" data-index="${index}">${option("", "—", !value)}${options}</select></label>`;
}

function statEditor(hero, stat, sheet) {
  const score = sheet.scores[stat.id];
  const pool = STAT_ARRAYS[hero.statArray ?? 0];
  const choices = hero.customStats
    ? [2, 3, 4, 5, 6, 7].map((n) => option(String(n), String(n), hero.base[stat.id] === n)).join("")
    : [...new Set(pool)].map((n) => option(String(n), String(n), hero.base[stat.id] === n)).join("");
  const canPlus = score < 7 && (hero.customStats || sheet.spentRaises < sheet.expectedRaises);
  return `
    <div class="stat">
      <span class="abbr">${stat.abbr}</span>
      <b>${score}</b>
      <select data-act="base" data-stat="${stat.id}">${choices}</select>
      <div class="stepper">
        <button class="icon" data-act="raise" data-stat="${stat.id}" data-delta="-1" ${(hero.raises[stat.id] || 0) <= 0 ? "disabled" : ""}>−</button>
        <small>+${hero.raises[stat.id] || 0}</small>
        <button class="icon" data-act="raise" data-stat="${stat.id}" data-delta="1" ${canPlus ? "" : "disabled"}>+</button>
      </div>
    </div>`;
}

function perkSelect(hero, slot) {
  const currentId = hero.perkChoices[slot.key] || "";
  const perks = PERKS.filter((perk) => perk.id === currentId || perkAllowed(hero, perk, slot.mode, slot.key));
  const secret = currentId === "magical-secret"
    ? `<select data-act="secret" data-slot="${esc(slot.key)}">${option("", "Spell gained", !hero.magicalSecrets[slot.key])}${SPELLS.map((spell) => option(spell.id, spell.name, hero.magicalSecrets[slot.key] === spell.id)).join("")}</select>`
    : "";
  return `
    <div class="perk-slot">
      <span>${esc(slot.label)}</span>
      <div>
        <select data-act="perk" data-slot="${esc(slot.key)}">${option("", "Choose a perk", !currentId)}${perks.map((perk) => option(perk.id, perk.name, perk.id === currentId)).join("")}</select>
        <small class="muted">${esc(perkById(currentId)?.summary || slotHint(slot.mode))}</small>
        ${secret}
      </div>
    </div>`;
}

function slotHint(mode) {
  if (mode === "fighter") return "Needs a Melee or Ranged training prerequisite. Other requirements are waived.";
  if (mode === "hunter") return "Needs a Survival training prerequisite. Other requirements are waived.";
  if (mode === "witch") return "Needs a Mysticism training prerequisite. Other requirements are waived.";
  if (mode === "bard") return "Stat minimums are waived.";
  return "Prerequisites apply.";
}
