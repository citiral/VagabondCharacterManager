import {
  ALCHEMY, ANCESTRIES, CATALOG, CLASSES, DELIVERIES, GEAR, PACKS, PERKS, SPELLS, STATS, STAT_ARRAYS, STATUSES, PACES,
} from "./data.js";
import {
  addCatalog, applyPack, ancestryFromD66, assignBase, blankHero, catalogById, classById, classFromD66,
  derive, formatMoney, instantiate, itemSlots, normalize, packFromD66, parseMoney, perkAllowed, perkById,
  raisesExpected, raisesSpent, rollD66, setStatArray, spellById, statScore, trainingBudget, weaponDamage,
  xpToLevel,
} from "./engine.js";

const state = {
  heroes: [],
  id: localStorage.getItem("vagabond-id") || "",
  tab: "record",
  party: false,
  favor: 0,
  explode: false,
  log: [],
  saving: "Connecting…",
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

const QUESTIONS = [
  "Completed a quest",
  "Failed, and let the failure stand",
  "Defeated a boss",
  "Passed a hindered check",
  "Made a discovery",
  "Looted at least 50g",
];

const app = document.querySelector("#app");

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

function current() {
  return state.heroes.find((hero) => hero.id === state.id) || null;
}

function hydrate(raw) {
  const hero = blankHero();
  const base = { ...hero.base, ...(raw.base || {}) };
  const raises = { ...hero.raises, ...(raw.raises || {}) };
  Object.assign(hero, raw, { base, raises });
  return normalize(hero);
}

const outbound = new Map();
let socket = null;
let live = false;
let retryMs = 1000;
let booted = false;
let resolveBoot = () => {};
const bootPromise = new Promise((resolve) => {
  resolveBoot = resolve;
});

function paintSave() {
  const node = document.querySelector(".save-state");
  if (node) node.textContent = state.saving;
}

function adoptParty(heroes, replace) {
  const next = heroes.map(hydrate);
  if (!replace) {
    for (const id of outbound.keys()) {
      const local = state.heroes.find((hero) => hero.id === id);
      if (!local) continue;
      const index = next.findIndex((hero) => hero.id === id);
      if (index >= 0) next[index] = local;
      else next.push(local);
    }
  }
  state.heroes = next;
  if (!current() && state.heroes[0]) state.id = state.heroes[0].id;
  render();
}

function applyRemoteUpsert(raw) {
  const incoming = hydrate(raw);
  const index = state.heroes.findIndex((hero) => hero.id === incoming.id);
  const local = index >= 0 ? state.heroes[index] : null;
  const active = document.activeElement;
  const field = active?.dataset?.field;
  if (local && field && state.id === incoming.id) incoming[field] = local[field];
  if (index >= 0) state.heroes[index] = incoming;
  else state.heroes.push(incoming);
  if (outbound.has(incoming.id)) outbound.set(incoming.id, incoming);
  render();
}

function applyRemoteDelete(id) {
  if (outbound.has(id)) return;
  const existed = state.heroes.some((hero) => hero.id === id);
  if (!existed) return;
  state.heroes = state.heroes.filter((hero) => hero.id !== id);
  if (state.id === id) state.id = state.heroes[0]?.id || "";
  render();
}

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const next = new WebSocket(`${proto}//${location.host}/api/live`);
  socket = next;
  next.onopen = () => {
    live = true;
    retryMs = 1000;
    state.saving = "Live";
    state.error = "";
    paintSave();
    flushOutbound();
  };
  next.onmessage = (event) => {
    let message = null;
    try { message = JSON.parse(event.data); } catch { return; }
    if (!message) return;
    if (message.type === "party") {
      if (!booted) {
        booted = true;
        state.saving = "Live";
        adoptParty(message.heroes || [], true);
        resolveBoot();
      } else {
        adoptParty(message.heroes || [], false);
      }
      return;
    }
    if (message.type === "upsert") applyRemoteUpsert(message.hero);
    if (message.type === "delete") applyRemoteDelete(message.id);
    if (message.type === "error") {
      state.error = message.error || "The live update was rejected.";
      state.saving = "Not saved";
      render();
    }
  };
  next.onclose = () => {
    if (socket !== next) return;
    live = false;
    state.saving = "Reconnecting…";
    paintSave();
    const wait = retryMs;
    retryMs = Math.min(retryMs * 2, 30000);
    setTimeout(connect, wait);
  };
  next.onerror = () => {
    if (socket === next) next.close();
  };
}

