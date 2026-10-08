// Draws the page from state.

import { derive, normalize } from "../engine.js";
import { app, current, OPEN_ACTS, state } from "../state.js";
import { layout } from "./shell.js";

let shownView = "";
let renderGen = 0;

function viewKey() {
  return state.party ? "party" : `${state.id || ""}:${state.tab}`;
}

function focusSnapshot() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !active.matches("input, textarea, select")) return null;
  const snap = { start: active.selectionStart, end: active.selectionEnd };
  if (active.id) return { ...snap, id: active.id };
  if (!active.dataset.act) return null;
  const extras = ["index", "stat", "slot"]
    .filter((key) => active.dataset[key] != null)
    .map((key) => `[data-${key}="${CSS.escape(active.dataset[key])}"]`)
    .join("");
  return { ...snap, selector: `${active.tagName.toLowerCase()}[data-act="${CSS.escape(active.dataset.act)}"]${extras}` };
}

function restoreFocus(snap) {
  if (!snap) return;
  const el = snap.id ? document.getElementById(snap.id) : document.querySelector(snap.selector);
  if (!el) return;
  el.focus({ preventScroll: true });
  if (typeof snap.start === "number" && el.setSelectionRange) {
    try { el.setSelectionRange(snap.start, snap.end); } catch { /* number inputs */ }
  }
}

function captureScroll(sameView) {
  if (!sameView) return null;
  const main = document.querySelector(".app");
  if (!main) return null;
  return {
    top: main.scrollTop,
    left: main.scrollLeft,
    nested: [...document.querySelectorAll("[data-scroll]")].map((el) => [el.dataset.scroll, el.scrollTop]),
  };
}

function restoreScroll(saved) {
  if (!saved) return;
  const main = document.querySelector(".app");
  if (main) {
    main.scrollTop = saved.top;
    main.scrollLeft = saved.left;
  }
  for (const [key, top] of saved.nested) {
    const el = document.querySelector(`[data-scroll="${CSS.escape(key)}"]`);
    if (el) el.scrollTop = top;
  }
}

function lockSheet() {
  const root = document.querySelector("[data-locked]");
  if (!root) return;
  for (const el of root.querySelectorAll("input, select, textarea, button")) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.dataset.ui || el.dataset.uiNum) continue;
    if (el.dataset.act && OPEN_ACTS.has(el.dataset.act)) continue;
    if (el.dataset.act || el.dataset.field) el.disabled = true;
  }
}

export function render() {
  // The page is one innerHTML swap, so the caret and the scroll position go back afterward.
  const gen = ++renderGen;
  const snap = focusSnapshot();
  const nextView = viewKey();
  const saved = captureScroll(shownView === nextView);
  const hero = current();
  if (hero) normalize(hero);
  const sheet = hero ? derive(hero) : null;
  app.innerHTML = layout(hero, sheet);
  lockSheet();
  restoreScroll(saved);
  restoreFocus(snap);
  shownView = nextView;
  if (!saved) return;
  requestAnimationFrame(() => {
    if (gen === renderGen) restoreScroll(saved);
  });
}
