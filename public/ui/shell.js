// The frame around the sheet: sidebar, tabs, the whole-table view, and the dice tray.

import { derive } from "../engine.js";
import { esc } from "../html.js";
import { canEdit, state } from "../state.js";
import { build } from "./build.js";
import { gear } from "./gear.js";
import { magic } from "./magic.js";
import { record } from "./record.js";

export function layout(hero, sheet) {
  return `
    <div class="app">
      <aside class="sidebar">
        <p class="kicker">Land of the Blind</p>
        <h1 class="brand">VAGA<span>BOND</span></h1>
        <p class="tagline">Hero record for the table.</p>
        ${state.username ? `<p class="signed-in">${esc(state.username)}</p>` : ""}
        <div class="side-actions">
          <button class="primary" data-act="new">New hero</button>
          <button class="ghost" data-act="party">${state.party ? "Back to sheet" : "Whole table"}</button>
        </div>
        <div class="hero-list">${state.heroes.map(card).join("") || `<p class="hint">No heroes yet.</p>`}</div>
        <div class="side-foot">
          <button class="ghost" data-act="export-all">Export party</button>
          <button class="ghost" data-act="import">Import</button>
          <input id="import-file" type="file" accept="application/json" hidden>
          <a class="ghost ${state.role === "admin" ? "" : "hidden"}" href="/admin">Approvals</a>
          <form method="post" action="/logout"><button class="ghost" type="submit">Sign out</button></form>
        </div>
        <p class="hint">You edit heroes linked to your account. Claim an unclaimed hero to make it yours. Coin is 1g = 100s = 1000c.</p>
      </aside>
      <main class="stage">
        <div class="toolbar no-print">
          <div class="tabs">
            ${["record", "build", "gear", "magic"].map((tab) =>
              `<button class="tab ${state.tab === tab && !state.party ? "on" : ""}" data-act="tab" data-tab="${tab}">${label(tab)}</button>`
            ).join("")}
          </div>
          <div class="row">
            ${heroActions(hero)}
            <div class="save-state">${esc(state.saving)}</div>
          </div>
        </div>
        ${state.error ? `<p class="banner">${esc(state.error)}</p>` : ""}
        ${!hero ? welcome() : state.party ? party() : view(hero, sheet)}
      </main>
    </div>
    ${tray()}
  `;
}

function label(tab) {
  return { record: "Record", build: "Build", gear: "Gear", magic: "Magic" }[tab];
}

function ownerTag(hero) {
  if (!hero.ownerId) return "Unclaimed";
  if (hero.ownerId === state.userId) return "Yours";
  return hero.ownerName || "Claimed";
}

function heroActions(hero) {
  if (!hero) return "";
  const claim = hero.ownerId ? "" : `<button class="primary" data-act="claim">Claim</button>`;
  const release = canEdit(hero) ? `<button class="ghost" data-act="release">Release</button>` : "";
  const remove = canEdit(hero) ? `<button class="ghost" data-act="delete">Delete</button>` : "";
  return `${claim}${release}<button class="ghost" data-act="duplicate">Duplicate</button>${remove}<button class="ghost" data-act="export-pdf">Export PDF</button><button class="ghost" data-act="export-one">Export JSON</button>`;
}

function ownershipNote(hero) {
  if (!hero.ownerId) return `<p class="ownership">This hero is unclaimed. Claim it to edit the sheet.</p>`;
  const name = hero.ownerName || "another player";
  return `<p class="ownership">Read-only. ${esc(name)} is the only one who can edit this hero.</p>`;
}

function card(hero) {
  const sheet = derive(hero);
  const hp = hero.hp == null ? sheet.effectiveMaxHp : hero.hp;
  const pct = sheet.effectiveMaxHp ? Math.max(0, Math.min(100, (hp / sheet.effectiveMaxHp) * 100)) : 0;
  const title = hero.name || "Unnamed hero";
  return `
    <button class="hero-card ${hero.id === state.id ? "on" : ""}" data-act="select" data-id="${hero.id}">
      <strong>${esc(title)}</strong>
      <small>${esc(sheet.ancestryName)} ${esc(sheet.className)} · L${sheet.level} · ${esc(ownerTag(hero))}</small>
      <div class="bar"><i style="width:${pct}%"></i></div>
    </button>`;
}

