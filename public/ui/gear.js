// The gear tab: the sack, starting packs, and the market.

import { CATALOG, GEAR, PACKS, PROP_NAMES } from "../data.js";
import { formatMoney, itemSlots } from "../engine.js";
import { esc, option, usesCounter, warnings } from "../html.js";
import { state } from "../state.js";

export function gear(hero, sheet) {
  const cats = ["All", "Weapons", "Armor", "Alchemy", ...new Set(GEAR.map((item) => item.category))];
  const query = state.gearQuery.toLowerCase();
  const items = CATALOG.filter((item) => {
    if (state.gearCat === "Weapons") return item.kind === "weapon";
    if (state.gearCat === "Armor") return item.kind === "armor";
    if (state.gearCat === "Alchemy") return item.kind === "alchemy";
    if (state.gearCat !== "All" && item.category !== state.gearCat) return false;
    if (!query) return true;
    return item.name.toLowerCase().includes(query);
  }).slice(0, 80);
  return `
    <article class="sheet">
      ${warnings(sheet)}
      <p class="kicker">Gear</p>
      <div class="row">
        <label class="field">Wealth
          <input id="wealth" data-field="wealth" data-render="1" value="${esc(formatMoney(hero.wealth))}">
        </label>
        <label class="field">Starting pack
          <select id="pack-select">${PACKS.map((pack) => `<option value="${pack.id}">${pack.name}</option>`).join("")}</select>
        </label>
        <button class="primary" data-act="apply-pack" style="align-self:end">Take this pack</button>
        <button class="ghost" data-act="roll-pack" style="align-self:end">Roll d66 pack</button>
      </div>
      <p class="muted">A pack replaces the sack and sets leftover coin. Every pack also includes a backpack, bedroll, 5 days of rations, 2 torches, and a waterskin. Carried ${sheet.slotUsed} / ${sheet.slotMax}. Equipped weapons ${sheet.weaponSlotUsed} / 3.</p>
      <div class="two">
        <section>
          <h2>Carried</h2>
          ${(hero.items || []).map((item) => invRow(item)).join("") || `<p class="muted">Empty hands, empty sack.</p>`}
          ${customForm(hero)}
        </section>
        <section>
          <h2>Market</h2>
          <div class="shop-tools">
            <input id="gear-query" class="search" data-ui="gearQuery" placeholder="Search" value="${esc(state.gearQuery)}">
            <select data-act="gear-cat">${cats.map((cat) => option(cat, cat, state.gearCat === cat)).join("")}</select>
            <label class="check"><input type="checkbox" data-act="loot" ${state.loot ? "checked" : ""}> Loot, don't pay</label>
          </div>
          <div class="list-pick" data-scroll="market">
            ${items.map((item) => `
              <button class="shop-item" data-act="buy" data-id="${item.id}">
                <span><strong>${esc(item.name)}</strong><small class="muted">${esc(item.kind)}${item.damage ? ` · ${esc(item.damage)}` : ""}${item.rating ? ` · armor ${item.rating}` : ""} · ${item.slots} slot${item.slots === 1 ? "" : "s"}</small></span>
                <span>${esc(formatMoney(item.value))}</span>
                <span>${state.loot || hero.wealth >= item.value ? "Add" : "Too dear"}</span>
              </button>`).join("")}
          </div>
        </section>
      </div>
    </article>`;
}

const WEAPON_SKILLS = [["melee", "Melee"], ["ranged", "Ranged"], ["finesse", "Finesse"], ["brawl", "Brawl"]];

