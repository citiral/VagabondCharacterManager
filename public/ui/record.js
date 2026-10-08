// The record tab: vitals, skills, weapons, and experience at the table.

import { PACES, STATS, STATUSES } from "../data.js";
import { attackProfile } from "../dice.js";
import { perkById, weaponDamage, xpToLevel } from "../engine.js";
import { esc, warnings } from "../html.js";
import { QUESTIONS, state } from "../state.js";

export function record(hero, sheet) {
  const hp = hero.hp == null ? sheet.effectiveMaxHp : hero.hp;
  const mana = hero.mana == null ? sheet.maxMana : hero.mana;
  const luck = hero.luck == null ? sheet.luckMax : hero.luck;
  const cost = xpToLevel(hero.level, hero.pace);
  return `
    <article class="sheet">
      ${warnings(sheet)}
      <header class="mast">
        <div>
          <p class="kicker">Hero record</p>
          <input id="hero-name" class="name-input" data-field="name" data-render="1" placeholder="What are they called?" value="${esc(hero.name)}">
          <div class="identity">
            <input id="hero-concept" data-field="concept" placeholder="A line of concept" value="${esc(hero.concept)}">
          </div>
        </div>
        <div class="meta">
          <div class="lvl">Lv ${sheet.level}</div>
          <div>${esc(sheet.ancestryName)} ${esc(sheet.className)}</div>
          <div class="chips">
            <span class="chip">${esc(sheet.beingType)}</span>
            <span class="chip">${esc(sheet.size)}</span>
            ${sheet.tags.map((tag) => `<span class="chip">${esc(tag)}</span>`).join("")}
          </div>
        </div>
      </header>
      <div class="stats">
        ${STATS.map((stat) => `
          <div class="stat">
            <span class="abbr">${stat.abbr}</span>
            <b>${sheet.scores[stat.id]}</b>
            <small>${esc(stat.name)}</small>
          </div>`).join("")}
      </div>
      <div class="saves">
        ${saveButton("Endure", sheet.endure, "Might × 2", "endure")}
        ${saveButton("Reflex", sheet.reflex, sheet.armorPenalty ? `+${sheet.armorPenalty} armor` : "Dexterity + Awareness", "reflex")}
        ${saveButton("Will", sheet.will, "Reason + Presence", "will")}
      </div>
      <div class="vitals">
        ${vital("hp", "Hit points", hp, sheet.effectiveMaxHp, "hp")}
        ${vital("mana", "Mana", mana, sheet.maxMana, "mana")}
        ${vital("luck", "Luck", luck, sheet.luckMax, "luck")}
        <div class="vital"><span>Fatigue</span><b>${sheet.fatigue}</b><div class="stepper"><button class="icon" data-act="delta" data-key="fatigue" data-delta="-1">−</button><button class="icon" data-act="delta" data-key="fatigue" data-delta="1">+</button></div></div>
        <div class="vital"><span>Armor</span><b>${sheet.armorRating}</b><small>${sheet.restrained ? "Restrained" : sheet.wornArmor ? esc(sheet.wornArmor.name) : "Unarmored"}</small></div>
        <div class="vital"><span>Speed</span><b>${sheet.speed}'</b><small>Crawl ${sheet.crawl}' · ${sheet.travel} mi</small></div>
      </div>
      <div class="row no-print" style="margin-top:10px">
        <button class="primary" data-act="rest">Rest</button>
        <button class="ghost" data-act="breather" ${hero.breatherUsed ? "disabled" : ""}>Breather ${hero.breatherUsed ? "used" : `(+${sheet.scores.might} HP)`}</button>
        <button class="ghost" data-act="new-shift">New shift</button>
        <span class="muted">Slots ${sheet.slotUsed}/${sheet.slotMax} · Weapons ${sheet.weaponSlotUsed}/3 · Studied</span>
        <button class="icon" data-act="delta" data-key="studied" data-delta="-1">−</button>
        <strong>${hero.studied || 0}</strong>
        <button class="icon" data-act="delta" data-key="studied" data-delta="1">+</button>
      </div>
      <div class="split">
        <section>
          <h2>Skills</h2>
          ${sheet.skills.map((skill) => `
            <button class="skill" data-act="roll-skill" data-skill="${skill.id}">
              <span class="who"><strong class="${skill.trained ? "trained" : ""}">${skill.trained ? "◆ " : ""}${esc(skill.name)}</strong><small>${esc(skill.blurb)}${skill.source ? ` · ${esc(skill.source)}` : ""}</small></span>
              <span class="dc">${skill.dc}</span>
              <span class="muted">${skill.trained ? "Trained" : "Untrained"}</span>
            </button>`).join("")}
        </section>
        <section>
          <h2>Weapons</h2>
          ${unarmedRow(hero, sheet)}
          ${sheet.weapons.map((item) => weaponRow(hero, item, sheet)).join("") || `<p class="muted">Nothing in hand besides unarmed.</p>`}
          <h2 style="margin-top:16px">Conditions</h2>
          <div class="choices">
            ${STATUSES.map((name) => `<button class="cond ${hero.conditions.includes(name) ? "on" : ""}" data-act="condition" data-name="${esc(name)}">${esc(name)}</button>`).join("")}
          </div>
          <h2 style="margin-top:16px">Features</h2>
          ${sheet.grants.map((grant) => {
            const perk = perkById(grant.id);
            return `<div class="feature"><strong>${esc(perk?.name || grant.id)}</strong> <small>${esc(grant.source)}, granted</small><div>${esc(perk?.summary || "")}</div></div>`;
          }).join("")}
          ${sheet.features.map((feature) => `<div class="feature"><strong>${esc(feature.name)}</strong> <small>${esc(feature.source)}</small><div>${esc(feature.text)}</div></div>`).join("")}
          ${sheet.nextFeature ? `<p class="muted">Next, at level ${sheet.nextFeature.level}: ${esc(sheet.nextFeature.name)}. ${esc(sheet.nextFeature.text)}</p>` : ""}
          ${sheet.attackCrit < 20 ? `<p class="muted">Attack crits on a natural ${sheet.attackCrit} or higher.</p>` : ""}
          ${sheet.castCrit < 20 ? `<p class="muted">Cast checks crit on a natural ${sheet.castCrit} or higher.</p>` : ""}
        </section>
      </div>
      <h2 style="margin-top:16px">Notes</h2>
      <textarea id="hero-notes" class="notes" data-field="notes" placeholder="Scars, oaths, the name of the horse…">${esc(hero.notes)}</textarea>
      <section class="no-print" style="margin-top:16px">
        <h2>Experience</h2>
        <div class="row">
          <label class="field">Pace
            <select data-act="pace">${PACES.map((pace) => `<option value="${pace.id}" ${hero.pace === pace.id ? "selected" : ""}>${esc(pace.name)} — ${esc(pace.detail)}</option>`).join("")}</select>
          </label>
          <label class="field">XP toward next level
            <input id="hero-xp" data-field="xp" data-render="1" type="number" min="0" value="${hero.xp}">
          </label>
          <label class="field">Level
            <input id="hero-level" data-field="level" data-render="1" type="number" min="0" value="${hero.level}">
          </label>
        </div>
        <p class="muted">${hero.xp} / ${cost} XP to level ${hero.level + 1}. Even levels also grant a stat increase. You take a perk at creation, then again at every odd level from 3rd.</p>
        <div class="row">
          <button class="primary" data-act="level-up" ${hero.xp < cost ? "disabled" : ""}>Spend XP and level up</button>
          <button class="ghost" data-act="destiny">Destiny level up</button>
        </div>
        <h2 style="margin-top:14px">End of session</h2>
        ${QUESTIONS.map((q, i) => `<label class="check"><input type="checkbox" data-act="question" data-i="${i}" ${state.qs[i] ? "checked" : ""}> ${esc(q)}</label>`).join("")}
        <button class="ghost" data-act="award">Award ${state.qs.filter(Boolean).length} XP to your heroes</button>
      </section>
    </article>`;
}

