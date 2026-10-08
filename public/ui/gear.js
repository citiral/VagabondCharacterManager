// The gear tab: the sack, starting packs, and the market.

import { CATALOG, GEAR, PACKS } from "../data.js";
import { formatMoney, itemSlots } from "../engine.js";
import { esc, option, warnings } from "../html.js";
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
          <h2 style="margin-top:16px">Custom piece</h2>
          <div class="fields">
            <label class="field">Name<input id="custom-name" placeholder="Silvered knife"></label>
            <label class="field">Kind
              <select id="custom-kind"><option value="gear">Gear</option><option value="weapon">Weapon</option><option value="armor">Armor</option></select>
            </label>
            <label class="field">Slots<input id="custom-slots" type="number" min="0" value="1"></label>
            <label class="field">Value<input id="custom-value" placeholder="10s"></label>
            <label class="field wide">If it's a weapon: damage, range, grip
              <input id="custom-weapon" placeholder="d6, Close, 1h">
            </label>
          </div>
          <button class="ghost" data-act="custom">Add to the sack</button>
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

function invRow(item) {
  const worn = item.kind === "armor" || item.capacity ? "Wear" : item.kind === "weapon" ? "Wield" : "Hold";
  return `
    <div class="inv-item">
      <span>
        <strong>${esc(item.name)}</strong>
        <small class="muted">${itemSlots(item)} slot${itemSlots(item) === 1 ? "" : "s"} · ${esc(formatMoney(item.value))} each${item.equipped ? " · equipped" : ""}</small>
        ${item.grip === "v" ? `<button class="ghost" data-act="grip" data-uid="${item.uid}">${item.gripMode === "2h" ? "Two hands" : "One hand"}</button>` : ""}
      </span>
      <span class="stepper">
        <button class="icon" data-act="qty" data-uid="${item.uid}" data-delta="-1">−</button>
        <span>${item.qty || 1}</span>
        <button class="icon" data-act="qty" data-uid="${item.uid}" data-delta="1">+</button>
      </span>
      <span class="row">
        ${item.kind === "weapon" || item.kind === "armor" || item.capacity ? `<button class="ghost" data-act="equip" data-uid="${item.uid}">${item.equipped ? "Stow" : worn}</button>` : ""}
        <button class="ghost" data-act="sell" data-uid="${item.uid}">Sell</button>
        <button class="danger" data-act="drop" data-uid="${item.uid}">Drop</button>
      </span>
    </div>`;
}
