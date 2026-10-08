// Ancestries, their traits, and the d66 bands used to roll one.

const A = (id, name, type, size, traits, extra = {}) => ({ id, name, type, size, traits, ...extra });

export const ANCESTRIES = [
  A("human", "Human", "Humanlike", "Medium", [
    { name: "Aptitude", text: "You gain one Perk and one Training." },
    { name: "Strong Potential", text: "Increase one Stat by 1, to a maximum of 7." },
  ], { d66: [11, 26] }),
  A("dwarf", "Dwarf", "Humanlike", "Medium", [
    { name: "Darksight", text: "Darkness does not blind you." },
    { name: "Sturdy", text: "Favor on saves against being frightened, sickened, or shoved." },
    { name: "Tough", text: "You have the Tough perk." },
  ], { d66: [31, 36], grantPerks: ["tough"] }),
  A("elf", "Elf", "Fae", "Medium", [
    { name: "Ascendancy", text: "You are trained in Detect and one other skill." },
    { name: "Elven Eyes", text: "Favor on sight-based Detect checks." },
    { name: "Naturally Attuned", text: "You know one spell and may cast it with a skill you choose. Once a round, that casting's delivery costs 1 less mana." },
  ], { d66: [41, 46] }),
  A("halfling", "Halfling", "Humanlike", "Medium", [
    { name: "Nimble", text: "+5' Speed, and ignore Hinder on Reflex saves." },
    { name: "Squat", text: "You can move through spaces occupied by other beings." },
    { name: "Tricksy", text: "When a rest restores your Luck, gain 1 extra Luck." },
  ], { d66: [51, 53] }),
  A("draken", "Draken", "Cryptid", "Medium", [
    { name: "Breath Attack", text: "Spend an action to ready a breath. Later that scene, spend an action or skip your move to exhale a 15' cone for 2d6!, using an Endure or Will save." },
    { name: "Scale", text: "+1 Armor." },
    { name: "Draconic Resilience", text: "Take half damage from Acid, Cold, Fire, or Shock — pick one." },
  ], { d66: [54, 56] }),
  A("goblin", "Goblin", "Cryptid", "Medium", [
    { name: "Darksight", text: "Darkness does not blind you." },
    { name: "Nimble", text: "+5' Speed, and ignore Hinder on Reflex saves." },
    { name: "Scavenger", text: "Favor on Endure saves against being sickened." },
  ], { d66: [61, 63] }),
  A("orc", "Orc", "Cryptid", "Medium", [
    { name: "Darksight", text: "Darkness does not blind you." },
    { name: "Beefy", text: "Favor on saves against being grappled or shoved, and on checks to grapple or shove." },
    { name: "Hulking", text: "+2 item slots." },
  ], { d66: [64, 66] }),
];
