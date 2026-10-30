import {canonical as lc, plainText} from "./data-model.mjs";
import {nativeKey} from "./native-keys.mjs";
const DAMAGE = {A:"acid",B:"bludgeoning",C:"cold",F:"fire",O:"force",L:"lightning",N:"necrotic",P:"piercing",I:"poison",Y:"psychic",R:"radiant",S:"slashing",T:"thunder"};
const PROPERTIES = {A:"amm",AF:"fir",BF:"brst",F:"fin",H:"hvy",L:"lgt",LD:"lod",R:"rch",RLD:"rel",S:"spc",T:"thr",V:"ver","2H":"two"};
const EQUIPMENT_CATEGORIES = {weaponSimple:["weapon","sim"],weaponMartial:["weapon","mar"],weaponSimpleMelee:["weapon","simpleM"],weaponMartialMelee:["weapon","martialM"],toolArtisan:["tool","art"],setGaming:["tool","game"],instrumentMusical:["tool","music"],focusSpellcastingArcane:["focus","arcane"],focusSpellcastingHoly:["focus","holy"],focusSpellcastingDruidic:["focus","druidic"]};
/** Source catalog membership for starting-equipment choices. No external item fallback. */
export function equipmentCategoryPool(records, category, owner) {
  const native=EQUIPMENT_CATEGORIES[category];if(!native)return [];
  const rule=r=>r._bccRules??(r.edition==="one"||r.srd52||r.basicRules2024?"2024":r.edition==="classic"||r.srd||r.basicRules?"2014":null);
  const score=r=>(lc(r.source)===lc(owner.source)?8:0)+(rule(r)&&rule(r)===rule(owner)?4:0)+(r._bccBaseEquipment?1:0);
  const names=new Map();
  for(const r of records) {
    const code=String(r.type??"").split("|")[0];
    if(r._bccIsGroup||r.reqAttune||r.bonusWeapon||r.bonusAc||r._bccBaseItem||r.rarity&&!["none","unknown"].includes(lc(r.rarity)))continue;
    const match=native[0]==="weapon"?["M","R"].includes(code)&&r.weaponCategory===(native[1].startsWith("sim")?"simple":"martial")&&(!native[1].endsWith("M")||code==="M"):
      native[0]==="tool"?({AT:"art",GS:"game",INS:"music"}[code]===native[1]):lc(r.scfType)===(native[1]==="druidic"?"druid":native[1]);
    if(!match)continue;
    const key=lc(r.name),old=names.get(key);if(!old||score(r)>score(old))names.set(key,r);
  }
  return [...names.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
export function itemType(r) {
  const type = String(r.type ?? "").split("|")[0].toUpperCase();
  if (["M","R"].includes(type)) return "weapon";
  if (["LA","MA","HA","S","SCF","RD","WD","RG","W"].includes(type)) return "equipment";
  if (["AT","T","GS","INS"].includes(type)) return "tool";
  if (["P","SC","FD","A"].includes(type) || r.miscTags?.includes("CNS")) return "consumable";
  if (r.containerCapacity || type === "C") return "container";
  return "loot";
}
export function damagePart(formula, type) {
  const value = String(formula ?? "").trim(), m = /^(\d+)d(\d+)(?:\s*([+-])\s*(.*))?$/.exec(value);
  if (m && [4,6,8,10,12,20,100].includes(Number(m[2]))) return {number:Number(m[1]),denomination:Number(m[2]),bonus:m[3] ? `${m[3] === "-" ? "-" : ""}${m[4]}` : "",types:type ? [type] : []};
  return {custom:{enabled:true,formula:value || "0"},types:type ? [type] : []};
}
export function buildEquipment(record, system, report) {
  const type = itemType(record), code = String(record.type ?? "").split("|")[0];
  system.quantity = 1;
  if (record.weight != null) system.weight = {value:Number(record.weight),units:"lb"};
  if (record.value != null) system.price = {value:Number(record.value)/100,denomination:"gp"};
  const rarity = lc(record.rarity).replaceAll(" ", "");
  if (["common","uncommon","rare","veryrare","legendary","artifact"].includes(rarity)) system.rarity = rarity;
  system.attunement = record.reqAttune ? "required" : "";
  if (record.bonusWeapon || record.bonusAc) system.magicalBonus = String(record.bonusWeapon ?? record.bonusAc);
  if (["weapon","equipment","consumable","container"].includes(type)) system.properties = [];
  if(code==="SCF")system.properties?.push("foc");
  if (record.bonusWeapon || record.bonusAc || record.wondrous || rarity && rarity !== "none") system.properties?.push("mgc");
  if (type === "weapon") {
    system.type = {value:`${record.weaponCategory === "martial" ? "martial" : "simple"}${code === "R" ? "R" : "M"}`,baseItem:nativeKey("weapon",record.name)?.key??system.identifier};
    system.properties.push(...(record.property ?? []).map(p => PROPERTIES[String(p).split("|")[0]]).filter(Boolean));
    const [normal,long] = String(record.range ?? "").split("/").map(Number);
    system.range = {value:normal || (code === "R" ? 0 : record.reach ?? 5),long:long || null,reach:Number(record.reach ?? 5),units:"ft"};
    system.mastery = String(record.mastery?.[0] ?? "").split("|")[0].toLowerCase();
    if (record.dmg1) system.damage = {base:damagePart(record.dmg1,DAMAGE[record.dmgType]),...(record.dmg2 ? {versatile:damagePart(record.dmg2,DAMAGE[record.dmgType])} : {})};
    system.activities = {bccWeaponAttack1:{_id:"bccWeaponAttack1",type:"attack",name:"Attack",activation:{type:"action",value:1},attack:{type:{value:code === "R" ? "ranged" : "melee",classification:"weapon"}},damage:{includeBase:true,parts:[]}}};
  } else if (type === "equipment") {
    const armor = {LA:"light",MA:"medium",HA:"heavy",S:"shield"}[code];
    system.type = {value:armor ?? (code === "SCF" ? "trinket" : "wondrous")};
    if (armor) system.armor = {value:Number(record.ac ?? 0),dex:code === "LA" ? null : code === "MA" ? 2 : 0,magicalBonus:String(record.bonusAc ?? "")};
    if (record.strength) system.strength = Number(record.strength);
    if (record.stealth) system.properties.push("stealthDisadvantage");
  } else if (type === "tool") {
    system.type = {value:({AT:"art",GS:"game",INS:"music"}[code] ?? ""),baseItem:nativeKey("tool",record.name)?.key??system.identifier};
    const ability = /Ability:?\s*(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)/i.exec(plainText(record.entries));
    if (ability) system.ability = ability[1].slice(0,3).toLowerCase();
  } else if (type === "consumable") {
    system.type = {value:({P:"potion",SC:"scroll",A:"ammo",FD:"food"}[code] ?? "trinket")};
    if (code === "A") {system.damage = {base:damagePart("0",DAMAGE[record.dmgType])};system.ammunition = {type:system.identifier};}
  } else if (type === "container") {
    const capacity = record.containerCapacity ?? {};
    const weight = capacity.weight?.[0] ?? capacity.weight;
    system.capacity = {weight:{value:typeof weight === "number" ? weight : Number(weight?.weight ?? 0),units:"lb"}};
  }
  if (record.charges != null) {
    const max = typeof record.charges === "number" ? String(record.charges) : String(record.charges).replace(/\{@dice ([^}|]+).*?\}/g,"$1");
    const period = ({dawn:"dawn",dusk:"dusk",midnight:"day",restlong:"lr",restshort:"sr","long rest":"lr","short rest":"sr"})[lc(record.recharge)];
    const amount=record.rechargeAmount,all=amount==null||lc(amount)==="all";
    const formula=typeof amount==="number"||typeof amount==="string"?String(amount).replace(/\{@dice ([^}|]+).*?\}/g,"$1"):null;
    const valid=all||formula!=null&&/^[\d\sdD+*/().-]+$/.test(formula);
    system.uses = {max,spent:0,recovery:period&&valid ? [{period,type:all?"recoverAll":"formula",...!all?{formula}:{}}] : []};
    if(!valid)report.incomplete.add(`${record.name}: unsupported charge-recovery formula withheld`);
    if (record.recharge && !period) report.incomplete.add(`${record.name}: unsupported recharge period ${record.recharge}`);
  }
  return type;
}
/** Equipment entries are flattened only into the native AND/OR graph, never into prose. */
export function buildStartingEquipment(record, index, lookup, report) {
  const source = record.startingEquipment, blocks = Array.isArray(source) ? source : source?.defaultData;
  if (!blocks?.length) {
    if (source) report.incomplete.add(`${record.name}: startingEquipment has no structured defaultData`);
    return [];
  }
  const entries = []; let sequence = 0;
  const add = (type, group, key, count) => {
    const _id = `eq${String(++sequence).padStart(14,"0")}`;
    entries.push({_id,type,group,sort:sequence*10000,...key != null ? {key} : {},...count != null ? {count:Number(count)} : {}}); return _id;
  };
  const root = add("AND",null);
  const ancestry = new Set();
  function unit(raw, group) {
    const value = typeof raw === "string" ? {item:raw} : raw;
    if (!value) return;
    if (value.value != null) {add("currency",group,"gp",Number(value.value)/100);return;}
    if (value.item) {
      const ref = lookup(index,"item",value.item,record.source);
      if (!ref) {report.unresolved.add(`${record.name}: starting equipment ${value.item}`);return;}
      if (ancestry.has(ref.key)) {report.incomplete.add(`${record.name}: circular equipment group ${value.item}`);return;}
      if (ref.record._bccGroupItems || ref.record.packContents) {
        ancestry.add(ref.key);
        const g = add(ref.record._bccGroupItems ? "OR" : "AND",group);
        const count = Number(value.quantity ?? 1);
        if (count !== 1 && ref.record._bccGroupItems) report.incomplete.add(`${record.name}: equipment group quantity ${count} requires review`);
        for (const child of ref.record._bccGroupItems ?? ref.record.packContents) unit(child,g);
        ancestry.delete(ref.key);
      } else add("linked",group,ref.uuid,value.quantity ?? 1);
      if (value.containsValue) add("currency",group,"gp",Number(value.containsValue)/100);
      return;
    }
    if (value.equipmentType) {
      const native = EQUIPMENT_CATEGORIES[value.equipmentType];
      const pool=equipmentCategoryPool(index.all.filter(e=>e.kind==="item").map(e=>e.record),value.equipmentType,record);
      if(native&&!pool.length){report.incomplete.add(`${record.name}: no imported candidates for equipment category ${value.equipmentType}`);return;}
      if(native?.[0]==="focus") {
        const choice=add("OR",group);
        for(const r of pool){const ref=lookup(index,"item",`${r.name}|${r.source}`,record.source);if(ref)add("linked",choice,ref.uuid,value.quantity??1);}
      }
      else if (native) add(native[0],group,native[1],value.quantity ?? 1);
      else report.incomplete.add(`${record.name}: unsupported equipment category ${value.equipmentType}`);
      return;
    }
    report.incomplete.add(`${record.name}: unstructured equipment entry ${String(value.special ?? JSON.stringify(value))}`);
  }
  for (const block of blocks) {
    const alternatives = Object.entries(block).filter(([,v]) => Array.isArray(v));
    const group = alternatives.length > 1 ? add("OR",root) : root;
    for (const [,items] of alternatives) {const g = add("AND",group);for (const item of items) unit(item,g);}
  }
  return entries;
}