function flushOutbound() {
  if (!outbound.size) {
    state.saving = live ? "Live" : state.saving;
    paintSave();
    return;
  }
  if (live && socket?.readyState === WebSocket.OPEN) {
    for (const hero of outbound.values()) {
      normalize(hero);
      socket.send(JSON.stringify({ type: "upsert", hero }));
    }
    outbound.clear();
    state.saving = "Live";
    state.error = "";
    paintSave();
    return;
  }
  const pending = [...outbound.values()];
  outbound.clear();
  for (const hero of pending) persist(hero);
}

function scheduleSave(hero, immediate = false) {
  outbound.set(hero.id, hero);
  state.saving = live ? "Live" : "Saving…";
  clearTimeout(state.timer);
  if (immediate && live && socket?.readyState === WebSocket.OPEN) {
    flushOutbound();
    return;
  }
  state.timer = setTimeout(flushOutbound, live ? 350 : 2000);
}

async function load() {
  app.innerHTML = `<p class="banner">Connecting…</p>`;
  connect();
  const liveBoot = await Promise.race([
    bootPromise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 2500)),
  ]);
  if (liveBoot) return;
  const response = await fetch("/api/heroes");
  if (!response.ok) throw new Error("Could not load the party");
  if (booted) return;
  booted = true;
  state.heroes = (await response.json()).map(hydrate);
  if (!current() && state.heroes[0]) state.id = state.heroes[0].id;
  state.saving = "Saved";
  render();
}