function saveButton(name, dc, note, id) {
  return `<button class="save" data-act="roll-save" data-save="${id}"><span>${name}</span><b>${dc}</b><small>${esc(note)}</small></button>`;
}

function vital(kind, name, value, max, field) {
  return `
    <div class="vital ${kind}">
      <span>${name}</span>
      <div class="stepper">
        <button class="icon" data-act="pool" data-key="${field}" data-delta="-1">−</button>
        <input id="pool-${field}" data-field="${field}" data-render="1" type="number" min="0" value="${value}">
        <button class="icon" data-act="pool" data-key="${field}" data-delta="1">+</button>
      </div>
      <small>of ${max}</small>
    </div>`;
}

function unarmedRow(hero, sheet) {
  const item = { name: "Unarmed", types: ["brawl", "finesse"], props: ["grapple"], damage: "1", range: "Close", grip: "1h", slots: 0, kind: "weapon" };
  const profile = attackProfile(hero, item, sheet);
  return `
    <button class="weapon" data-act="roll-unarmed">
      <span class="who"><strong>Unarmed</strong><small>${profile.skill ? esc(profile.skill.name) : "Brawl"} · 1 damage · Grapple</small></span>
      <span class="dc">${profile.skill ? profile.skill.dc : "—"}</span>
      <span class="muted">Always</span>
    </button>`;
}

function weaponRow(hero, item, sheet) {
  const profile = attackProfile(hero, item, sheet);
  const props = (item.props || []).map((id) => id[0].toUpperCase() + id.slice(1)).join(", ");
  return `
    <button class="weapon" data-act="roll-weapon" data-uid="${item.uid}">
      <span class="who"><strong>${esc(item.name)}</strong><small>${esc(weaponDamage(item))} · ${esc(item.range)} · ${esc(props || "no properties")}${profile.trained ? "" : " · properties asleep until trained"}</small></span>
      <span class="dc">${profile.skill ? profile.skill.dc : "—"}</span>
      <span class="muted">${profile.skill ? esc(profile.skill.name) : ""}</span>
    </button>`;
}
