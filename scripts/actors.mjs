import {bindEmbeddedResources} from "./resource-bindings.mjs";
import {clone, plainText, textOf, canonical as lc} from "./data-model.mjs";
import {genericActivity, resourceUses} from "./feature-mechanics.mjs";
const ABILITIES = ["str","dex","con","int","wis","cha"];
const SKILLS = {acrobatics:["acr","dex"],"animal handling":["ani","wis"],arcana:["arc","int"],athletics:["ath","str"],deception:["dec","cha"],history:["his","int"],insight:["ins","wis"],intimidation:["itm","cha"],investigation:["inv","int"],medicine:["med","wis"],nature:["nat","int"],perception:["prc","wis"],performance:["prf","cha"],persuasion:["per","cha"],religion:["rel","int"],"sleight of hand":["slt","dex"],stealth:["ste","dex"],survival:["sur","wis"]};
const SIZES = {T:"tiny",S:"sm",M:"med",L:"lg",H:"huge",G:"grg"};
async function localId(text) {const a = new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text)));return [...a.slice(0,8)].map(x => x.toString(16).padStart(2,"0")).join("");}
function crValue(value) {const s = String(typeof value === "object" ? value.cr ?? "0" : value ?? "0");const [a,b] = s.split("/").map(Number);return b ? a/b : a || 0;}
const mod = value => Math.floor((Number(value ?? 10)-10)/2);
export async function buildActor(entry, index, content, report, helpers) {
  const {record:r,kind,_id} = entry, {convert,lookup,render} = helpers;
  const vehicle = kind === "object" || kind === "vehicle" && !["CREATURE"].includes(r.vehicleType);
  const type = vehicle ? "vehicle" : "npc", cr = crValue(r.cr), prof = Math.max(2,Math.ceil(cr/4)+1);
  const abilities = Object.fromEntries(ABILITIES.map(a => {
    const target=Number(r.save?.[a]),proficient=Number.isFinite(target)&&target-mod(r[a])>=prof?1:0;
    return [a,{value:Number(r[a]??10),proficient,...Number.isFinite(target)?{save:{roll:{bonus:String(target-mod(r[a])-proficient*prof)}}}:{}}];
  }));
  const stats = r.hull ?? r, hp = typeof stats.hp === "number" ? stats.hp : stats.hp?.average ?? (/^\d+/.exec(stats.hp?.special??"")?.[0]);
  const acRaw = Array.isArray(stats.ac) ? stats.ac[0] : stats.ac;
  const ac = typeof acRaw === "number" ? acRaw : acRaw?.ac ?? (/^\d+/.exec(acRaw?.special??"")?.[0]);
  const system = {abilities,source:{book:r.source ?? "",page:String(r.page ?? ""),...(r._bccRules?{rules:r._bccRules}:r.edition === "one"?{rules:"2024"}:{})},
    attributes:{ac:{calc:"flat",calcs:["flat"],flat:Number(ac ?? 10)},hp:{value:Number(hp ?? 0),max:Number(hp ?? 0),temp:0,...!vehicle ? {formula:r.hp?.formula ?? ""} : {}}},
    details:{biography:{value:render(r.entries ?? [],index,r.source,report)}},traits:{size:SIZES[r.size?.[0] ?? r.size] ?? "med"}};
  if (hp == null || ac == null) report.incomplete.add(`${r.name}: dynamic or missing ${hp == null ? "HP" : "AC"} requires summon/component formula binding`);
  const speeds = {}, speed = typeof r.speed === "number" ? {walk:r.speed} : r.speed ?? {};
  for (const [key,value] of Object.entries(speed)) if (["walk","fly","swim","climb","burrow"].includes(key)) {
    if (typeof value === "number") speeds[key] = String(value);
    else if (typeof value?.number === "number") {speeds[key] = String(value.number);if (value.condition) report.incomplete.add(`${r.name}: conditional movement ${key}: ${value.condition}`);}
  }
  system.attributes.movement = {speeds,units:"ft",hover:!!speed.canHover};
  if (!vehicle) {
    system.details.cr = cr;
    system.details.type = {value:typeof r.type === "string" ? r.type : r.type?.type ?? "custom",subtype:(r.type?.tags ?? []).map(t => typeof t === "string" ? t : t.tag).join(", ")};
    system.details.alignment = (r.alignment ?? []).map(a => typeof a === "string" ? ({L:"Lawful",N:"Neutral",C:"Chaotic",G:"Good",E:"Evil",U:"Unaligned",A:"Any Alignment"}[a]??a) : JSON.stringify(a)).join(" ");
    system.skills = {};
    for (const [name,bonus] of Object.entries(r.skill ?? {})) {
      const mapped = SKILLS[lc(name)]; if (!mapped || !Number.isFinite(Number(bonus))) continue;
      const p = (Number(bonus)-mod(r[mapped[1]]))/prof;
      const proficiency = p >= 2 ? 2 : p >= 1 ? 1 : 0;
      system.skills[mapped[0]] = {value:proficiency,ability:mapped[1],roll:{bonus:String(Number(bonus)-mod(r[mapped[1]])-proficiency*prof)}};
    }
    const senses = {units:"ft",special:""};
    for (const sense of r.senses ?? []) {const m = /(darkvision|blindsight|tremorsense|truesight)\s+(\d+)/i.exec(sense);if (m) senses[lc(m[1])] = Number(m[2]);else senses.special += `${sense}; `;}
    system.attributes.senses = senses;
    system.traits.languages = {value:(r.languages ?? []).map(lc).filter(x => /^[a-z]+$/.test(x)),custom:(r.languages ?? []).filter(x => !/^[a-z]+$/i.test(x)).join("; ")};
    system.resources = {legact:{max:Number(r.legendaryActions ?? (r.legendary?.length ? 3 : 0)),spent:0},legres:{max:Number(r.legendaryResistances ?? 0),spent:0}};
    if(r.traitTags?.includes("Legendary Resistances")){
      const trait=(r.trait??[]).find(t=>/choose to succeed/i.test(plainText(t.entries)));
      const count=/\((\d+)\/Day\)/i.exec(trait?.name??"")?.[1];if(count)system.resources.legres.max=Number(count);
    }
  } else {
    system.details.type = /air|spelljammer/i.test(r.vehicleType ?? "") ? "air" : /land|infwar/i.test(r.vehicleType ?? "") ? "land" : "water";
    system.attributes.capacity = {cargo:{value:Number(r.capCargo ?? 0),units:"tn"},creature:String(r.capCreature ?? "")};
    if (stats.dt != null) system.attributes.hp.dt = Number(stats.dt);
  }
  for (const [input,output] of [["resist","dr"],["immune","di"],["vulnerable","dv"],["conditionImmune","ci"]]) {
    const values = (r[input] ?? []).filter(x => typeof x === "string");
    const conditional = (r[input] ?? []).filter(x => typeof x === "object");
    system.traits[output] = {value:values,custom:conditional.map(x => JSON.stringify(x)).join("; ")};
    if (conditional.length) report.incomplete.add(`${r.name}: conditional ${input} retained as custom trait`);
  }
  const items = [], embedded = new Map();
  async function feature(record, activation, group, i) {
    const id = await localId(`${entry.key}:${group}:${i}:${record.name}`);
    const description = render(record.entries ?? [],index,r.source,report);
    const data = {_id:id,name:record.name ?? group,type:"feat",sort:items.length*10000,system:{identifier:`bcc-${id}`,type:{value:vehicle ? "vehicle" : "monster"},description:{value:description}},flags:{bcc:{component:group}}};
    const uses = resourceUses(record); if (uses) data.system.uses = uses;
    const daily=/\((\d+)\/(?:Day|Short Rest|Long Rest)\)/i.exec(record.name??"");
    if(daily)data.system.uses={max:daily[1],spent:0,recovery:[{period:/Short Rest/i.test(daily[0])?"sr":/Long Rest/i.test(daily[0])?"lr":"day",type:"recoverAll"}]};
    const recharge = /\{@recharge\s*(\d+)?\}/i.exec(record.name ?? "");
    if (recharge) data.system.uses = {max:"1",spent:0,recovery:[{period:"recharge",type:"recoverAll",formula:recharge[1] ?? "6"}]};
    const activity = genericActivity(record,{activation,actor:true});
    if (activity) {
      if (data.system.uses?.max) activity.consumption = {targets:[{type:"itemUses",value:"1"}]};
      if (activation === "legendary") {
        const cost = /Costs (\d+) Actions/i.exec(record.name ?? "")?.[1] ?? "1";
        activity.consumption = {targets:[{type:"attribute",target:"resources.legact.value",value:cost}]};
      }
      data.system.activities = {[activity._id]:activity};
    }
    for(const issue of record._bccActivityIssues??[])report.incomplete.add(`${r.name} / ${record.name}: ${issue}`);
    items.push(data); return data;
  }
  for (const [group,activation] of [["trait",""],["action","action"],["bonus","bonus"],["reaction","reaction"],["legendary","legendary"],["mythic","mythic"]])
    for (const [i,record] of (r[group] ?? []).entries()) await feature(record,activation,group,i);
  if (r._bccLegendary) for (const [group,activation] of [["lairActions","lair"],["regionalEffects",""]]) {
    const rows = r._bccLegendary[group] ?? [];
    await feature({name:group === "lairActions" ? "Lair Actions" : "Regional Effects",entries:rows},activation,group,0);
    if (!vehicle && group === "lairActions" && rows.length) system.resources.lair = {value:true,initiative:20,inside:false};
  }
  for (const group of ["control","movement","weapon","other"]) for (const [i,component] of (r[group] ?? []).entries()) {
    if (typeof component !== "object") continue;
    await feature({name:component.name ?? group,entries:component.entries ?? []},"action",group,i);
    for(const [ai,action] of (component.action??[]).entries())await feature(typeof action==="string"?{name:component.name??group,entries:[action]}:action,"action",`${group}-action-${i}`,ai);
    if(component.hp!=null||component.ac!=null)report.incomplete.add(`${r.name}: ${component.name??group} component HP/AC retained in source; native station mechanics require validation`);
  }
  const references = [];
  for (const casting of r.spellcasting ?? []) {
    await feature({name:casting.name ?? "Spellcasting",entries:[...(casting.headerEntries ?? []),...(casting.footerEntries ?? [])]},"","spellcasting",items.length);
    const ability = casting.ability ?? r.spellcastingAbility ?? "int";
    system.attributes.spellcasting ??= ability;
    if (!vehicle) system.attributes.spell = {level:Number(casting.level ?? casting.casterLevel ?? r.spellcastingLevel ?? (/(\d+)(?:st|nd|rd|th)-level spellcaster/i.exec(plainText(casting.headerEntries))?.[1]) ?? 0)};
    const declaredDC=/\{@dc\s+(\d+)/i.exec(textOf(casting.headerEntries));
    if(declaredDC){const delta=Number(declaredDC[1])-8-prof-mod(r[ability]);system.bonuses={spell:{dc:String(delta)}};}
    for (const [level,group] of Object.entries(casting.spells ?? {})) {
      if (Number(level)>0 && group.slots != null) {system.spells ??= {};system.spells[`spell${level}`] = {value:Number(group.slots),override:Number(group.slots)};}
      for (const uid of group.spells ?? []) references.push({uid,ability,method:"spell"});
    }
    for (const [key,method] of [["will","atwill"],["constant","atwill"],["ritual","ritual"]]) for (const uid of casting[key] ?? []) references.push({uid,ability,method});
    for (const [key,period] of [["daily","day"],["rest","sr"],["weekly",null]]) for (const [count,spells] of Object.entries(casting[key] ?? {})) {
      for (const uid of spells) references.push({uid,ability,method:"innate",count:parseInt(count),period});
      if(key==="weekly")report.incomplete.add(`${r.name}: weekly spell uses require manual recovery; no native weekly recovery period`);
      if (!count.endsWith("e") && spells.length>1) report.incomplete.add(`${r.name}: shared ${key} spell-use pool ${count} needs joint resource binding`);
    }
  }
  for (const spec of references) {
    const tag = /\{@spell\s+([^}]+)\}/i.exec(spec.uid), uid = tag?.[1] ?? spec.uid;
    const ref = lookup(index,"spell",uid,r.source);
    if (!ref) {report.unresolved.add(`${r.name}: spell ${uid}`);continue;}
    const spell = await convert(ref,index,content,report);
    spell._id = await localId(`${entry.key}:spell:${uid}:${spec.method}:${spec.count ?? ""}`);
    if (embedded.has(spell._id)) continue; embedded.set(spell._id,true);
    spell._stats = {compendiumSource:ref.uuid}; spell.flags.bcc.actorOrigin = ref.uuid;
    spell.system.method = spec.method; spell.system.ability = spec.ability;spell.system.prepared = 2;
    if (spec.count) {
      spell.system.uses = {max:String(spec.count),spent:0,recovery:spec.period?[{period:spec.period,type:"recoverAll"}]:[]};
      for (const a of Object.values(spell.system.activities ?? {})) a.consumption = {targets:[{type:"itemUses",value:"1"}],spellSlot:false};
    }
    items.push(spell);
  }
  const equipment = [];
  for (const value of r.attachedItems ?? []) equipment.push(typeof value === "string" ? {item:value} : value);
  for (const value of r.gear ?? []) equipment.push(typeof value === "string" ? {item:value} : value);
  const gear=new Map();
  for(const raw of equipment){const uid=raw.item??raw.name,prior=gear.get(lc(uid));if(!prior||Number(raw.quantity??1)>Number(prior.quantity??1))gear.set(lc(uid),raw);}
  for (const raw of gear.values()) {
    const ref = lookup(index,"item",raw.item ?? raw.name,r.source);
    if (!ref || ref.virtual) {report.unresolved.add(`${r.name}: equipment ${raw.item ?? raw.name}`);continue;}
    const item = await convert(ref,index,content,report);
    item._id = await localId(`${entry.key}:equipment:${ref.key}`);
    item._stats = {compendiumSource:ref.uuid};item.system.quantity = Number(raw.quantity ?? 1);item.system.equipped = true;
    if(item.type==="container"&&item.system.quantity>1){report.incomplete.add(`${r.name}: multiple ${item.name} containers need separate native instances; quantity reduced to one`);item.system.quantity=1;}
    if (!items.some(x => x._id === item._id)) items.push(item);
  }
  if (r.spellcastingHidden) report.incomplete.add(`${r.name}: hidden spellcasting metadata requires verification`);
  bindEmbeddedResources(items);
  return {_id,name:r.name,type,system,items,flags:{bcc:{sourceId:content.sourceId,category:kind,identity:entry.key,converterVersion:"0.0.11",dependency:!!r._bccDependency}},prototypeToken:{name:r.name,actorLink:false}};
}
