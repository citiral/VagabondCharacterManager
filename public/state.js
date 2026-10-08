// Heroes on this screen, which tab is open, and UI state that isn't part of a hero.

import { blankHero, normalize } from "./engine.js";

function trayStartsMin() {
  const saved = localStorage.getItem("vagabond-tray");
  if (saved === "min" || saved === "open") return saved === "min";
  return window.matchMedia("(max-width: 800px), (max-height: 520px)").matches;
}

export const state = {
  heroes: [],
  id: localStorage.getItem("vagabond-id") || "",
  tab: "record",
  party: false,
  favor: 0,
  explode: false,
  trayMin: trayStartsMin(),
  log: [],
  saving: "Connecting…",
  username: "",
  role: "",
  error: "",
  gearQuery: "",
  gearCat: "All",
  spellQuery: "",
  spellFilter: "all",
  spellType: "",
  loot: false,
  timer: 0,
  qs: [false, false, false, false, false, false],
};

export const QUESTIONS = [
  "Completed a quest",
  "Failed, and let the failure stand",
  "Defeated a boss",
  "Passed a hindered check",
  "Made a discovery",
  "Looted at least 50g",
];

export const app = document.querySelector("#app");

export function current() {
  return state.heroes.find((hero) => hero.id === state.id) || null;
}

export function hydrate(raw) {
  const hero = blankHero();
  const base = { ...hero.base, ...(raw.base || {}) };
  const raises = { ...hero.raises, ...(raw.raises || {}) };
  Object.assign(hero, raw, { base, raises });
  return normalize(hero);
}