function welcome() {
  return `
    <section class="sheet welcome">
      <p class="kicker">Session zero</p>
      <h2>The road is empty.</h2>
      <p>This is a shared character manager for Vagabond. It builds a hero from the alpha 3 rules, then tracks the numbers you actually touch in play.</p>
      <ol class="steps">
        <li>Ancestry, class, and a stat array.</li>
        <li>Trainings, perks, and spells the class allows.</li>
        <li>A starting pack, or buy gear with the 3 gold you begin with.</li>
        <li>At the table: hit points, mana, luck, fatigue, and the dice.</li>
      </ol>
      <button class="primary" data-act="new">Record a hero</button>
    </section>`;
}

function view(hero, sheet) {
  let body = record(hero, sheet);
  if (state.tab === "build") body = build(hero, sheet);
  if (state.tab === "gear") body = gear(hero, sheet);
  if (state.tab === "magic") body = magic(hero, sheet);
  if (canEdit(hero)) return body;
  return `<div data-locked="1">${ownershipNote(hero)}${body}</div>`;
}

function party() {
  return `
    <section class="party">
      ${state.heroes.map((hero) => {
        const sheet = derive(hero);
        const hp = hero.hp == null ? sheet.effectiveMaxHp : hero.hp;
        const mana = hero.mana == null ? sheet.maxMana : hero.mana;
        const luck = hero.luck == null ? sheet.luckMax : hero.luck;
        return `
          <button class="party-card" data-act="open" data-id="${hero.id}">
            <p class="kicker">${esc(ownerTag(hero))}</p>
            <strong>${esc(hero.name || "Unnamed")}</strong>
            <div>${esc(sheet.ancestryName)} ${esc(sheet.className)} · L${sheet.level}</div>
            <div class="nums">
              <span>HP <b>${hp}</b><small>/${sheet.effectiveMaxHp}</small></span>
              <span>Mana <b>${mana}</b></span>
              <span>Luck <b>${luck}</b></span>
            </div>
            <small class="muted">${sheet.fatigue} fatigue · armor ${sheet.armorRating} · ${sheet.speed}'</small>
          </button>`;
      }).join("") || `<p>No one has walked in yet.</p>`}
    </section>`;
}

function rollStatus(entry) {
  if (!entry?.detail?.includes(" vs ")) return "";
  if (entry.crit) return "Crit";
  return entry.pass ? "Pass" : "Fail";
}

function tray() {
  const last = state.log[0];
  const line = last
    ? logLine(last)
    : `<span class="hint">${state.trayMin ? "Show the tray to roll." : "Tap a skill, save, or weapon."}</span>`;
  const status = rollStatus(last);
  const statusKlass = last?.crit ? "crit" : last?.pass ? "pass" : "fail";
  if (state.trayMin) {
    return `
      <footer class="tray is-min no-print">
        <button type="button" class="tray-toggle" data-act="tray" aria-expanded="false">
          <span class="tray-mark">Dice</span>
          <span class="tray-peek">${line}</span>
          ${status ? `<span class="tray-status ${statusKlass}">${status}</span>` : ""}
          <span class="tray-fold">Show</span>
        </button>
      </footer>`;
  }
  return `
    <footer class="tray no-print">
      <div class="tray-tools">
        <div class="favor-set" role="group" aria-label="Favor">
          ${[["Hinder", -1], ["Straight", 0], ["Favor", 1]].map(([name, value]) =>
            `<button type="button" class="ghost ${state.favor === value ? "on" : ""}" data-act="favor" data-value="${value}" aria-pressed="${state.favor === value}">${name}</button>`
          ).join("")}
        </div>
        <button type="button" class="ghost explode-toggle ${state.explode ? "on" : ""}" data-act="explode" aria-pressed="${state.explode}">Explode</button>
      </div>
      <div class="tray-dice">
        ${[4, 6, 8, 10, 12, 20].map((sides) => `<button type="button" class="ghost" data-act="die" data-sides="${sides}">d${sides}</button>`).join("")}
        <button type="button" class="ghost" data-act="d66">d66</button>
      </div>
      <div class="tray-foot">
        <div class="log">${line}</div>
        <button type="button" class="tray-fold" data-act="tray" aria-expanded="true">Hide</button>
      </div>
    </footer>`;
}

function logLine(entry) {
  const klass = entry.crit ? "crit" : entry.pass ? "pass" : "fail";
  return `<div class="${klass}"><strong>${esc(entry.title)}</strong> ${esc(entry.detail)}</div>`;
}
