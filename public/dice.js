// Dice, attack profiles, and the line pushed into the tray log.

import { weaponDamage } from "./engine.js";
import { state } from "./state.js";

function rollDie(sides) {
  return 1 + Math.floor(Math.random() * sides);
}

export function rollExpr(expr, explode) {
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

export function pushLog(entry) {
  state.log.unshift(entry);
  state.log = state.log.slice(0, 6);
}

export function attackProfile(hero, item, sheet) {
  const options = (item.types || []).map((id) => sheet.skills.find((skill) => skill.id === id)).filter(Boolean);
  options.sort((a, b) => a.dc - b.dc || Number(b.trained) - Number(a.trained));
  return { skill: options[0], trained: options.some((skill) => skill.trained), damage: weaponDamage(item) };
}

export function rollCheck(title, dc, critAt) {
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

export function plainDie(sides) {
  const face = rollDie(sides);
  return { title: `d${sides}`, detail: String(face), pass: true, crit: face === sides };
}