function customForm(hero) {
  const item = (hero.items || []).find((entry) => entry.uid === state.editItem) || null;
  const kind = item?.kind || "gear";
  const grip = ["1h", "2h", "v"].includes(item?.grip) ? item.grip : "1h";
  const range = ["Close", "Near", "Far"].includes(item?.range) ? item.range : "Close";
  const types = item ? item.types || [] : ["melee"];
  const props = item?.props || [];
  return `
    <h2 style="margin-top:16px">${item ? `Editing ${esc(item.name)}` : "Custom piece"}</h2>
    <div class="fields custom-form">
      <label class="field">Name<input id="custom-name" placeholder="Silvered knife" value="${esc(item?.name || "")}"></label>
      <label class="field">Kind
        <select id="custom-kind">${option("gear", "Gear", kind === "gear")}${option("weapon", "Weapon", kind === "weapon")}${option("armor", "Armor", kind === "armor")}</select>
      </label>
      <label class="field">Slots<input id="custom-slots" type="number" min="0" value="${item ? item.slots ?? 1 : 1}"></label>
      <label class="field">Value<input id="custom-value" placeholder="10s" value="${item ? esc(formatMoney(item.value || 0)) : ""}"></label>
      <label class="field weapon-only">Damage<input id="custom-damage" placeholder="d6, 2d6, d8+1" value="${esc(item?.damage || "")}"></label>
      <label class="field weapon-only">Range
        <select id="custom-range">${["Close", "Near", "Far"].map((r) => option(r, r, range === r)).join("")}</select>
      </label>
      <label class="field weapon-only">Grip
        <select id="custom-grip">${option("1h", "One hand", grip === "1h")}${option("2h", "Two hands", grip === "2h")}${option("v", "Versatile", grip === "v")}</select>
      </label>
      <label class="field armor-only">Armor rating<input id="custom-rating" type="number" min="0" value="${item?.rating || 0}"></label>
      <div class="field wide weapon-only"><span>Attacks with</span>
        <div class="choices">${WEAPON_SKILLS.map(([id, name]) => `<label class="check"><input type="checkbox" class="custom-type" value="${id}" ${types.includes(id) ? "checked" : ""}> ${name}</label>`).join("")}</div>
      </div>
      <div class="field wide weapon-only"><span>Properties</span>
        <div class="choices">${Object.entries(PROP_NAMES).map(([id, name]) => `<label class="check"><input type="checkbox" class="custom-prop" value="${id}" ${props.includes(id) ? "checked" : ""}> ${name}</label>`).join("")}</div>
      </div>
      <label class="field">Shots or charges<input id="custom-uses" type="number" min="0" placeholder="None" value="${item?.usesMax || ""}"></label>
      <label class="field wide">Description and special effects
        <textarea id="custom-notes" class="notes" placeholder="Legendary. On a crit, the target is set ablaze…">${esc(item?.notes || "")}</textarea>
      </label>
    </div>
    <div class="row" style="margin-top:8px">
      <button class="ghost" data-act="custom-item">${item ? "Save changes" : "Add to the sack"}</button>
      ${item ? `<button class="ghost" data-act="edit-cancel">Cancel</button>` : ""}
      <span id="custom-error" class="custom-error" role="alert"></span>
    </div>`;
}

function invRow(item) {
  const worn = item.kind === "armor" || item.capacity ? "Wear" : item.kind === "weapon" ? "Wield" : "Hold";
  return `
    <div class="inv-item">
      <span>
        <strong>${esc(item.name)}</strong>
        <small class="muted">${itemSlots(item)} slot${itemSlots(item) === 1 ? "" : "s"} · ${esc(formatMoney(item.value))} each${item.equipped ? " · equipped" : ""}</small>
        ${item.notes ? `<small class="item-notes">${esc(item.notes)}</small>` : ""}
        ${item.grip === "v" ? `<button class="ghost" data-act="grip" data-uid="${item.uid}">${item.gripMode === "2h" ? "Two hands" : "One hand"}</button>` : ""}
        ${usesCounter(item)}
      </span>
      <span class="stepper">
        <button class="icon" data-act="qty" data-uid="${item.uid}" data-delta="-1">−</button>
        <span>${item.qty || 1}</span>
        <button class="icon" data-act="qty" data-uid="${item.uid}" data-delta="1">+</button>
      </span>
      <span class="row">
        ${item.kind === "weapon" || item.kind === "armor" || item.capacity ? `<button class="ghost" data-act="equip" data-uid="${item.uid}">${item.equipped ? "Stow" : worn}</button>` : ""}
        <button class="ghost" data-act="edit-item" data-uid="${item.uid}">Edit</button>
        <button class="ghost" data-act="sell" data-uid="${item.uid}">Sell</button>
        <button class="danger" data-act="drop" data-uid="${item.uid}">Drop</button>
      </span>
    </div>`;
}
