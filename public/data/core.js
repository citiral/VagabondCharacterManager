// Mechanical data for Vagabond (Core Rulebook v3, alpha 3).
// Summaries are original shorthand for use at the table, not the book text.

export const STATS = [
  { id: "might", name: "Might", abbr: "MIT" },
  { id: "dexterity", name: "Dexterity", abbr: "DEX" },
  { id: "awareness", name: "Awareness", abbr: "AWR" },
  { id: "reason", name: "Reason", abbr: "RSN" },
  { id: "presence", name: "Presence", abbr: "PRS" },
  { id: "luck", name: "Luck", abbr: "LUK" },
];

export const STAT_ARRAYS = [
  [5, 5, 5, 5, 3, 3],
  [6, 5, 5, 4, 3, 3],
  [6, 6, 4, 4, 3, 3],
  [6, 6, 5, 3, 3, 2],
  [7, 5, 4, 4, 3, 3],
  [7, 5, 5, 3, 3, 2],
  [7, 6, 4, 3, 3, 2],
  [7, 7, 3, 3, 2, 2],
];

export const SKILLS = [
  { id: "melee", name: "Melee", stat: "might", attack: true, blurb: "Attack with melee weapons." },
  { id: "brawl", name: "Brawl", stat: "might", attack: true, blurb: "Grapple, shove, and brawl weapons." },
  { id: "finesse", name: "Finesse", stat: "dexterity", attack: true, blurb: "Finesse weapons, lockpicks, pickpocket." },
  { id: "sneak", name: "Sneak", stat: "dexterity", blurb: "Hide and approach unseen." },
  { id: "detect", name: "Detect", stat: "awareness", blurb: "Notice danger and avoid surprise." },
  { id: "mysticism", name: "Mysticism", stat: "awareness", cast: true, blurb: "Casting skill for luminaries and witches." },
  { id: "survival", name: "Survival", stat: "awareness", cast: true, blurb: "Tracks, beasts, plants. Druids can cast with it." },
  { id: "ranged", name: "Ranged", stat: "awareness", attack: true, blurb: "Attack with ranged weapons." },
  { id: "arcana", name: "Arcana", stat: "reason", cast: true, blurb: "Casting skill for magi and wizards." },
  { id: "craft", name: "Craft", stat: "reason", blurb: "Appraise, make, and improvised weapons." },
  { id: "medicine", name: "Medicine", stat: "reason", blurb: "Non-magical healing." },
  { id: "influence", name: "Influence", stat: "presence", cast: true, blurb: "Coerce, deceive, parley. Sorcerers cast with it." },
  { id: "leadership", name: "Leadership", stat: "presence", cast: true, blurb: "Command allies. Revelators cast with it." },
  { id: "performance", name: "Performance", stat: "presence", blurb: "Inspire, perform, bardic checks." },
];

export const STATUSES = [
  "Berserk", "Blinded", "Burning", "Charmed", "Confused", "Dazed",
  "Frightened", "Incapacitated", "Invisible", "Paralyzed", "Prone",
  "Restrained", "Sickened", "Suffocating", "Unconscious", "Vulnerable",
];

export const PACES = [
  { id: "quick", name: "Quick", detail: "5 XP per level · about 2–5 months to 10th" },
  { id: "normal", name: "Normal", detail: "5 × next level · about 5–12 months to 10th" },
  { id: "epic", name: "Epic", detail: "7 × next level · about 1–2 years to 10th" },
  { id: "saga", name: "Saga", detail: "10 × next level · 2+ years to 10th" },
];

export const DELIVERIES = [
  { id: "touch", name: "Touch", cost: 0, note: "One Close target, or yourself." },
  { id: "remote", name: "Remote", cost: 0, note: "One target. +1 mana for each extra target." },
  { id: "imbue", name: "Imbue", cost: 0, note: "A weapon within Far. Pay when the attack delivers it." },
  { id: "cube", name: "Cube", cost: 1, note: "5' cube you can see. +1 mana per extra 5' cube." },
  { id: "aura", name: "Aura", cost: 2, note: "10' radius. +1 mana per extra 5' of radius." },
  { id: "cone", name: "Cone", cost: 2, note: "15' cone. +2 mana per extra 5' of length." },
  { id: "glyph", name: "Glyph", cost: 2, note: "A 5' glyph. It later goes off as a 5' cube." },
  { id: "line", name: "Line", cost: 2, note: "5' × 30' × 10' line. +1 mana per extra 10' of length." },
  { id: "sphere", name: "Sphere", cost: 2, note: "5' radius in sight. +1 mana per extra 5' of radius." },
];
