import {entitlementEffects} from "./grant-policy.mjs";
import {buildActor} from "./actors.mjs";
import {prepareNativeKeys} from "./native-keys.mjs";
import {addItemSpellActivities} from "./item-spells.mjs";
import {upsertScaleValue,consolidateScaleValues} from "./advancements.mjs";
import {applyNativeTraits} from "./traits.mjs";
import {addSpellRecipes, expandedSpellPool, preferredCandidates} from "./additional-spells.mjs";
import {packAddress, WORLD_DESTINATION} from "./destination.mjs";
import {findSupplement} from "./library-source.mjs";
import {speciesGraph} from "./species.mjs";
import {buildEquipment, buildStartingEquipment, itemType} from "./equipment.mjs";
import {availableLevel, buildFeature, addProgressionScales, resourceUses, resourceRecovery, resourceScales, genericActivity} from "./feature-mechanics.mjs";
import {plainText, clone, merge, canonical as lc, DEFAULT_SOURCES} from "./data-model.mjs";
import {synthesizeSpell} from "./spell-activities.mjs";
/** Early-stage native D&D5e converter. Never ships or embeds source-book content. */
const PACK_DEFS = {
  race: ["species", "Species", "Item", "race"],
  background: ["backgrounds", "Backgrounds", "Item", "background"],
  feat: ["feats", "Feats", "Item", "feat"],
  optionalfeature: ["optional-features", "Optional Features", "Item", "feat"],
  class: ["classes", "Classes", "Item", "class"],
  subclass: ["subclasses", "Subclasses", "Item", "subclass"],
  classFeature: ["class-features", "Class Features", "Item", "feat"],
  subclassFeature: ["subclass-features", "Subclass Features", "Item", "feat"],
  raceFeature: ["species-features", "Species Features", "Item", "feat"],
  spell: ["spells", "Spells", "Item", "spell"],
  item: ["equipment", "Items & Equipment", "Item", "loot"],
  monster: ["actors", "Actors & Monsters", "Actor", "npc"],
  object: ["objects", "Objects", "Actor", "npc"],
  vehicle: ["vehicles", "Vehicles", "Actor", "vehicle"],
  spellList: ["book", "Book & Chapters", "JournalEntry", ""],
  chapter: ["book", "Book & Chapters", "JournalEntry", ""]
};
const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const SKILL_MAP = {
  "acrobatics":"acr", "animal handling":"ani", "arcana":"arc", "athletics":"ath", "deception":"dec",
  "history":"his", "insight":"ins", "intimidation":"itm", "investigation":"inv", "medicine":"med",
  "nature":"nat", "perception":"prc", "performance":"prf", "persuasion":"per", "religion":"rel",
  "sleight of hand":"slt", "stealth":"ste", "survival":"sur"
};
const SIZE_MAP = {T:"tiny", S:"sm", M:"med", L:"lg", H:"huge", G:"grg"};
const SCHOOL_MAP = {A:"abj", C:"con", D:"div", E:"enc", V:"evo", I:"ill", N:"nec", T:"trs"};
const CLEAN_TAGS = /\{@([\w-]+)\s+([^{}]+)\}/g;
const safe = v => String(v ?? "").replace(/[&<>"']/g, x => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[x]);
const slug = str => String(str).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 65);
const canon = value => String(value ?? "").trim().toLowerCase();
async function idFor(text) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].slice(0, 8).map(v => v.toString(16).padStart(2,"0")).join("");
}
function entityKey(category, r) {
  return [category, r.source, r.name, r.className ?? "", r.classSource ?? "",
    r.subclassShortName ?? r.shortName ?? "", r.subclassSource ?? "", r.level ?? "", r.raceName ?? ""].map(canon).join("|");
}
function originFlags(cat, record, book) {
  return {bcc: {sourceId: book, category: cat, identity: entityKey(cat, record),
    originalName: record.name, rules: record.edition ?? record._bccRules ?? "unspecified", importedAt: new Date().toISOString()}};
}
function raceFeatures(races) {
  const out=[];
  for(const race of races) for(const entry of race.entries ?? []) {
    if (entry && typeof entry === "object" && entry.name && Array.isArray(entry.entries) && entry.type === "entries")
      out.push({name: entry.name, source: race.source, page: race.page, raceName: race.name,
        entries: entry.entries});
  }
  return out;
}
export async function buildIndex(content, destination = WORLD_DESTINATION) {
  await prepareNativeKeys();
  const graph = speciesGraph(content.records.race);
  const extraOptions=[];
  const records = {...content.records, race:graph.races.map(clone), raceFeature: graph.features,
    spellList:[],
    chapter: content.chapters.map((entry, i) => ({name: entry.name || `Section ${i + 1}`, source:content.sourceId,
      page: entry.page, entries: entry.entries, chapter: entry, sequence:i}))};
  const lists=[];
  for(const [kind,rows] of [["class",records.class],["subclass",records.subclass]])for(const r of rows)if(r.casterProgression||r.additionalSpells?.some(b=>b.expanded))lists.push({pageId:await idFor(`spell-list:${entityKey(kind,r)}`),name:r.name,source:r.source,_bccRules:r._bccRules,identifier:r.foundryIdentifier??findSupplement(kind,r,content.foundry)?.identifier??slug(r.name),className:r.className??r.name,classSource:r.classSource??r.source,ownerName:r.name,listType:kind,additionalSpells:clone(r.additionalSpells??[])});
  if(lists.length)records.spellList.push({name:"Spell Lists",source:content.sourceId,lists});
  for(const [kind,rows] of Object.entries(records))if(kind!=="spellList")for(const record of rows){
    if((record.additionalSpells?.length??0)>1){
      record._bccAdditionalOptions=record.additionalSpells.map((block,i)=>`${record.name}: ${block.name??`Spellcasting Option ${i+1}`}`);
      for(const [i,block] of record.additionalSpells.entries())extraOptions.push({name:record._bccAdditionalOptions[i],source:record.source,edition:record.edition,entries:[],_bccGrantText:clone(record.entries??[]),_bccImageParent:{kind,name:record.name,source:record.source},additionalSpells:[clone(block)],_bccDependency:record._bccDependency,_bccRules:record._bccRules,_bccAuxiliary:true});
    }
  }
  records.optionalfeature=[...records.optionalfeature,...extraOptions];
  const byKey = new Map(); const byShort = new Map(); const packKeys = new Map();
  const sid = slug(content.sourceId);
  for (const [kind, list] of Object.entries(records)) {
    if (!PACK_DEFS[kind]) continue;
    const [suffix] = PACK_DEFS[kind];
    const {packName,packId,package:packageName} = packAddress(content.sourceId,suffix,destination);
    packKeys.set(kind, {packName, packId, package:packageName, ...Object.fromEntries(["suffix","label","docType","itemType"].map((k,i)=>[k,PACK_DEFS[kind][i]]))});
    for (const record of list) {
      const key = entityKey(kind, record);
      if(byKey.has(key)) continue;
      const _id = await idFor(`${content.sourceId}:${key}`);
      const item = {kind, record, key, _id, packId, virtual:!!record._bccIsGroup||!!record._bccIgnored||!!record._bccSpeciesTemplate, uuid:`Compendium.${packId}.${PACK_DEFS[kind][2]}.${_id}`};
      byKey.set(key,item);
      const shortKey = `${kind}|${canon(record.source)}|${canon(record.name)}`;
      if(!byShort.has(shortKey)) byShort.set(shortKey, []);
      byShort.get(shortKey).push(item);
    }
  }
  return {records, byKey, byShort, packKeys, destination, proficiencyItems:content.proficiencyItems??{}, spellLookup:content.spellLookup, all:[...byKey.values()].filter(e=>!e.virtual)};
}
function locate(index, kind, name, source) {
  const all = index.byShort.get(`${kind}|${canon(source)}|${canon(name)}`) ?? [];
  return all.length === 1 ? all[0] : null;
}
function lookupUid(index, kind, uid, fallbackSource) {
  const parts=String(uid ?? "").replace(/#.*$/,"").split("|");
  if(kind === "classFeature") {
    // Feature Name | Class | Class Source | Level
    const [name,className,source,level] = parts; const classSource=source||"PHB";
    return [...index.byKey.values()].find(it=>it.kind===kind && canon(it.record.name)===canon(name)
      && canon(it.record.className)===canon(className) && canon(it.record.classSource)===canon(classSource)
      && canon(it.record.source)===canon(parts[4]||classSource)
      && Number(it.record.level)===Number(level)) ?? null;
  }
  if(kind === "subclassFeature") {
    const [name,className,cs,shortName,ss,level] = parts; const classSource=cs||"PHB",subclassSource=ss||classSource;
    return [...index.byKey.values()].find(it=>it.kind===kind && canon(it.record.name)===canon(name)
      && canon(it.record.className)===canon(className) && canon(it.record.classSource)===canon(classSource)
      && canon(it.record.subclassShortName)===canon(shortName) && canon(it.record.subclassSource)===canon(subclassSource)
      && canon(it.record.source)===canon(parts[6]||subclassSource)
      && Number(it.record.level)===Number(level)) ?? null;
  }
  const name = parts[0];const source = parts[1] || DEFAULT_SOURCES[kind] || fallbackSource;
  return locate(index,kind,name,source) ?? (parts[1]?null:locate(index,kind,name,fallbackSource)) ?? (kind==="feat" && name.includes(";") ? locate(index,kind,name.split(";")[0],source):null);
}
function linkedText(inner,index,category,source) {
  const parts=inner.split("|");const name=parts[0]?.trim()??"";const ref=lookupUid(index,category,inner,source);
  return ref && !ref.virtual ? `@UUID[${ref.uuid}]{${safe(name)}}` : safe(name);
}
function convertTags(input, index, source, report) {
  const token=/\{@([\w-]+)\s+([^{}]+)\}/g;
  let pos=0,html="",match;
  const raw=String(input ?? "");
  while((match=token.exec(raw))!==null){
    html+=safe(raw.slice(pos,match.index));const kind=match[1], value=match[2];
    const refKinds={race:"race",background:"background",feat:"feat",class:"class",subclass:"subclass",spell:"spell",item:"item",creature:"monster",monster:"monster",optionalfeature:"optionalfeature"};
    if(refKinds[kind]) html+=linkedText(value,index,refKinds[kind],source);
    else if(["b","bold"].includes(kind)) html+=`<strong>${safe(value)}</strong>`;
    else if(["i","italic"].includes(kind)) html+=`<em>${safe(value)}</em>`;
    else if(kind==="damage"||kind==="dice") html+=`<code>${safe(value.split("|")[0])}</code>`;
    else html+=safe(value.split("|")[0]);
    pos=token.lastIndex;
  }
  return html+safe(raw.slice(pos));
}
function renderEntries(entries,index,source,report, depth=0){
  if(depth>12)return "";
  if(typeof entries === "string"||typeof entries === "number")return `<p>${convertTags(entries,index,source,report)}</p>`;
  if(Array.isArray(entries))return entries.map(it=>renderEntries(it,index,source,report,depth+1)).join("\n");
  if(!entries||typeof entries!=="object")return "";
  switch(entries.type){
    case "entries":case "section":case "inset":case "insetReadaloud":case "abilityGeneric":{
      const heading=entries.name?`<h${Math.min(6,depth+2)}>${safe(entries.name)}</h${Math.min(6,depth+2)}>`:"";
      return heading+renderEntries(entries.entries??entries.entry??[],index,source,report,depth+1);
    }
    case "list":return `<ul>${(entries.items??[]).map(v=>`<li>${typeof v==="string"?convertTags(v,index,source,report):renderEntries(v,index,source,report,depth+1)}</li>`).join("")}</ul>`;
    case "item":return `<p><strong>${safe(entries.name)}</strong> ${renderEntries(entries.entries??entries.entry??[],index,source,report,depth+1)}</p>`;
    case "table":{
      const labels=(entries.colLabels??[]).map(t=>`<th>${safe(t)}</th>`).join("");
      const rows=(entries.rows??[]).map(r=>`<tr>${(Array.isArray(r)?r:(r.row??[])).map(v=>`<td>${typeof v==="string"?convertTags(v,index,source,report):renderEntries(v.entry??v.entries??v,index,source,report,depth+1)}</td>`).join("")}</tr>`).join("");
      return `<table>${labels?`<thead><tr>${labels}</tr></thead>`:""}<tbody>${rows}</tbody></table>`;
    }
    case "image":{
      const path=entries.href?.path;
      if(path){report.unlocalizedImages.add(path);return `<p><em>[Image pending localization: ${safe(path)}]</em></p>`;}
      return "";
    }
    case "refClassFeature":case "refSubclassFeature":case "refOptionalfeature":{
      const toKind={refClassFeature:"classFeature",refSubclassFeature:"subclassFeature",refOptionalfeature:"optionalfeature"}[entries.type];
      const uid=entries.classFeature??entries.subclassFeature??entries.optionalfeature;
      const ref=lookupUid(index,toKind,uid,source);
      if(ref&&!ref.virtual)return `<p>@UUID[${ref.uuid}]{${safe(ref.record.name)}}</p>`;
      if(ref?.virtual)return `<p><strong>${safe(ref.record.name)}</strong></p>${renderEntries(ref.record.entries??[],index,source,report,depth+1)}`;
      report.unresolved.add(`${toKind}: ${uid}`);
      return `<p>${safe(String(uid??""))}</p>`;
    }
    case "quote":return `<blockquote>${renderEntries(entries.entries??[],index,source,report,depth+1)}</blockquote>`;
    default:return renderEntries(entries.entries??entries.entry??entries.items??entries.text??[],index,source,report,depth+1);
  }
}
function advancement(type,name,level,configuration,value={}){
  return {type,name,level,configuration,value};
}
function addAdv(advances,obj){
 let sequence=Object.keys(advances).length,key=obj._id;
 if(!key){do{key=`a${String(sequence++).padStart(15,"0")}`;}while(advances[key]);}
 advances[key] = {...obj, _id:key};
}
function sourceMeta(rec) {const rules=rec._bccRules??(rec.edition==="one"||rec.srd52||rec.basicRules2024?"2024":rec.edition==="classic"||rec.srd||rec.basicRules?"2014":null);return {book:rec.source??"",page:String(rec.page??""),...(rules?{rules}:{}),custom:"",license:""};}
function applySystemFields(system, fields) {
  for(const [path,value] of Object.entries(fields)) {
    const property=/^properties\.([a-zA-Z0-9]+)$/.exec(path);
    if(property&&typeof value==="boolean") {
      const current=new Set(Array.isArray(system.properties)?system.properties:system.properties instanceof Set?[...system.properties]:Object.keys(system.properties??{}).filter(k=>system.properties[k]));
      if(value)current.add(property[1]);else current.delete(property[1]);
      system.properties=[...current];
    } else foundry.utils.setProperty(system,path,clone(value));
  }
}
function valuesFromProficiency(profs,kind) {
  const grants=new Set();const choices=[];
  for (const block of profs ?? []) {
    if(!block||typeof block!=="object")continue;
    const mapping=kind==="skills"?SKILL_MAP:null;
    const pool = Object.keys(block).filter(k=>!(["choose","any","anyStandard","anyTool","anyArtisansTool"].includes(k))&&block[k]===true)
      .map(k=>mapping?.[k] ? `skills:${mapping[k]}` : kind==="skills"?null:`${kind}:${k}`).filter(Boolean);
    for(const val of pool)grants.add(val);
    if(block.any && kind==="skills")choices.push({count:block.any,pool:Object.values(SKILL_MAP).map(k=>`skills:${k}`)});
    if(block.choose?.from && kind==="skills")choices.push({count:block.choose.count??1,
      pool:block.choose.from.map(k=>mapping?.[k]?`skills:${mapping[k]}`:null).filter(Boolean)});
  }
  return {grants:[...grants],choices};
}
function applyTraits(record,adv,report,index){applyNativeTraits(record,adv,addAdv,report,index);}
function featRefForBackground(index,rec,report){
  const grants=[];
  for(const obj of rec.feats??[])for(const name of Object.keys(obj))if(obj[name]){
    const [baseName,specialization]=name.split("|")[0].split(";").map(x=>x.trim());
    let ref=lookupUid(index,"feat",name,rec.source);
    if(specialization){
      const variant=index.all.find(e=>e.kind==="feat"&&canon(e.record._bccVariantOf?.name)===canon(baseName)&&canon(e.record.name).includes(canon(specialization))&&canon(e.record.source)===canon(rec.source));
      if(variant)ref=variant;
      else if(ref?.record._bccAdditionalOptions){
        const option=ref.record._bccAdditionalOptions.find(n=>canon(n).includes(canon(specialization)));
        if(option){
          const chosen=lookupUid(index,"optionalfeature",`${option}|${ref.record.source}`,ref.record.source);
          if(chosen)grants.push({uuid:chosen.uuid,optional:false,sort:grants.length});
          report.incomplete.add(`background ${rec.name}: specialization grants spell recipe; parent feat choice must remain consistent`);
        }
      }
    }
    if(ref)grants.push({uuid:ref.uuid,optional:false,sort:grants.length});else report.unresolved.add(`background ${rec.name}: feat ${name}`);
  }
  return grants;
}
async function buildGrants(index,kind,record,adv,report){
  if (kind==="race") {
    const features=index.all.filter(it=>it.kind==="raceFeature"&&canon(it.record.raceName)===canon(record.name)&&canon(it.record.source)===canon(record.source)&&!it.record._bccOption);
    const byLevel=new Map();
    for(const feature of features){const level=availableLevel(feature.record);if(!byLevel.has(level))byLevel.set(level,[]);byLevel.get(level).push({uuid:feature.uuid,optional:false,sort:byLevel.get(level).length});}
    for(const [level,items] of byLevel)addAdv(adv,advancement("ItemGrant","Species Features",level,{items,optional:false,sorting:"m",spell:null}));
    for(const choice of record._bccChoices??[]){
      const pool=index.all.filter(e=>e.kind==="raceFeature"&&canon(e.record.raceName)===canon(record.name)&&canon(e.record.source)===canon(record.source)&&choice.names.includes(e.record.name));
      addAdv(adv,choiceAdv(choice.name,choice.level,itemChoiceConfig(pool,{[choice.level]:{count:1,replacement:false}},"feat",{type:"race",subtype:"",level:"",list:[],school:[]}),{kind:"speciesVariant"}));
    }
  } else if (kind==="background") {
    const grants=featRefForBackground(index,record,report);
    if(grants.length)addAdv(adv,advancement("ItemGrant","Origin Feat",0,{items:grants,optional:false,sorting:"m",spell:null}));
  } else if (kind==="class"||kind==="subclass"){
    const byLevel=new Map();
    for(const ref of record[kind==="class"?"classFeatures":"subclassFeatures"]??[]){
      const uid=typeof ref==="string"?ref:ref[kind==="class"?"classFeature":"subclassFeature"];
      if(!uid)continue;
      const feature=lookupUid(index,kind==="class"?"classFeature":"subclassFeature",uid,record.source);
      if(feature?.virtual)continue;
      if(!feature){report.unresolved.add(`${record.name}: ${uid}`);continue;}
      const level=Number(feature.record.level)||1;
      if(!byLevel.has(level))byLevel.set(level,[]);
      byLevel.get(level).push({uuid:feature.uuid,optional:false,sort:byLevel.get(level).length});
    }
    for(const [level,items] of byLevel.entries())
      addAdv(adv,advancement("ItemGrant",`${kind==="class"?"Class":"Subclass"} Features`,level,
        {items,optional:false,sorting:"m",spell:null}));
    if(kind==="class")for(const ref of record.classFeatures??[]){
      const uid=typeof ref==="string"?ref:ref.classFeature;if(!uid)continue;
      const feature=lookupUid(index,"classFeature",uid,record.source);if(!feature)continue;
      const raw=feature.record,body=plainText(raw.entries);
      const featTag=/\{@feat\s+([^}]+)\}/i.exec(JSON.stringify(raw.entries??[]));
      const target=featTag?lookupUid(index,"feat",featTag[1],raw.source):null;
      const structured=target?.record.ability?.some(a=>a.choose?.from?.length===6&&Number(a.choose.amount??1)*Number(a.choose.count??1)===2);
      const legacy=/increase one ability score[^.]*by 2/i.test(body)&&/two ability scores[^.]*by 1/i.test(body);
      if((structured&&/or another/i.test(body))||legacy){
        const max=Number(/above (\d+)/i.exec(body)?.[1]??20);
        addAdv(adv,advancement("AbilityScoreImprovement","Ability Score Improvement",Number(raw.level),{points:2,cap:2,max,locked:[],fixed:Object.fromEntries(ABILITIES.map(a=>[a,0])),recommendation:target?.uuid??null}));
      }
    }

    if(kind==="class"){
      // Each book declares the subclass entry point in classFeatures. Do not
      // assume level 3, 1, or another rule tied to a particular edition.
      const entry=(record.classFeatures??[]).find(it=>it && typeof it==="object" && it.gainSubclassFeature);
      if(entry){
        const uid=entry.classFeature??"";
        const level=Number(uid.split("|")[3]);
        if(level>0&&level<=20)addAdv(adv,{...advancement("Subclass",record.subclassTitle??"Subclass",level,{},{}),
          flags:{bcc:{source:{kind:"gainSubclassFeature",source:record.source,class:record.name,uid}}}});
        else report.unresolved.add(`${record.name}: subclass level cannot be inferred from ${uid}`);
      }else if(index.all.some(it=>it.kind==="subclass"&&canon(it.record.className)===canon(record.name)))
        report.incomplete.add(`${record.name}: subclass entries exist but classFeatures lack gainSubclassFeature`);
    }
  }
}

