// Ancestries, their traits, and the d66 bands used to roll one.
// grantPerks are specific perks a trait grants. They ignore stat prerequisites.

const A = (id, name, type, size, traits, extra = {}) => ({ id, name, type, size, traits, ...extra });

export const ANCESTRIES = [
  A("human", "Human", "Humanlike", "Medium", [
    { name: "Aptitude", text: "You gain one Perk and one Training." },
    { name: "Strong Potential", text: "Increase one Stat by 1, to a maximum of 7." },
  ], { d66: [11, 26] }),
  A("dwarf", "Dwarf", "Humanlike", "Medium", [
    { name: "Darksight", text: "You have the Infravision perk." },
    { name: "Sturdy", text: "Favor on saves against being frightened, sickened, or shoved." },
    { name: "Tough", text: "You have the Tough perk." },
  ], { d66: [31, 36], grantPerks: ["infravision", "tough"] }),
  A("elf", "Elf", "Fae", "Medium", [
    { name: "Ascendancy", text: "You are trained in Detect and one other skill." },
    { name: "Elven Eyes", text: "Favor on sight-based Detect checks." },
    { name: "Naturally Attuned", text: "You know one spell and may cast it with a skill you choose. Once a round, that casting's delivery costs 1 less mana." },
  ], { d66: [41, 46] }),
  A("halfling", "Halfling", "Humanlike", "Medium", [
    { name: "Fearless", text: "Once per save, reroll a failed Will save against being frightened." },
    { name: "Nimble", text: "You have the Skirmisher perk, and ignore Hinder on Reflex saves." },
    { name: "Tricksy", text: "When a rest restores your Luck, gain 1 extra Luck." },
  ], { d66: [51, 53], grantPerks: ["skirmisher"] }),
  A("draken", "Draken", "Cryptid", "Medium", [
    { name: "Breath Attack", text: "Spend an action to ready a breath. Later that scene, spend an action or skip your move to exhale a 15' cone for 2d6!, using an Endure or Will save." },
    { name: "Scale", text: "+1 Armor." },
    { name: "Draconic Resilience", text: "Take half damage from one of Acid, Cold, Fire, or Shock." },
  ], { d66: [54, 56] }),
  A("goblin", "Goblin", "Cryptid", "Medium", [
    { name: "Darksight", text: "You have the Infravision perk." },
    { name: "Nimble", text: "You have the Skirmisher perk, and ignore Hinder on Reflex saves." },
    { name: "Scavenger", text: "Favor on saves against being sickened." },
  ], { d66: [61, 63], grantPerks: ["infravision", "skirmisher"] }),
  A("orc", "Orc", "Cryptid", "Medium", [
    { name: "Darksight", text: "You have the Infravision perk." },
    { name: "Beefy", text: "You have the Bully perk." },
    { name: "Hulking", text: "Count as one size larger for grappling and shoving." },
  ], { d66: [64, 66], grantPerks: ["infravision", "bully"] }),
];