async function persist(hero) {
  normalize(hero);
  const response = await fetch(`/api/heroes/${hero.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(hero),
  });
  state.saving = response.ok ? (live ? "Live" : "Saved") : "Not saved";
  state.error = response.ok ? "" : "The sheet didn't save. Keep this tab open and try again.";
  paintSave();
}

function commit(hero) {
  if (!hero) return;
  normalize(hero);
  scheduleSave(hero, true);
  render();
}

function rollDie(sides) {
  return 1 + Math.floor(Math.random() * sides);
}

function rollExpr(expr, explode) {
  if (!expr || expr === "1") return { total: 1, text: "1" };
  const match = /^(?:(\d+)d(\d+)|d(\d+))(?:\+(\d+))?$/.exec(expr);
  if (!match) return { total: 0, text: expr };
  const count = Number(match[1] || 1);
  const sides = Number(match[2] || match[3]);
  const mod = Number(match[4] || 0);
  const rolls = [];
  for (let i = 0; i < count; i++) {
    let face = rollDie(sides);
    rolls.push(face);
    let guard = 0;
    while (explode && face === sides && guard++ < 12) {
      face = rollDie(sides);
      rolls.push(face);
    }
  }
  return { total: rolls.reduce((sum, face) => sum + face, 0) + mod, text: rolls.join(" + ") + (mod ? ` + ${mod}` : "") };
}

function pushLog(entry) {
  state.log.unshift(entry);
  state.log = state.log.slice(0, 6);
}

function attackProfile(hero, item, sheet) {
  const options = (item.types || []).map((id) => sheet.skills.find((skill) => skill.id === id)).filter(Boolean);
  options.sort((a, b) => a.dc - b.dc || Number(b.trained) - Number(a.trained));
  return { skill: options[0], trained: options.some((skill) => skill.trained), damage: weaponDamage(item) };
}

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

function render() {
  const gen = ++renderGen;
  const snap = focusSnapshot();
  const nextView = viewKey();
  const saved = captureScroll(shownView === nextView);
  const hero = current();
  if (hero) normalize(hero);
  const sheet = hero ? derive(hero) : null;
  app.innerHTML = layout(hero, sheet);
  restoreScroll(saved);
  restoreFocus(snap);
  shownView = nextView;
  if (!saved) return;
  requestAnimationFrame(() => {
    if (gen === renderGen) restoreScroll(saved);
  });
}

function layout(hero, sheet) {
  return `
    <div class="app">
      <aside class="sidebar">
        <p class="kicker">Land of the Blind</p>
        <h1 class="brand">VAGA<span>BOND</span></h1>
        <p class="tagline">Hero record for the table.</p>
        <div class="side-actions">
          <button class="primary" data-act="new">New hero</button>
          <button class="ghost" data-act="party">${state.party ? "Back to sheet" : "Whole table"}</button>
        </div>
        <div class="hero-list">${state.heroes.map(card).join("") || `<p class="hint">No heroes yet.</p>`}</div>
        <div class="side-foot">
          <button class="ghost" data-act="export-all">Export party</button>
          <button class="ghost" data-act="import">Import</button>
          <input id="import-file" type="file" accept="application/json" hidden>
        </div>
        <p class="hint">Open this address on another machine at the table and you share the same party, live. Coin is 1g = 100s = 1000c.</p>
      </aside>
      <main class="stage">
        <div class="toolbar no-print">
          <div class="tabs">
            ${["record", "build", "gear", "magic"].map((tab) =>
              `<button class="tab ${state.tab === tab && !state.party ? "on" : ""}" data-act="tab" data-tab="${tab}">${label(tab)}</button>`
            ).join("")}
          </div>
          <div class="row">
            ${hero ? `<button class="ghost" data-act="duplicate">Duplicate</button><button class="ghost" data-act="delete">Delete</button><button class="ghost" data-act="export-pdf">Export PDF</button><button class="ghost" data-act="export-one">Export JSON</button>` : ""}
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

function card(hero) {
  const sheet = derive(hero);
  const hp = hero.hp == null ? sheet.effectiveMaxHp : hero.hp;
  const pct = sheet.effectiveMaxHp ? Math.max(0, Math.min(100, (hp / sheet.effectiveMaxHp) * 100)) : 0;
  const title = hero.name || "Unnamed hero";
  return `
    <button class="hero-card ${hero.id === state.id ? "on" : ""}" data-act="select" data-id="${hero.id}">
      <strong>${esc(title)}</strong>
      <small>${esc(sheet.ancestryName)} ${esc(sheet.className)} · L${sheet.level}${hero.player ? ` · ${esc(hero.player)}` : ""}</small>
      <div class="bar"><i style="width:${pct}%"></i></div>
    </button>`;
}

function welcome() {
  return `
    <section class="sheet welcome">
      <p class="kicker">Session zero</p>
      <h2>The road is empty.</h2>
      <p>This is a shared character manager for Vagabond. It builds a hero from the alpha rules, then tracks the numbers you actually touch in play.</p>
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
  if (state.tab === "build") return build(hero, sheet);
  if (state.tab === "gear") return gear(hero, sheet);
  if (state.tab === "magic") return magic(hero, sheet);
  return record(hero, sheet);
}

function warnings(sheet) {
  if (!sheet.warnings.length) return "";
  return `<div class="warn">${sheet.warnings.map((line) => `<div>${esc(line)}</div>`).join("")}</div>`;
}

function record(hero, sheet) {
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
            <input id="hero-player" data-field="player" data-render="1" placeholder="Player" value="${esc(hero.player)}">
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
        <p class="muted">${hero.xp} / ${cost} XP to level ${hero.level + 1}. Even levels also grant a stat increase. Odd levels from 3rd grant a perk.</p>
        <div class="row">
          <button class="primary" data-act="level-up" ${hero.xp < cost ? "disabled" : ""}>Spend XP and level up</button>
          <button class="ghost" data-act="destiny">Destiny level up</button>
        </div>
        <h2 style="margin-top:14px">End of session</h2>
        ${QUESTIONS.map((q, i) => `<label class="check"><input type="checkbox" data-act="question" data-i="${i}" ${state.qs[i] ? "checked" : ""}> ${esc(q)}</label>`).join("")}
        <button class="ghost" data-act="award">Award ${state.qs.filter(Boolean).length} XP to the whole party</button>
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

function build(hero, sheet) {
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

function option(value, text, selected) {
  return `<option value="${esc(value)}" ${selected ? "selected" : ""}>${esc(text)}</option>`;
}

function skillName(id) {
  return { melee: "Melee", brawl: "Brawl", finesse: "Finesse", sneak: "Sneak", detect: "Detect", mysticism: "Mysticism", survival: "Survival", ranged: "Ranged", arcana: "Arcana", craft: "Craft", medicine: "Medicine", influence: "Influence", leadership: "Leadership", performance: "Performance" }[id] || id;
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

function gear(hero, sheet) {
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

const SPELL_FILTERS = [
  ["all", "All"],
  ["known", "Known"],
  ["damage", "Damage"],
  ["plain", "No damage"],
  ["object", "Object"],
];
const SPELL_TYPES = ["Acid", "Cold", "Fire", "Poison", "Shock", "Blunt"];

function magic(hero, sheet) {
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
            <p class="kicker">${esc(hero.player || "Hero")}</p>
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

function tray() {
  const last = state.log[0];
  return `
    <footer class="tray no-print">
      <div class="dice-row">
        ${[["Hinder", -1], ["Straight", 0], ["Favor", 1]].map(([name, value]) =>
          `<button class="ghost ${state.favor === value ? "on" : ""}" data-act="favor" data-value="${value}">${name}</button>`
        ).join("")}
        <label class="check"><input id="explode" type="checkbox" data-act="explode" ${state.explode ? "checked" : ""}> Exploding</label>
      </div>
      <div class="dice-row">
        ${[4, 6, 8, 10, 12, 20].map((sides) => `<button class="ghost" data-act="die" data-sides="${sides}">d${sides}</button>`).join("")}
        <button class="ghost" data-act="d66">d66</button>
      </div>
      <div class="log">${last ? logLine(last) : `<span class="hint">Click a skill, save, or weapon to roll. Crits are read off the unmodified d20.</span>`}</div>
    </footer>`;
}

function logLine(entry) {
  const klass = entry.crit ? "crit" : entry.pass ? "pass" : "fail";
  return `<div class="${klass}"><strong>${esc(entry.title)}</strong> ${esc(entry.detail)}</div>`;
}

function poolValue(hero, key, sheet) {
  if (key === "hp") return hero.hp == null ? sheet.effectiveMaxHp : hero.hp;
  if (key === "mana") return hero.mana == null ? sheet.maxMana : hero.mana;
  if (key === "luck") return hero.luck == null ? sheet.luckMax : hero.luck;
  return hero[key] || 0;
}

function bumpLevel(hero, spend) {
  const before = derive(hero);
  const cost = xpToLevel(hero.level, hero.pace);
  if (spend && hero.xp < cost) return;
  const hp = hero.hp == null ? before.effectiveMaxHp : hero.hp;
  const mana = hero.mana == null ? before.maxMana : hero.mana;
  const fullHp = hp >= before.effectiveMaxHp;
  const fullMana = mana >= before.maxMana;
  if (spend) hero.xp -= cost;
  hero.level += 1;
  normalize(hero);
  const after = derive(hero);
  hero.hp = fullHp ? after.effectiveMaxHp : hp;
  hero.mana = fullMana ? after.maxMana : mana;
}

document.addEventListener("input", (event) => {
  const el = event.target;
  if (!(el instanceof HTMLElement)) return;
  if (el.dataset.ui) {
    state[el.dataset.ui] = el.value;
    render();
    return;
  }
  if (el.dataset.uiNum) {
    state[el.dataset.uiNum] = Number(el.value);
    render();
    return;
  }
  const hero = current();
  if (!hero || !el.dataset.field) return;
  writeField(hero, el.dataset.field, el.value);
  scheduleSave(hero);
  if (el.dataset.render) render();
});

document.addEventListener("change", (event) => {
  const el = event.target;
  if (!(el instanceof HTMLElement)) return;
  if (el.dataset.act) {
    onAct(el);
    return;
  }
  const hero = current();
  if (!hero || !el.dataset.field) return;
  writeField(hero, el.dataset.field, el.value);
  commit(hero);
});

document.addEventListener("click", (event) => {
  const el = event.target instanceof HTMLElement ? event.target.closest("[data-act]") : null;
  if (!el || el.tagName === "SELECT" || el.tagName === "INPUT" || el.tagName === "TEXTAREA") return;
  onAct(el);
});

function writeField(hero, field, value) {
  if (["name", "player", "concept", "notes"].includes(field)) hero[field] = value;
  else if (field === "wealth") hero.wealth = parseMoney(value);
  else if (field === "hp") hero.hp = Math.max(0, Math.trunc(Number(value) || 0));
  else if (field === "mana") hero.mana = Math.max(0, Math.trunc(Number(value) || 0));
  else if (field === "luck") hero.luck = Math.max(0, Math.trunc(Number(value) || 0));
  else if (field === "xp") hero.xp = Math.max(0, Math.trunc(Number(value) || 0));
  else if (field === "level") hero.level = Math.max(0, Math.trunc(Number(value) || 0));
  else if (field === "studied") hero.studied = Math.max(0, Math.trunc(Number(value) || 0));
}

function onAct(el) {
  const act = el.dataset.act;
  const hero = current();
  if (act === "new") return createHero();
  if (act === "import") return document.querySelector("#import-file")?.click();
  if (act === "export-all") return download("vagabond-party.json", state.heroes);
  if (act === "party") { state.party = !state.party; render(); return; }
  if (act === "tab") { state.party = false; state.tab = el.dataset.tab; render(); return; }
  if (act === "select") { state.id = el.dataset.id; state.party = false; localStorage.setItem("vagabond-id", state.id); render(); return; }
  if (act === "open") { state.id = el.dataset.id; state.party = false; state.tab = "record"; localStorage.setItem("vagabond-id", state.id); render(); return; }
  if (act === "favor") { state.favor = Number(el.dataset.value); render(); return; }
  if (act === "explode") { state.explode = el.checked; return; }
  if (act === "die") return pushAndRender(plainDie(Number(el.dataset.sides)));
  if (act === "d66") return pushAndRender({ title: "d66", detail: String(rollD66()), pass: true });
  if (act === "question") { state.qs[Number(el.dataset.i)] = el.checked; render(); return; }
  if (act === "loot") { state.loot = el.checked; render(); return; }
  if (act === "gear-cat") { state.gearCat = el.value; render(); return; }
  if (act === "spell-filter") { state.spellFilter = el.dataset.filter || "all"; render(); return; }
  if (act === "spell-type") { state.spellType = el.value; render(); return; }
  if (act === "cast-spell") { state.castSpell = el.value; state.dice = spellById(el.value)?.damage ? 1 : 0; render(); return; }
  if (act === "cast-delivery") { state.delivery = el.value; render(); return; }
  if (act === "cast-effect") { state.effect = el.checked; render(); return; }
  if (!hero) return;

  if (act === "ancestry") hero.ancestry = el.value;
  else if (act === "class") hero.classId = el.value;
  else if (act === "pace") hero.pace = el.value;
  else if (act === "draken") hero.drakenWard = el.value;
  else if (act === "array") setStatArray(hero, Number(el.dataset.index));
  else if (act === "custom") hero.customStats = !hero.customStats;
  else if (act === "base") {
    if (hero.customStats) hero.base[el.dataset.stat] = Number(el.value);
    else assignBase(hero, el.dataset.stat, Number(el.value));
  } else if (act === "raise") {
    const stat = el.dataset.stat;
    const delta = Number(el.dataset.delta);
    const spent = raisesSpent(hero);
    const expected = raisesExpected(hero);
    if (delta > 0 && statScore(hero, stat) < 7 && (hero.customStats || spent < expected)) hero.raises[stat] = (hero.raises[stat] || 0) + 1;
    if (delta < 0 && (hero.raises[stat] || 0) > 0) hero.raises[stat] -= 1;
  } else if (act === "training") {
    const rows = [];
    const budget = Math.max(trainingBudget(hero), (hero.trainings || []).length);
    for (let i = 0; i < budget; i++) rows.push(hero.trainings[i] || "");
    rows[Number(el.dataset.index)] = el.value;
    const unique = [];
    for (const id of rows) if (id && !unique.includes(id)) unique.push(id);
    hero.trainings = unique;
  } else if (act === "elf-skill") hero.elfSkill = el.value;
  else if (act === "elf-spell") hero.elfSpell = el.value;
  else if (act === "elf-cast") hero.elfCastSkill = el.value;
  else if (act === "perk") hero.perkChoices[el.dataset.slot] = el.value;
  else if (act === "secret") hero.magicalSecrets[el.dataset.slot] = el.value;
  else if (act === "roll-ancestry") {
    const found = rollTable(ancestryFromD66);
    if (found) hero.ancestry = found.id;
  } else if (act === "roll-class") {
    const found = rollTable(classFromD66);
    if (found) hero.classId = found.id;
  } else if (act === "roll-array") setStatArray(hero, Math.floor(Math.random() * 8));
  else if (act === "roll-pack") {
    const found = rollTable(packFromD66);
    if (found && confirm(`Take the ${found.name} pack? This replaces carried gear.`)) applyPack(hero, found.id);
  } else if (act === "apply-pack") {
    const id = document.querySelector("#pack-select")?.value;
    const pack = PACKS.find((entry) => entry.id === id);
    if (pack && confirm(`Take the ${pack.name} pack? This replaces carried gear.`)) applyPack(hero, pack.id);
  } else if (act === "buy") return buy(hero, el.dataset.id);
  else if (act === "equip") toggleEquip(hero, el.dataset.uid);
  else if (act === "qty") changeQty(hero, el.dataset.uid, Number(el.dataset.delta));
  else if (act === "sell") sell(hero, el.dataset.uid);
  else if (act === "drop") hero.items = hero.items.filter((item) => item.uid !== el.dataset.uid);
  else if (act === "grip") {
    const item = hero.items.find((entry) => entry.uid === el.dataset.uid);
    if (item) item.gripMode = item.gripMode === "2h" ? "1h" : "2h";
  } else if (act === "custom") addCustom(hero);
  else if (act === "spell-add") toggleList(hero, "spells", el.dataset.id, true);
  else if (act === "spell-forget") {
    if (classById(hero.classId)?.requiredSpell === el.dataset.id) return;
    toggleList(hero, "spells", el.dataset.id, false);
  }
  else if (act === "formula") toggleList(hero, "formulae", el.dataset.id, el.checked);
  else if (act === "condition") {
    hero.conditions = hero.conditions.includes(el.dataset.name)
      ? hero.conditions.filter((name) => name !== el.dataset.name)
      : [...hero.conditions, el.dataset.name];
  } else if (act === "delta") {
    const key = el.dataset.key;
    hero[key] = Math.max(0, (hero[key] || 0) + Number(el.dataset.delta));
    if (key === "fatigue") hero.fatigue = Math.min(5, hero.fatigue);
  } else if (act === "pool") {
    const sheet = derive(hero);
    const key = el.dataset.key;
    const next = Math.max(0, poolValue(hero, key, sheet) + Number(el.dataset.delta));
    hero[key] = next;
  } else if (act === "rest") rest(hero);
  else if (act === "breather") breather(hero);
  else if (act === "new-shift") hero.breatherUsed = false;
  else if (act === "level-up") bumpLevel(hero, true);
  else if (act === "destiny") bumpLevel(hero, false);
  else if (act === "award") return award();
  else if (act === "delete") return removeHero(hero);
  else if (act === "duplicate") return copyHero(hero);
  else if (act === "export-one") return download(`${hero.name || "hero"}.json`, hero);
  else if (act === "export-pdf") {
    exportPdf(hero);
    return;
  }
  else if (act === "roll-skill") return rollSkill(hero, el.dataset.skill);
  else if (act === "roll-save") return rollSave(hero, el.dataset.save);
  else if (act === "roll-weapon") return rollWeapon(hero, el.dataset.uid);
  else if (act === "roll-unarmed") return rollWeapon(hero, null);
  else return;
  commit(hero);
}

function rollTable(fn) {
  for (let i = 0; i < 40; i++) {
    const found = fn(rollD66());
    if (found) return found;
  }
  return null;
}

function toggleList(hero, key, id, on) {
  const list = new Set(hero[key] || []);
  if (on) list.add(id);
  else list.delete(id);
  hero[key] = [...list];
}

function toggleEquip(hero, uid) {
  const item = hero.items.find((entry) => entry.uid === uid);
  if (!item) return;
  if (item.kind === "armor" && !item.equipped) {
    for (const other of hero.items) if (other.kind === "armor") other.equipped = false;
  }
  item.equipped = !item.equipped;
}

function changeQty(hero, uid, delta) {
  const item = hero.items.find((entry) => entry.uid === uid);
  if (!item) return;
  if (item.kind === "weapon" || item.kind === "armor") return;
  item.qty = Math.max(0, (item.qty || 1) + delta);
  if (item.qty <= 0) hero.items = hero.items.filter((entry) => entry.uid !== uid);
}

function sell(hero, uid) {
  const item = hero.items.find((entry) => entry.uid === uid);
  if (!item) return;
  hero.wealth += (item.value || 0) * (item.qty || 1);
  hero.items = hero.items.filter((entry) => entry.uid !== uid);
}

function buy(hero, id) {
  const entry = catalogById(id);
  if (!entry) return;
  if (!state.loot) {
    if (hero.wealth < entry.value) {
      state.error = `That costs ${formatMoney(entry.value)}. The purse holds ${formatMoney(hero.wealth)}.`;
      render();
      return;
    }
    hero.wealth -= entry.value;
  }
  state.error = "";
  addCatalog(hero, id, 1);
  commit(hero);
}

function addCustom(hero) {
  const name = document.querySelector("#custom-name")?.value?.trim();
  if (!name) return;
  const kind = document.querySelector("#custom-kind")?.value || "gear";
  const slots = Math.max(0, Number(document.querySelector("#custom-slots")?.value || 1));
  const value = parseMoney(document.querySelector("#custom-value")?.value || "0");
  const raw = document.querySelector("#custom-weapon")?.value || "";
  const [damage, range, grip] = raw.split(",").map((part) => part.trim());
  hero.items.push({
    ...instantiate({ id: "custom", name, kind, slots, value, damage: damage || (kind === "weapon" ? "d4" : ""), range: range || "Close", grip: grip || "1h", types: kind === "weapon" ? ["melee"] : [], props: [] }),
    catalogId: null,
  });
  commit(hero);
}

function rest(hero) {
  const before = derive(hero);
  const hp = poolValue(hero, "hp", before);
  if (hp >= before.effectiveMaxHp) hero.fatigue = Math.max(0, (hero.fatigue || 0) - 1);
  const after = derive(hero);
  hero.hp = after.effectiveMaxHp;
  hero.mana = after.maxMana;
  hero.luck = after.luckMax;
  hero.breatherUsed = false;
}

function breather(hero) {
  if (hero.breatherUsed) return;
  const sheet = derive(hero);
  hero.hp = Math.min(sheet.effectiveMaxHp, poolValue(hero, "hp", sheet) + sheet.scores.might);
  hero.breatherUsed = true;
}

function award() {
  const gain = state.qs.filter(Boolean).length;
  if (!gain) return;
  for (const hero of state.heroes) {
    hero.xp += gain;
    scheduleSave(hero, true);
  }
  state.qs = [false, false, false, false, false, false];
  render();
}

function rollCheck(title, dc, critAt) {
  const natural = rollDie(20);
  let bonus = 0;
  let extra = "";
  if (state.favor !== 0) {
    const face = rollDie(6);
    bonus = state.favor * face;
    extra = state.favor > 0 ? ` + d6 ${face}` : ` − d6 ${face}`;
  }
  const total = natural + bonus;
  const crit = natural >= critAt;
  const pass = total >= dc;
  let detail = `d20 ${natural}${extra} = ${total} vs ${dc}. ${pass ? "Pass" : "Fail"}${crit ? ". Crit" : ""}`;
  if (crit) detail += " — choose one crit benefit.";
  pushLog({ title, detail, pass, crit });
  return { pass, crit, total };
}

function rollSkill(hero, id) {
  const sheet = derive(hero);
  const skill = sheet.skills.find((entry) => entry.id === id);
  const critAt = skill.cast && hero.classId === "sorcerer" ? sheet.castCrit : 20;
  rollCheck(skill.name, skill.dc, critAt);
  render();
}

function rollSave(hero, id) {
  const sheet = derive(hero);
  const names = { endure: "Endure", reflex: "Reflex", will: "Will" };
  const dc = sheet[id];
  rollCheck(names[id], dc, 20);
  render();
}

function rollWeapon(hero, uid) {
  const sheet = derive(hero);
  const item = uid
    ? hero.items.find((entry) => entry.uid === uid)
    : { name: "Unarmed", types: ["brawl", "finesse"], props: ["grapple"], damage: "1", grip: "1h" };
  if (!item) return;
  const profile = attackProfile(hero, item, sheet);
  if (!profile.skill) return;
  const critAt = sheet.attackCrit;
  const check = rollCheck(`${item.name} · ${profile.skill.name}`, profile.skill.dc, critAt);
  if (check.pass) {
    const damage = rollExpr(profile.damage, state.explode);
    state.log[0].detail += `. Damage ${damage.total} (${damage.text})`;
  }
  render();
}

function plainDie(sides) {
  const face = rollDie(sides);
  return { title: `d${sides}`, detail: String(face), pass: true, crit: face === sides };
}

function pushAndRender(entry) {
  pushLog(entry);
  render();
}

async function removeHero(hero) {
  if (!confirm(`Delete ${hero.name || "this hero"}?`)) return;
  outbound.delete(hero.id);
  if (live && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "delete", id: hero.id }));
  else await fetch(`/api/heroes/${hero.id}`, { method: "DELETE" });
  state.heroes = state.heroes.filter((entry) => entry.id !== hero.id);
  state.id = state.heroes[0]?.id || "";
  localStorage.setItem("vagabond-id", state.id);
  render();
}

async function copyHero(hero) {
  const copy = hydrate(structuredClone(hero));
  copy.id = crypto.randomUUID();
  copy.name = `${hero.name || "Hero"} copy`;
  copy.createdAt = Date.now();
  const response = await fetch("/api/heroes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(copy),
  });
  if (!response.ok) return;
  const saved = hydrate(await response.json());
  if (!state.heroes.some((entry) => entry.id === saved.id)) state.heroes.push(saved);
  state.id = saved.id;
  localStorage.setItem("vagabond-id", saved.id);
  render();
}

async function createHero() {
  const hero = blankHero();
  hero.name = "New hero";
  const response = await fetch("/api/heroes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(hero),
  });
  if (!response.ok) {
    state.error = "Couldn't create a hero.";
    render();
    return;
  }
  const saved = hydrate(await response.json());
  if (!state.heroes.some((entry) => entry.id === saved.id)) state.heroes.push(saved);
  state.id = saved.id;
  state.tab = "build";
  state.party = false;
  localStorage.setItem("vagabond-id", saved.id);
  render();
}

let pdfBusy = false;

async function exportPdf(hero) {
  if (pdfBusy) return;
  pdfBusy = true;
  try {
    const { downloadHeroRecord } = await import("./sheet-pdf.js");
    await downloadHeroRecord(hero);
  } catch (error) {
    console.error(error);
    state.error = "Couldn't build the PDF sheet.";
    render();
  } finally {
    pdfBusy = false;
  }
}

function download(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

document.addEventListener("change", async (event) => {
  const input = event.target;
  if (input?.id !== "import-file") return;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const incoming = Array.isArray(data) ? data : [data];
    for (const raw of incoming) {
      const hero = hydrate(raw);
      hero.id = crypto.randomUUID();
      hero.name = hero.name || "Imported hero";
      const response = await fetch("/api/heroes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(hero),
      });
      if (response.ok) {
        const saved = hydrate(await response.json());
        if (!state.heroes.some((entry) => entry.id === saved.id)) state.heroes.push(saved);
      }
    }
    state.error = "";
  } catch {
    state.error = "That file isn't a hero record.";
  }
  input.value = "";
  render();
});

setInterval(() => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
}, 25000);

function pushPending(useSocket) {
  const pending = [...outbound.values()];
  for (const hero of pending) normalize(hero);
  if (useSocket && socket?.readyState === WebSocket.OPEN) {
    for (const hero of pending) socket.send(JSON.stringify({ type: "upsert", hero }));
    outbound.clear();
    socket.send(JSON.stringify({ type: "flush" }));
    return;
  }
  for (const hero of pending) {
    fetch(`/api/heroes/${hero.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-immediate": "1" },
      body: JSON.stringify(hero),
      keepalive: true,
    });
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") pushPending(true);
});

window.addEventListener("beforeunload", () => {
  pushPending(socket?.readyState === WebSocket.OPEN);
});

load().catch((error) => {
  app.innerHTML = `<p class="banner">${esc(error.message)}</p>`;
});