/** Pool data is obtained exclusively from the 5etools catalog being converted. */
function spellRefsForClass(index, name, classSource, level=null) {
  const source=canon(classSource), wanted=canon(name);
  let pool = index.all.filter(it=>{
    if(it.kind!=="spell")return false;
    if(level!==null && Number(it.record.level)!==Number(level))return false;
    const entry=index.spellLookup?.[canon(it.record.source)]?.[canon(it.record.name)];
    return Object.entries(entry?.class??{}).some(([src,classes])=>
      canon(src)===source && Object.keys(classes).some(n=>canon(n)===wanted));
  });
  if(!pool.length)pool=index.all.filter(it=>it.kind==="spell"&&(level===null||Number(it.record.level)===level)&&Object.values(index.spellLookup?.[canon(it.record.source)]?.[canon(it.record.name)]?.class??{}).some(classes=>Object.keys(classes).some(n=>canon(n)===wanted)));
  return pool;
}
const itemChoiceConfig=(refs, choices, type="feat", restriction={type:"",subtype:"",level:"",list:[],school:[]}, spell=null)=>({
  allowDrops:false,choices,pool:preferredCandidates(refs).map((it,i)=>({uuid:it.uuid,sort:i*10000})),
  restriction,sorting:"m",spell,type
});
const choiceAdv=(name,level,config,origin)=>({
  ...advancement("ItemChoice",name,level,config,{added:{},replaced:{}}),
  flags:{bcc:{source:origin}}
});
function cumulativeChoices(arr,replacements=false){
  if(!Array.isArray(arr))return {};
  const choices={};let last=0;
  for(let i=0;i<arr.length;i++){
    const total=Number(arr[i]);
    if(!Number.isFinite(total)||total<0)continue;
    const gain=Math.max(0,total-last);
    if(gain || (i>0&&replacements))choices[String(i+1)]={count:gain,replacement:i>0&&replacements};
    last=total;
  }
  return choices;
}
function discreteChoices(progression){
  if(Array.isArray(progression))return cumulativeChoices(progression,true);
  if(!progression || typeof progression!=="object")return {};
  const choices={};
  for(const [lv,count] of Object.entries(progression))if(Number.isInteger(Number(lv))&&Number(count)>0)
    choices[lv]={count:Number(count),replacement:false};
  return choices;
}
function applyClassChoices(record,index,adv,report){
  for(const [pi,step] of (record.optionalfeatureProgression??[]).entries()){
    if(!step?.featureType?.length || !step.progression)continue;
    const expected=new Set(step.featureType.map(canon));
    const pool=index.all.filter(it=>it.kind==="optionalfeature" &&
      (it.record.featureType??[]).some(type=>expected.has(canon(type))));
    if(!pool.length){report.unresolved.add(`${record.name}: no local choices for ${step.name??step.featureType.join(", ")}`);continue;}
    const choices=discreteChoices(step.progression);
    if(!Object.keys(choices).length)continue;
    addAdv(adv,choiceAdv(step.name??"Choose Class Features",1,
      itemChoiceConfig(pool,choices,"feat",{type:"class",subtype:"",level:"",list:[],school:[]}),
      {kind:"optionalfeatureProgression",source:record.source,step:pi,featureType:step.featureType}));
    // Data in 5etools can encode prerequisites, but the initial ItemChoice schema
    // does not evaluate the complete prerequisite expression for every option.
    if(pool.some(it=>it.record.prerequisite?.length))
      report.incomplete.add(`${record.name} / ${step.name}: prerequisite evaluation in ItemChoice requires QA`);
  }
  for(const [pi,step] of (record.featProgression??[]).entries()){
    const categories=new Set((step.category??[]).map(canon));
    const pool=index.all.filter(it=>it.kind==="feat" && categories.has(canon(it.record.category)));
    const choices=discreteChoices(step.progression);
    if(!pool.length){report.unresolved.add(`${record.name}: missing local feat choices for ${step.name}`);continue;}
    if(!Object.keys(choices).length)continue;
    addAdv(adv,choiceAdv(step.name??"Choose Feat",1,
      itemChoiceConfig(pool,choices,"feat",{type:"feat",subtype:"",level:"",list:[],school:[]}),
      {kind:"featProgression",source:record.source,step:pi,category:step.category}));
  }
  // Ordinary class spell progression is data, not an additional Advancement
  // selection queue. Consumers read the native scales and registered lists.
}
// Interpret the general 5etools additionalSpells `choose` recipe format. No
// feat or class name is used to select a special conversion path.
function collectSpellChoices(value, path=[],out=[]){
  if(Array.isArray(value)){for(const v of value)collectSpellChoices(v,path,out);return out;}
  if(!value||typeof value!=="object")return out;
  if(typeof value.choose==="string" && /(?:^|\|)class=/i.test(value.choose)){
    const level=Number((value.choose.match(/(?:^|\|)level=(\d+)/i)||[])[1]);
    const className=(value.choose.match(/(?:^|\|)class=([^|]+)/i)||[])[1];
    if(Number.isInteger(level) && className)out.push({level,className,count:Number(value.count??1),daily:path.includes("daily")});
  }
  for(const [key,child] of Object.entries(value))if(key!=="choose")collectSpellChoices(child,[...path,key],out);
  return out;
}
function applyAdditionalSpellChoices(record,index,adv,report,overlay,kind){
  return addSpellRecipes(record,index,adv,report,{add:addAdv,lookup:lookupUid,classPool:spellRefsForClass,choiceConfig:itemChoiceConfig,choiceAdv,overlay,kind});
}

