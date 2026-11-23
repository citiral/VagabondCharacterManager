// Small helpers shared by the views: escaping, <option> tags, skill names.

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

export function warnings(sheet) {
  if (!sheet.warnings.length) return "";
  return `<div class="warn">${sheet.warnings.map((line) => `<div>${esc(line)}</div>`).join("")}</div>`;
}

export function option(value, text, selected) {
  return `<option value="${esc(value)}" ${selected ? "selected" : ""}>${esc(text)}</option>`;
}

export function usesCounter(item) {
  if (!item.usesMax) return "";
  const left = Math.min(item.uses ?? item.usesMax, item.usesMax);
  const pips = "●".repeat(left) + "○".repeat(item.usesMax - left);
  return `
    <span class="uses">
      <span class="pips" title="${left} of ${item.usesMax} left">${item.usesMax <= 12 ? pips : `${left} / ${item.usesMax}`}</span>
      <button class="icon" data-act="uses" data-uid="${item.uid}" data-delta="-1">−</button>
      <button class="icon" data-act="uses" data-uid="${item.uid}" data-delta="1">+</button>
      <button class="ghost" data-act="uses-fill" data-uid="${item.uid}" ${left >= item.usesMax ? "disabled" : ""}>Refill</button>
    </span>`;
}

export function skillName(id) {
  return { melee: "Melee", brawl: "Brawl", finesse: "Finesse", sneak: "Sneak", detect: "Detect", mysticism: "Mysticism", survival: "Survival", ranged: "Ranged", arcana: "Arcana", craft: "Craft", medicine: "Medicine", influence: "Influence", leadership: "Leadership", performance: "Performance" }[id] || id;
}
