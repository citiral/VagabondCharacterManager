// Catalog rows become items in the sack. Slot cost and weapon damage live here.

import { PACKS } from "../data.js";
import { catalogById } from "./model.js";

export function itemSlots(item) {
  if (!item) return 0;
  if (item.equipped && item.zeroWhenWorn) return 0;
  const size = item.slots ?? item.slotSize ?? 1;
  const qty = item.qty || 1;
  if (size === 0) return qty > 0 ? Math.ceil(qty / 10) : 0;
  return size * qty;
}

function stepDie(die, steps) {
  const ladder = ["d4", "d6", "d8", "d10", "d12"];
  const index = ladder.indexOf(die);
  if (index < 0) return die;
  const next = index + steps;
  if (next < ladder.length) return ladder[next];
  return `d12+${next - (ladder.length - 1)}`;
}

export function weaponDamage(item) {
  let die = item.damage || "d4";
  if (item.grip === "v" && item.gripMode === "2h" && die !== "1") die = stepDie(die, 1);
  return die;
}

export function instantiate(entry, qty = 1) {
  return {
    uid: crypto.randomUUID(),
    catalogId: entry.id,
    name: entry.name,
    kind: entry.kind,
    qty: entry.kind === "weapon" || entry.kind === "armor" ? 1 : qty,
    slots: entry.slots ?? 1,
    value: entry.value ?? 0,
    equipped: false,
    types: entry.types ? [...entry.types] : [],
    props: entry.props ? [...entry.props] : [],
    range: entry.range || "",
    grip: entry.grip || "",
    gripMode: entry.grip === "2h" ? "2h" : "1h",
    damage: entry.damage || "",
    rating: entry.rating || 0,
    might: entry.might || 0,
    capacity: entry.capacity || 0,
    zeroWhenWorn: !!entry.zeroWhenWorn,
    blurb: entry.blurb || entry.type || "",
    type: entry.type || "",
  };
}

export function addCatalog(hero, catalogId, qty = 1) {
  const entry = catalogById(catalogId);
  if (!entry) return;
  if (entry.kind === "weapon" || entry.kind === "armor") {
    for (let i = 0; i < qty; i++) hero.items.push(instantiate(entry, 1));
    return;
  }
  if (entry.stack) {
    const existing = hero.items.find((item) => item.catalogId === catalogId);
    if (existing) {
      existing.qty += qty;
      return;
    }
  }
  hero.items.push(instantiate(entry, qty));
}

export function applyPack(hero, packId) {
  const pack = PACKS.find((p) => p.id === packId);
  if (!pack) return;
  hero.items = [];
  hero.wealth = pack.wealth;
  for (const [id, qty] of pack.items) addCatalog(hero, id, qty);
  const backpack = hero.items.find((item) => item.catalogId === "backpack");
  if (backpack) backpack.equipped = true;
  const armor = hero.items.find((item) => item.kind === "armor");
  if (armor) armor.equipped = true;
  let weaponSlots = 0;
  for (const item of hero.items) {
    if (item.kind !== "weapon") continue;
    if (weaponSlots + (item.slots || 0) > 3) continue;
    item.equipped = true;
    weaponSlots += item.slots || 0;
  }
}

export function dieSize(token) {
  if (token === "1") return 0;
  const match = /^d(\d+)/.exec(token || "");
  return match ? Number(match[1]) : 0;
}