const classProgress = r=>({progression: r.casterProgression==="pact"?"pact":({"1/2":"half","1/3":"third"}[r.casterProgression]??r.casterProgression??"none"),ability:r.spellcastingAbility??""});
const classifyItem = itemType;
function getOverlay(kind,record,foundry){return findSupplement(kind,record,foundry);}
// 5etools supplements use their own foundryId and @spell/@creature references.
// Convert them to native, typed Foundry UUIDs and 16-character activity IDs BEFORE persistence.
const OLD_EFFECT_MODES={0:"custom",1:"multiply",2:"add",3:"downgrade",4:"upgrade",5:"override"};
function normalizeEffects(arr,kind,record,report){
  const out=[];
  for(const [i,e] of (arr??[]).entries()){
    if(!e||typeof e!=="object")continue;
    const changes=(e.system?.changes??e.changes??[]).map(change=>{
      const c={...change};
      const type=typeof c.type==="string"?c.type.toLowerCase():
        typeof c.mode==="string"?c.mode.toLowerCase():OLD_EFFECT_MODES[c.mode];
      delete c.mode;
      c.key=String(c.key??"").replace(/system\.attributes\.movement\.(walk|fly|swim|climb|burrow)$/, "system.attributes.movement.speeds.$1");
      const registered=Object.keys(globalThis.CONFIG?.ActiveEffect?.changeTypes??{}).find(key=>canon(key)===canon(type));
      if(registered||Object.values(OLD_EFFECT_MODES).includes(type))c.type=registered??type;
      else {report.incomplete.add(`${record.name}: unsupported ActiveEffect change type ${String(change.type??change.mode)} withheld`);return null;}
      return c;
    }).filter(Boolean);
    out.push({_id:`eff${String(i+1).padStart(13,"0")}`,name:e.name??`${record.name} Effect ${i+1}`,
      ...(e.type?{type:e.type}:{}),description:e.description??safe(plainText(e.descriptionEntries??[])),disabled:e.disabled??false,
      transfer:e.transfer??false,system:{...(e.system??{}),changes},duration:e.duration?.seconds!=null?{value:e.duration.seconds,units:"seconds"}:e.duration?.rounds!=null?{value:e.duration.rounds,units:"rounds"}:e.duration??{},
      statuses:e.statuses??[],...(e.showIcon!=null?{showIcon:e.showIcon}:{}),img:e.img??"icons/svg/aura.svg",flags:{...(e.flags??{}),bcc:{foundryId:e.foundryId??""}}});
  }
  for(const [i,raw] of (arr??[]).entries()){
    const effect=out[i];if(!effect)continue;
    if(raw.enchantmentLevelMin!=null||raw.enchantmentLevelMax!=null){effect.flags.dnd5e??={};effect.flags.dnd5e.enchantment??={};effect.flags.dnd5e.enchantment.level={min:raw.enchantmentLevelMin??null,max:raw.enchantmentLevelMax??null};}
    if(raw.enchantmentRiderParent){const parent=out.find(e=>e.flags.bcc.foundryId===raw.enchantmentRiderParent);if(parent){parent.flags.dnd5e??={};parent.flags.dnd5e.enchantment??={};parent.flags.dnd5e.enchantment.riders??={};(parent.flags.dnd5e.enchantment.riders.effect??=[]).push(effect._id);effect.flags.dnd5e={...(effect.flags.dnd5e??{}),rider:true};}else report.unresolved.add(`${record.name}: missing parent Enchantment ${raw.enchantmentRiderParent}`);}
  }
  return out;
}
function resolveOverlayUUID(value, index, expectedKind, report, context){
  if(typeof value!=="string"||!value.trim())return null;
  const native=value.match(/^Compendium\.[^.]+\.[^.]+\.(Item|Actor)\.[A-Za-z0-9]{16}$/);
  if(native){
    if(!index.all.some(e=>e.uuid===value)){report.unresolved.add(`${context}: external UUID is outside the generated graph ${value}`);return null;}
    if(native[1]===(expectedKind==="monster"?"Actor":"Item"))return value;
    report.unresolved.add(`${context}: unexpected UUID document type ${value}`);return null;
  }
  const match=value.match(/^@(spell|creature|monster)\[([^\]]+)\]$/i);
  if(!match){report.unresolved.add(`${context}: unsupported reference ${value}`);return null;}
  const kind=match[1].toLowerCase()==="spell"?"spell":"monster";
  if(kind!==expectedKind){report.unresolved.add(`${context}: wrong reference type ${value}`);return null;}
  const parts=match[2].split("|");
  const found=lookupUid(index,kind,match[2],parts[1]);
  if(!found){report.unresolved.add(`${context}: external or missing document ${value}`);return null;}
  return found.uuid;
}
function normalizeActivities(arr,effects,index,record,report){
  const out={};
  const source=(arr??[]).filter(a=>a?.type);
  const idByFoundryId=new Map(source.filter(a=>a.foundryId).map((a,i)=>[a.foundryId,`act${String(source.indexOf(a)+1).padStart(13,"0")}`]));
  const effectIdByFoundryId=new Map(effects.filter(e=>e.flags?.bcc?.foundryId).map(e=>[e.flags.bcc.foundryId,e._id]));
  for(const [i,a] of source.entries()){
    const _id=`act${String(i+1).padStart(13,"0")}`;
    const normalized=structuredClone(a);delete normalized.foundryId;
    const context=`${record.name} / ${a.name??a.type}`;
    for(const [ti,target] of (normalized.consumption?.targets??[]).entries())if(target.target&&typeof target.target==="object"){
      const reference=clone(target.target);
      const kind=reference.prop??reference.type;
      const ref=index.all.find(e=>(!kind||e.kind===kind)&&canon(e.record.name)===canon(reference.name)&&(!reference.source||canon(e.record.source)===canon(reference.source))&&(!reference.className||canon(e.record.className)===canon(reference.className)));
      if(ref)reference.uuid=ref.uuid;
      (record._bccResourceBindings??=[]).push({activity:_id,index:ti,reference});
      target.target=ref?.uuid??`bcc-unresolved:${reference.name??"resource"}`;
      report.information.add(`${context}: native resource target will bind when granted to an Actor`);
    }
    if(normalized.activity?.foundryId){const id=idByFoundryId.get(normalized.activity.foundryId);if(id)normalized.activity={id};else{report.unresolved.add(`${context}: unresolved forwarded activity ${normalized.activity.foundryId}`);continue;}}
    if(a.type==="transform"&&Array.isArray(normalized.profiles))for(const profile of normalized.profiles)if(profile.uuid)profile.uuid=resolveOverlayUUID(profile.uuid,index,"monster",report,context)??"";
    if(a.type==="cast" && normalized.spell?.uuid){
      const resolved=resolveOverlayUUID(normalized.spell.uuid,index,"spell",report,context);
      if(!resolved){report.incomplete.add(`${context}: Cast Activity withheld until linked Spell is available`);continue;}
      normalized.spell.uuid=resolved;
    }
    if(a.type==="summon" && Array.isArray(normalized.profiles)){
      const originalCount=normalized.profiles.length;
      normalized.profiles=normalized.profiles.filter(p=>{
        if(!p.uuid)return true; // CR/type driven profiles need no fixed Actor UUID.
        const resolved=resolveOverlayUUID(p.uuid,index,"monster",report,context);
        if(!resolved)return false;
        p.uuid=resolved;return true;
      });
      if(originalCount>0 && normalized.profiles.length===0){
        report.incomplete.add(`${context}: Summon Activity withheld until referenced Actors are available`);
        continue;
      }
      if(originalCount!==normalized.profiles.length)
        report.incomplete.add(`${context}: ${originalCount-normalized.profiles.length} summon profiles lack a local Actor`);
    }
    if(Array.isArray(normalized.effects)){
      normalized.effects=normalized.effects.flatMap(e=>{
        const effectId=effectIdByFoundryId.get(e.foundryId);
        if(!effectId){report.unresolved.add(`${context}: missing Effect ${e.foundryId}`);return [];}
        const riders={activity:[],effect:[]};
        for(const rider of e.riders?.activity??[]){
          const id=idByFoundryId.get(rider.foundryId);
          if(id)riders.activity.push(id);
          else report.unresolved.add(`${context}: missing rider Activity ${rider.foundryId}`);
        }
        for(const rider of e.riders?.effect??[]){
          const id=effectIdByFoundryId.get(rider.foundryId);
          if(id)riders.effect.push(id);
          else report.unresolved.add(`${context}: missing rider Effect ${rider.foundryId}`);
        }
        return [{_id:effectId,level:e.level??{min:null,max:null},riders}];
      });
    }
    out[_id]={_id,...normalized};
  }
  // A missing Activity is never silently replaced by an invented UUID.
  for(const a of source){
    if(a.foundryId && idByFoundryId.has(a.foundryId)){
      const id=idByFoundryId.get(a.foundryId);
      if(!out[id])report.unresolved.add(`${record.name}: Activity ${a.foundryId} was not imported`);
    }
  }
  return out;
}
function applyFeatAbilityAdvancement(record,adv,report){
  if(!Array.isArray(record.ability)||!record.ability.length)return;
  const choice=record.ability.find(x=>x?.choose)?.choose;
  const fixed=Object.fromEntries(ABILITIES.map(a=>[a,0]));
  for(const ability of record.ability){
    for(const key of ABILITIES) if(typeof ability?.[key]==="number") fixed[key]=Math.max(fixed[key],ability[key]);
  }
  const amount=choice ? Number(choice.amount??1):0;
  const count=choice ? Number(choice.count??1):0;
  const points=choice ? amount*count:0;
  const allowed=choice?.from?.filter(a=>ABILITIES.includes(a))??ABILITIES;
  if(choice && (!Number.isFinite(points)||points<1||points>6)){
    report.incomplete.add(`${record.name}: unusual Ability Score Improvement needs manual review`);return;
  }
  const fixedPoints=Object.values(fixed).reduce((a,b)=>a+b,0);
  if(points===0 && fixedPoints===0)return;
  const cap=Math.max(1,amount,Math.max(...Object.values(fixed)));
  addAdv(adv,advancement("AbilityScoreImprovement","Ability Score Improvement",0,{
    points,cap,locked:ABILITIES.filter(a=>!allowed.includes(a)),fixed,recommendation:null
  }));
  if(record.ability.length>1 && !choice)report.incomplete.add(`${record.name}: multiple ability alternatives require GM review`);
}
export async function convertOne(entry,index,content,report){
  const {kind,record,_id} = entry;
  const desc=renderEntries(record.entries??[],index,record.source,report);
  const base={_id,name:record.name,sort:kind==="chapter" ? Number(record.sequence??0)*10000 : 0,flags:originFlags(kind,record,content.sourceId)};
  base.flags.bcc.converterVersion="0.0.8";
  base.flags.bcc.dependency=!!record._bccDependency;
  if(record._bccDependencyReasons?.length)base.flags.bcc.dependencyReasons=clone(record._bccDependencyReasons);
  if(record.prerequisite)base.flags.bcc.prerequisites=clone(record.prerequisite);
  if(record._bccSpellReplacements)base.flags.bcc.spellReplacements=clone(record._bccSpellReplacements);
  if(kind==="chapter"){
    return {...base,pages:[{_id:"bccChapterPage01",name:record.name,type:"text",sort:0,text:{content:renderEntries(record.chapter,index,record.source,report)}}]};
  }
  if(kind==="spellList"){
    return {...base,pages:record.lists.map(list=>{
      const spells=list.listType==="subclass"?expandedSpellPool(list,index,spellRefsForClass,lookupUid,report):spellRefsForClass(index,list.ownerName,list.classSource);
      return {_id:list.pageId,name:list.ownerName,type:"spells",system:{type:list.listType,identifier:list.identifier,grouping:"level",description:{value:""},spells:preferredCandidates(spells,list).map(e=>e.uuid),unlinkedSpells:[]}};
    })};
  }
  if(["monster","object","vehicle"].includes(kind))return buildActor(entry,index,content,report,{convert:convertOne,lookup:lookupUid,render:renderEntries});
  const sys={description:{value:desc},source:sourceMeta(record),identifier:slug(record.name)};
  const adv={};
  let spellSynthesisIssues=[];
  if(kind==="race"){
    sys.type={value:(record.creatureTypes?.[0]??"humanoid"),subtype:record.name};
    const movement=typeof record.speed==="number"?{walk:record.speed}:record.speed??{walk:30};
    sys.movement={speeds:Object.fromEntries(Object.entries(movement).filter(([k,v])=>["walk","fly","swim","climb","burrow"].includes(k)&&typeof v==="number").map(([k,v])=>[k,String(v)])),units:"ft"};
    sys.senses={units:"ft",darkvision:Number(record.darkvision??0),blindsight:Number(record.blindsight??0)};
    const sizes=(record.size??[]).map(k=>SIZE_MAP[k]).filter(Boolean);
    if(sizes.length)addAdv(adv,advancement("Size","Size",0,{sizes}));
    applyTraits(record,adv,report,index);
  } else if(kind==="background"){
    const allowed=record.ability?.[0]?.choose?.weighted?.from??[];
    if(allowed.length){addAdv(adv,advancement("AbilityScoreImprovement","Background Ability Scores",0,
      {cap:2,points:3,locked:ABILITIES.filter(v=>!allowed.includes(v)),fixed:Object.fromEntries(ABILITIES.map(a=>[a,0]))}));}
    applyTraits(record,adv,report,index);
  } else if(kind==="class"){
    sys.hd={denomination:`d${record.hd?.faces??8}`};
    sys.spellcasting=classProgress(record);
    addProgressionScales(record,adv,addAdv,slug);
    if(kind==="class")for(const scale of resourceScales(record,index,slug))addAdv(adv,scale);
    const primaryAdd=(target,value)=>addAdv(target,{...value,classRestriction:"primary"});
    applyNativeTraits({...record,...record.startingProficiencies,_bccGrantLevel:1},adv,primaryAdd,report,index);
    const gained=record.multiclassing?.proficienciesGained;
    if(gained)applyNativeTraits({...gained,name:record.name,skillProficiencies:gained.skills,_bccGrantLevel:1},adv,(target,value)=>addAdv(target,{...value,classRestriction:"secondary"}),report,index);
    if(record.preparedSpellsProgression||record.spellsKnownProgression)sys.spellcasting.preparation={formula:`@scale.${slug(record.name)}.max-prepared`};
    if(record.proficiency?.length)primaryAdd(adv,advancement("Trait","Saving Throw Proficiencies",1,{mode:"default",allowReplacements:false,grants:record.proficiency.map(a=>`saves:${a}`),choices:[]}));
    if(record.preparedSpells){
      const formula=String(record.preparedSpells).replace(/<\$level\$>/g,`@classes.${slug(record.name)}.levels`).replace(/<\$(str|dex|con|int|wis|cha)_mod\$>/g,"@abilities.$1.mod");
      if(!formula.includes("<$"))sys.spellcasting.preparation={formula};else report.incomplete.add(`${record.name}: unsupported dynamic spell-preparation formula`);
    }
    addAdv(adv,advancement("HitPoints","Hit Points",1,{}));
    const sk=valuesFromProficiency(record.startingProficiencies?.skills,"skills");
    if(sk.choices.length||sk.grants.length)primaryAdd(adv,advancement("Trait","Class Skills",1,
      {mode:"default",allowReplacements:false,...sk}));
    applyClassChoices(record,index,adv,report);

  } else if(kind==="subclass"){
    sys.classIdentifier=slug(record.className);
    if(record.casterProgression)sys.spellcasting=classProgress(record);
    addProgressionScales(record,adv,addAdv,slug);
    if(kind==="class")for(const scale of resourceScales(record,index,slug))addAdv(adv,scale);
  } else if(kind==="feat"||kind==="optionalfeature"||kind.endsWith("Feature")){
    buildFeature(record,sys,report,slug,kind);
    if(kind==="optionalfeature"){
      const normalize=value=>String(value).split(".").at(-1).toLowerCase().replace(/[^a-z0-9]/g,"").replace(/s$/,"");
      const names=[...index.records.class,...index.records.subclass].flatMap(r=>(r.optionalfeatureProgression??[]).filter(p=>p.featureType?.some(t=>record.featureType?.includes(t))).map(p=>p.name));
      const matches=Object.entries(globalThis.CONFIG?.DND5E?.featureTypes?.class?.subtypes??{}).filter(([key,label])=>names.some(name=>normalize(name)===normalize(key)||normalize(name)===normalize(label)));
      if(matches.length===1)sys.type.subtype=matches[0][0];
    }
    if(kind==="feat")applyFeatAbilityAdvancement(record,adv,report);

  } else if(kind==="spell"){
    sys.level=Number(record.level)||0;
    sys.school=SCHOOL_MAP[record.school]??record.school??"abj";
    sys.properties=Object.keys(record.components??{}).filter(k=>(record.components??{})[k]).map(k=>({v:"v",s:"s",m:"m"}[k])).filter(Boolean);
    if(record.meta?.ritual)sys.properties.push("ritual");
    sys.method="spell";
    sys.preparation={mode:"prepared",prepared:false};
    // Generate native Activity + casting metadata deterministically from the
    // original 5etools spell record. Native 5etools overlays, if supplied,
    // remain authoritative and replace only the generated Activity.
    const synthesized=synthesizeSpell(record);
    for(const key of ["activation","range","duration","target","materials","properties"])
      if(synthesized.system[key]!==undefined)sys[key]=synthesized.system[key];
    sys.activities=synthesized.activities;
    spellSynthesisIssues=synthesized.issues;
  } else if(kind==="item"){
    buildEquipment(record,sys,report);
    if(typeof record.reqAttune==="string"&&record.reqAttune!=="optional")sys.description.value=`<p><strong>Attunement:</strong> ${safe(record.reqAttune)}</p>${sys.description.value}`;
    if(!sys.activities&&!["container"].includes(itemType(record))){const a=genericActivity(record);if(a)sys.activities={[a._id]:a};const uses=resourceUses(record);if(uses&&!sys.uses)sys.uses=uses;}
  }
  if(["class","background"].includes(kind))sys.startingEquipment=buildStartingEquipment(record,index,lookupUid,report);
  for(const block of record.feats??[])if(block.anyFromCategory||block.any){
    const spec=block.anyFromCategory??{count:block.any},categories=spec.category??[];
    const pool=index.all.filter(e=>e.kind==="feat"&&(!categories.length||categories.includes(e.record.category)));
    addAdv(adv,choiceAdv("Choose Feat",0,itemChoiceConfig(pool,{"0":{count:Number(spec.count??1),replacement:false}},"feat",{type:"feat",subtype:categories.length===1?({O:"origin",G:"general",FS:"fightingStyle",EB:"epicBoon"}[categories[0]]??""):"",level:"",list:[],school:[]}),{kind:"featSelection"}));
  }
  if(kind==="race"&&record.ability)applyFeatAbilityAdvancement(record,adv,report);
  const overlay=getOverlay(kind,record,content.foundry);
  const grantDecisions=record.additionalSpells?applyAdditionalSpellChoices(record,index,adv,report,overlay,kind):[];
  if(grantDecisions.length)base.flags.bcc.grants={version:1,choices:grantDecisions};

  if(["race","background","class","subclass"].includes(kind))await buildGrants(index,kind,record,adv,report);
  sys.identifier=record.foundryIdentifier??overlay?.identifier??sys.identifier;
  let effects=[];
  if(record.foundrySystem)applySystemFields(sys,record.foundrySystem);
  if(overlay){
    if(overlay.system)applySystemFields(sys,overlay.system);
    if(Array.isArray(overlay.advancement))for(const a of overlay.advancement) {
      // Native supplement can bring valid ScaleValue advancements.
      if(a.type==="ScaleValue")upsertScaleValue(adv,a,addAdv,slug);
      else if(a.type!=="ScaleValue")report.incomplete.add(`${record.name}: supplemental ${a.type} advancement deferred`);
    }
    effects=normalizeEffects(overlay.effects,kind,record,report);
    if(Array.isArray(overlay.activities)){
      const native=normalizeActivities(overlay.activities,effects,index,record,report);
      if(Object.keys(native).length || overlay.activities.length===0) {
        // An actual 5etools Foundry supplement takes precedence over inference.
        sys.activities=native;
        if(kind==="spell")spellSynthesisIssues=[];
      }
    }
  }
  effects.push(...entitlementEffects(grantDecisions));
  if(record.foundryActivities)sys.activities=normalizeActivities(record.foundryActivities,effects,index,record,report);
  if(kind==="item"&&record.attachedSpells){
    if(!record.foundryActivities&&!Array.isArray(overlay?.activities))addItemSpellActivities(record,sys,index,lookupUid,report);
    else {const pending={...sys,activities:clone(sys.activities??{})};addItemSpellActivities(record,pending,index,lookupUid,report);if(Object.keys(pending.activities??{}).length!==Object.keys(sys.activities??{}).length)report.incomplete.add(`${record.name}: supplemental activities leave attached spells unrepresented; supplement retained`);}
  }
  if(kind==="classFeature"&&sys.uses?.max&&/^\d+$/.test(String(sys.uses.max))){const parent=index.all.find(e=>e.kind==="class"&&canon(e.record.name)===canon(record.className)&&canon(e.record.source)===canon(record.classSource));if(parent&&resourceScales(parent.record,index,slug).some(a=>a.configuration.identifier===slug(record.name)))sys.uses.max=`@scale.${slug(parent.record.name)}.${slug(record.name)}`;}
  if(sys.uses?.max){
    const explicit=overlay?.system?.["uses.recovery"]??record.foundrySystem?.["uses.recovery"];
    if(!explicit){const recovery=resourceRecovery(record);if(recovery.length)sys.uses.recovery=recovery;}
  }
  if(sys.uses?.per){if(!sys.uses.recovery?.length)sys.uses.recovery=[{period:sys.uses.per,type:"recoverAll"}];delete sys.uses.per;}
  if(sys.uses?.max)for(const a of Object.values(sys.activities??{}))if(a.type!=="cast"&&!a.consumption?.targets?.length && a.activation?.type)a.consumption={targets:[{type:"itemUses",value:"1"}]};
  if(record._bccResourceBindings?.length)base.flags.bcc.resourceBindings=[...new Map(record._bccResourceBindings.map(b=>[JSON.stringify(b),clone(b)])).values()];
  if(kind==="spell")for(const issue of spellSynthesisIssues)
    report.incomplete.add(`${record.name}: ${issue}`);
  if(overlay?.subEntities)for(const [childKind,children] of Object.entries(overlay.subEntities)){
    const refs=children.map(child=>index.all.find(e=>e.kind===childKind&&canon(e.record.name)===canon(child.name)&&canon(e.record.source)===canon(child.source))).filter(Boolean);
    if(refs.length)addAdv(adv,advancement("ItemGrant","Additional Features",Number(record.level??0),{items:refs.map((r,i)=>({uuid:r.uuid,optional:false,sort:i})),optional:false,sorting:"m",spell:null}));
  }
  if(kind==="class"){
    const serialized=JSON.stringify(content.foundry);
    const refs=[...serialized.matchAll(new RegExp(`@scale\\.${slug(record.name)}\\.([a-z0-9-]+)`,"g"))].map(m=>m[1]);
    for(const name of new Set(refs))if(!Object.values(adv).some(a=>a.configuration?.identifier===name)){
      const candidates=Object.values(adv).filter(a=>a.type==="ScaleValue"&&String(a.configuration?.identifier).split("-").includes(name));
      if(candidates.length===1)addAdv(adv,{...clone(candidates[0]),_id:undefined,configuration:{...clone(candidates[0].configuration),identifier:name}});
    }
  }
  consolidateScaleValues(adv,slug,report,record.name);
  if(Object.keys(adv).length)sys.advancement=adv;
  const documentType=overlay?.type??record.foundryType??(kind==="raceFeature"||["classFeature","subclassFeature","optionalfeature"].includes(kind)?"feat":
    kind==="item"?classifyItem(record):PACK_DEFS[kind][3]);
  if(kind==="spell" && !Object.keys(sys.activities??{}).length)report.incomplete.add(`${record.name}: spell has no native Activity`);
  return {...base,type:documentType,system:sys,...effects.length?{effects}:{} };
}
export function createReport(content){return {dependencyReasons:content.dependencyReasons??[],information:new Set(),preparationWarnings:[],dependencies:content.dependencies??{},preparationIssues:content.preparationIssues??[],sourceId:content.sourceId,counts:{...content.counts},
  created:{},updated:{},existing:{},errors:[],warnings:[],validationFailures:[],unresolved:new Set(),incomplete:new Set((content.preparationIssues??[]).map(i=>`${i.category} / ${i.name}: ${i.message}`)),unlocalizedImages:new Set()};}
export function finalizeReport(report){return {...report,information:[...report.information],unresolved:[...report.unresolved],incomplete:[...report.incomplete],unlocalizedImages:[...report.unlocalizedImages],
  generatedAt:new Date().toISOString()};}
export { PACK_DEFS };
