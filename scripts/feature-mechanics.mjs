import {plainText, canonical as lc, textOf} from "./data-model.mjs";
import {damagePart} from "./equipment.mjs";
const ABILITIES = {strength:"str",dexterity:"dex",constitution:"con",intelligence:"int",wisdom:"wis",charisma:"cha"};
const DAMAGE = "acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder";
export function availableLevel(record) {
  const levels = (record.prerequisite ?? []).map(p => typeof p.level === "number" ? p.level : Number(p.level?.level ?? 0));
  const first=Array.isArray(record.entries)?record.entries.find(v=>typeof v==="string")??record.entries[0]:record.entries;
  const prose = plainText(first);
  const m = /^\s*(?:(?:when you reach|once you reach|starting at|beginning at|at)\s+(?:(?:character|class)\s+)?(?:level\s+(\d+)|(\d+)(?:st|nd|rd|th)?\s+level))/i.exec(prose);
  return Number(record._bccGrantLevel ?? record.level ?? (levels.length && levels.every(x => x > 0) ? Math.min(...levels) : m?.[1]??m?.[2]??0));
}
export function prerequisites(record, report, slug) {
  const alternatives = record.prerequisite ?? [];
  const level = availableLevel(record), items = new Set();
  if (alternatives.length === 1) for (const [key, value] of Object.entries(alternatives[0])) {
    if (key === "level") {}
    else if (["feat","feature","optionalfeature","spell"].includes(key)) for (const uid of Array.isArray(value) ? value : [value]) items.add(`${key==="spell"?"spell":"feat"}:${slug(String(uid).split("|")[0].replace(/#.*$/,""))}`);
    else if (key !== "level") report.incomplete.add(`${record.name}: prerequisite ${key} retained in provenance; not representable by native item/level prerequisites`);
  }
  if (alternatives.length > 1) report.incomplete.add(`${record.name}: alternative prerequisite expression retained; native level is its common lower bound`);
  return {level,items:[...items],repeatable:!!record.repeatable || /you can (?:gain|take) this (?:invocation|feat|feature) more than once/i.test(plainText(record.entries))};
}
export function resourceUses(record) {
  const text = plainText(record.entries), low = text.toLowerCase();
  const rest = /(?:short or long|short|long) rest/i.exec(text)?.[0].toLowerCase();
  const period = rest?.includes("short") ? "sr" : rest ? "lr" : null;
  let max = record.uses?.max ?? record.charges;
  if (max == null && period) {
    if (/number of times equal to (?:your )?proficiency bonus/i.test(text)) max = "@prof";
    const ability = /number of times equal to (?:your )?(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) modifier/i.exec(text);
    if (ability) max = `max(1, @abilities.${ABILITIES[lc(ability[1])]}.mod)`;
    const count = /(?:use[^.]{0,80}?|do so) (once|twice|three times|\d+ times)/i.exec(text);
    if (max == null && count) max = ({once:1,twice:2,"three times":3})[lc(count[1])] ?? parseInt(count[1]);
    if (max == null && /(?:once you use|once you transform|can't use (?:it|this)[^.]*again until|cannot use (?:it|this)[^.]*again until)/i.test(text)) max = 1;
  }
  if (max == null || typeof max === "object") return null;
  return {max:String(max),spent:0,recovery:resourceRecovery(record)};
}
export function resourceRecovery(record){
  const text=plainText(record.entries),recoveries=[];
  const pattern=/regain\s+(all|one|two|three|\d+)\s+([a-z' ]{0,45}?)\b(?:uses?|charges?|points?)\b[^.]{0,100}?(short|long) rest/gi;
  for(const match of text.matchAll(pattern)){
    if(/\bhit\b/i.test(match[2]))continue;
    const period=lc(match[3])==="short"?"sr":"lr",count=({one:1,two:2,three:3})[lc(match[1])]??Number(match[1]);
    recoveries.push({period,type:lc(match[1])==="all"?"recoverAll":"formula",...(lc(match[1])==="all"?{}:{formula:String(count)})});
  }
  if(recoveries.length)return [...new Map(recoveries.map(r=>[JSON.stringify(r),r])).values()];
  const rest=/(?:short or long|short|long) rest/i.exec(text)?.[0];
  return rest?[{period:/short/i.test(rest)?"sr":"lr",type:"recoverAll"}]:[];
}
export function genericActivity(record, {activation, ability, attackBonus, saveDC, actor = false} = {}) {
  const raw = textOf(record.entries), text = plainText(record.entries);
  const attack = /\{@(?:atk|atkr)\s+([^}]+)\}/i.exec(raw);
  const save = /\{@actSave\s+([a-z]+)/i.exec(raw) ?? /(?:DC\s+\d+\s+)?(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw/i.exec(text);
  const damage = [...raw.matchAll(new RegExp(`\\{@damage\\s+([^}|]+)(?:\\|[^}]*)?\\}\\s+(${DAMAGE})?`,"gi"))];
  const heal = /(?:regains?|restore)[^.]*hit points/i.test(text);
  const action = activation ?? (/\b(?:bonus action|Bonus Action)\b/.test(text) ? "bonus" : /\breaction\b/i.test(text) ? "reaction" : /\b(?:as an? action|as a Magic action|take the Magic action)\b/i.test(text) ? "action" : null);
  const uses = resourceUses(record);
  if (!attack && !save && !damage.length && !heal && !action && !uses) return null;
  const type = attack ? "attack" : save ? "save" : heal ? "heal" : damage.length ? "damage" : "utility";
  const result = {_id:"bccBasicActivity",name:record.name,type,activation:{type:action ?? (actor ? "action" : ""),value:1}};
  const duration = /(?:lasts? for|for the next|for)\s+(\d+)\s+(round|minute|hour|day)s?\b/i.exec(text);
  if (duration) result.duration = {value:duration[1],units:duration[2]};
  const reach = /reach\s+(\d+)\s*ft/i.exec(text), range = /range\s+(\d+)(?:\/(\d+))?\s*ft/i.exec(text);
  if (reach || range) result.range = {value:String(reach?.[1] ?? range[1]),long:range?.[2],units:"ft"};
  if (attack) {
    const hit = /\{@hit\s+([+-]?\d+)/i.exec(raw);
    result.attack = {type:{value:/r/i.test(attack[1]) && !/m/i.test(attack[1]) ? "ranged" : "melee",classification:/s/i.test(attack[1]) ? "spell" : "weapon"}};
    if (ability) result.attack.ability = ability;
    if (hit || attackBonus != null) { result.attack.flat = true; result.attack.bonus = String(hit?.[1] ?? attackBonus); }
  }
  if (save) {
    const dc = /\{@dc\s+(\d+)/i.exec(raw) ?? /\bDC\s+(\d+)/i.exec(text);
    const stat = ABILITIES[lc(save[1])] ?? lc(save[1]);
    result.save = {ability:[stat],dc:{calculation:dc || saveDC ? "flat" : "spellcasting",...(dc || saveDC ? {formula:String(dc?.[1] ?? saveDC)} : {})}};
  }
  const formula = s=>s.replace(/\bsummonSpellLevel\b/g,"0").replace(/\bPB\b/g,"@prof");
  const simultaneous=damage.filter((m,i)=>{if(!i)return true;const previous=damage[i-1],between=plainText(raw.slice(previous.index+previous[0].length,m.index));return /\b(?:plus|and)\b/i.test(between)&&! /\b(?:or|if|saving throw|turn|each|instead|then)\b/i.test(between);});
  if(simultaneous.length!==damage.length)(record._bccActivityIssues??=[]).push("Alternative or conditional damage is preserved in the description; only simultaneous primary damage is rolled");
  const parts = simultaneous.map(m => damagePart(formula(m[1]),lc(m[2])));
  if(!parts.length&&heal){const d=/\{@dice\s+([^}|]+)/i.exec(raw);if(d)parts.push(damagePart(formula(d[1]),"healing"));}
  if (parts.length) {
    if (type === "heal") result.healing = parts[0];
    else result.damage = {parts,includeBase:false,...type === "save" ? {onSave:/half as much|half damage/i.test(text) ? "half" : "none"} : {}};
  }
  if (uses) result.consumption = {targets:[{type:"itemUses",value:"1"}]};
  return result;
}
export function buildFeature(record, system, report, slug, kind) {
  system.prerequisites = prerequisites(record,report,slug);
  system.type = {value:kind === "raceFeature" ? "race" : kind === "feat" ? "feat" : "class",subtype:kind === "feat" ? ({O:"origin",G:"general",FS:"fightingStyle",EB:"epicBoon"}[record.category] ?? "") : ""};
  system.requirements = record.className ?? record.raceName ?? "";
  for(const issue of record._bccActivityIssues??[])report.incomplete.add(`${record.name}: ${issue}`);
  const uses = resourceUses(record); if (uses && !record._bccChoiceTemplate) system.uses = uses;
  if (!record._bccChoiceTemplate) {
    const activity = genericActivity(record);
    if (activity) system.activities = {[activity._id]:activity};
    for(const issue of record._bccActivityIssues??[])report.incomplete.add(`${record.name}: ${issue}`);
  }
}
export function addProgressionScales(record, adv, add, slug) {
  const fields = [[record.cantripProgression,"Cantrips Known","cantrips-known"],[record.preparedSpellsProgression ?? record.spellsKnownProgression,"Maximum Prepared Spells","max-prepared"]];
  for (const [values,name,identifier] of fields) if (Array.isArray(values)) {
    const scale = Object.fromEntries(values.map((value,i) => [String(i+1),{value:Number(value)||0}]));
    add(adv,{type:"ScaleValue",name,level:0,configuration:{identifier,type:"number",scale},value:{}});
  }
  for (const group of record.classTableGroups ?? []) for (const [column,label] of (group.colLabels ?? []).entries()) {
    const name = plainText(label), values = (group.rows ?? []).map(row => row[column]);
    if (!values.length || !values.every(v => typeof v === "number" || /^\d+$/.test(String(v)))) continue;
    const identifier = slug(name);
    if (Object.values(adv).some(a => a.configuration?.identifier === identifier)) continue;
    add(adv,{type:"ScaleValue",name,level:0,configuration:{identifier,type:"number",scale:Object.fromEntries(values.map((v,i) => [i+1,{value:Number(v)}]))},value:{}});
  }
}

export function resourceScales(classRecord,index,slug){
  const groups=new Map();
  for(const e of index.byKey.values())if(e.kind==="classFeature"&&lc(e.record.className)===lc(classRecord.name)&&lc(e.record.classSource)===lc(classRecord.source)){
    const uses=resourceUses(e.record);if(!uses||!/^\d+$/.test(uses.max))continue;
    const key=slug(e.record.name);if(!groups.has(key))groups.set(key,{name:e.record.name,scale:{}});
    groups.get(key).scale[e.record.level]={value:Number(uses.max)};
  }
  return [...groups].filter(([,g])=>Object.keys(g.scale).length>1).map(([identifier,g])=>({type:"ScaleValue",name:g.name,level:0,configuration:{identifier,type:"number",scale:g.scale},value:{}}));
}
