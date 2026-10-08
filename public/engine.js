// Rules engine. The hero document, level allowances, carried gear, and the
// derived sheet each live under engine/. This file is the public entry.

export {
  ancestryById,
  ancestryFromD66,
  assignBase,
  automaticTrainings,
  blankHero,
  catalogById,
  chosenTrainings,
  classById,
  classFromD66,
  formatMoney,
  isTrained,
  normalize,
  packFromD66,
  parseMoney,
  perkById,
  rollD66,
  scores,
  setStatArray,
  skillDc,
  spellById,
  statScore,
  xpToLevel,
} from "./engine/model.js";

export {
  countPerk,
  formulaLimit,
  formulaValueCap,
  perkAllowed,
  perkSlots,
  raisesExpected,
  raisesSpent,
  spellLimit,
  trainingBudget,
} from "./engine/build.js";

export {
  addCatalog,
  applyPack,
  dieSize,
  instantiate,
  itemSlots,
  weaponDamage,
} from "./engine/gear.js";

export { derive } from "./engine/sheet.js";

export {
  ALCHEMY,
  ANCESTRIES,
  ARMORS,
  CATALOG,
  CLASSES,
  GEAR,
  PACKS,
  PERKS,
  SKILLS,
  SPELLS,
  STATS,
  STAT_ARRAYS,
  WEAPONS,
} from "./data.js";
