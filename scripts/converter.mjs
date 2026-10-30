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
    originalName: record.name, rules: record.edition ?? "one", importedAt: new Date().toISOString()}};
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
export async function buildIndex(content) {
  const records = {...content.records, raceFeature: raceFeatures(content.records.race),
    chapter: content.chapters.map((entry, i) => ({name: entry.name || `Section ${i + 1}`, source:content.sourceId,
      page: entry.page, entries: entry.entries, chapter: entry, sequence:i}))};
  const byKey = new Map(); const byShort = new Map(); const packKeys = new Map();
  const sid = slug(content.sourceId);
  for (const [kind, list] of Object.entries(records)) {
    if (!PACK_DEFS[kind]) continue;
    const [suffix] = PACK_DEFS[kind];
    const packName = `bcc-${sid}-${suffix}`;
    const packId = `world.${packName}`;
    packKeys.set(kind, {packName, packId, ...Object.fromEntries(["suffix","label","docType","itemType"].map((k,i)=>[k,PACK_DEFS[kind][i]]))});
    for (const record of list) {
      const key = entityKey(kind, record);
      if(byKey.has(key)) continue;
      const _id = await idFor(`${content.sourceId}:${key}`);
      const item = {kind, record, key, _id, packId, uuid:`Compendium.${packId}.${PACK_DEFS[kind][2]}.${_id}`};
      byKey.set(key,item);
      const shortKey = `${kind}|${canon(record.source)}|${canon(record.name)}`;
      if(!byShort.has(shortKey)) byShort.set(shortKey, []);
      byShort.get(shortKey).push(item);
    }
  }
  return {records, byKey, byShort, packKeys, spellLookup:content.spellLookup, all:[...byKey.values()]};
}
function locate(index, kind, name, source) {
  const all = index.byShort.get(`${kind}|${canon(source)}|${canon(name)}`) ?? [];
  return all.length === 1 ? all[0] : null;
}
function lookupUid(index, kind, uid, fallbackSource) {
  const parts=String(uid ?? "").split("|");
  if(kind === "classFeature") {
    // Feature Name | Class | Class Source | Level
    const [name,className,classSource,level] = parts;
    return index.all.find(it=>it.kind===kind && canon(it.record.name)===canon(name)
      && canon(it.record.className)===canon(className) && canon(it.record.classSource)===canon(classSource)
      && Number(it.record.level)===Number(level)) ?? null;
  }
  if(kind === "subclassFeature") {
    const [name,className,classSource,shortName,subclassSource,level] = parts;
    return index.all.find(it=>it.kind===kind && canon(it.record.name)===canon(name)
      && canon(it.record.className)===canon(className) && canon(it.record.classSource)===canon(classSource)
      && canon(it.record.subclassShortName)===canon(shortName) && canon(it.record.subclassSource)===canon(subclassSource)
      && Number(it.record.level)===Number(level)) ?? null;
  }
  const name = parts[0];const source = parts[1] || fallbackSource;
  return locate(index,kind,name,source) ?? (kind==="feat" && name.includes(";") ? locate(index,kind,name.split(";")[0],source):null);
}
function linkedText(inner,index,category,source) {
  const parts=inner.split("|");const name=parts[0]?.trim()??"";const ref=lookupUid(index,category,inner,source);
  return ref ? `@UUID[${ref.uuid}]{${safe(name)}}` : safe(name);
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
    case "item":return `<p><strong>${safe(entries.name)}</strong> ${convertTags(entries.entry??"",index,source,report)}</p>`;
    case "table":{
      const labels=(entries.colLabels??[]).map(t=>`<th>${safe(t)}</th>`).join("");
      const rows=(entries.rows??[]).slice(0,500).map(r=>`<tr>${(Array.isArray(r)?r:(r.row??[])).map(v=>`<td>${convertTags(typeof v==="string"?v:JSON.stringify(v),index,source,report)}</td>`).join("")}</tr>`).join("");
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
      if(ref)return `<p>@UUID[${ref.uuid}]{${safe(ref.record.name)}}</p>`;
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
function addAdv(advances,obj){const key=obj._id || `a${Object.keys(advances).length.toString().padStart(15,"0")}`;
 advances[key] = {...obj, _id:key};}
function sourceMeta(rec) {return {book:rec.source??"",page:String(rec.page??""),rules:"2024",custom:"",license:""};}
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
function applyTraits(record,adv,report){
  const skills=valuesFromProficiency(record.skillProficiencies,"skills");
  if(skills.grants.length||skills.choices.length)addAdv(adv,advancement("Trait","Skill Proficiencies",0,{mode:"default",allowReplacements:false,...skills}));
  const res=record.resist?.filter(x=>typeof x==="string").map(k=>`dr:${k}`)??[];
  if(res.length)addAdv(adv,advancement("Trait","Damage Resistances",0,{mode:"default",allowReplacements:false,grants:res,choices:[]}));
  if(record.toolProficiencies?.length)report.incomplete.add(`${record.name}: tool proficiency Advancement requires tool mapping`);
  if(record.languageProficiencies?.length)report.incomplete.add(`${record.name}: language Advancement requires language mapping`);
}
function featRefForBackground(index,rec,report){
  const grants=[];
  for(const obj of rec.feats??[])for(const name of Object.keys(obj))if(obj[name]){
    const ref=lookupUid(index,"feat",name,rec.source);
    if(ref) grants.push({uuid:ref.uuid,optional:false,sort:grants.length});
    else report.unresolved.add(`background ${rec.name}: feat ${name}`);
    if(name.includes(";"))report.incomplete.add(`background ${rec.name}: feat specialization ${name} needs choice handling`);
  }
  return grants;
}
async function buildGrants(index,kind,record,adv,report){
  if (kind==="race") {
    const features=index.all.filter(it=>it.kind==="raceFeature"&&canon(it.record.raceName)===canon(record.name)&&canon(it.record.source)===canon(record.source));
    if(features.length)addAdv(adv,advancement("ItemGrant","Species Features",0,{items:features.map((f,i)=>({uuid:f.uuid,optional:false,sort:i})),optional:false,sorting:"m",spell:null}));
  } else if (kind==="background") {
    const grants=featRefForBackground(index,record,report);
    if(grants.length)addAdv(adv,advancement("ItemGrant","Origin Feat",0,{items:grants,optional:false,sorting:"m",spell:null}));
  } else if (kind==="class"||kind==="subclass"){
    const byLevel=new Map();
    for(const ref of record[kind==="class"?"classFeatures":"subclassFeatures"]??[]){
      const uid=typeof ref==="string"?ref:ref[kind==="class"?"classFeature":"subclassFeature"];
      if(!uid)continue;
      const feature=lookupUid(index,kind==="class"?"classFeature":"subclassFeature",uid,record.source);
      if(!feature){report.unresolved.add(`${record.name}: ${uid}`);continue;}
      const level=Number(feature.record.level)||1;
      if(!byLevel.has(level))byLevel.set(level,[]);
      byLevel.get(level).push({uuid:feature.uuid,optional:false,sort:byLevel.get(level).length});
    }
    for(const [level,items] of byLevel.entries())
      addAdv(adv,advancement("ItemGrant",`${kind==="class"?"Class":"Subclass"} Features`,level,
        {items,optional:false,sorting:"m",spell:null}));
    if(kind==="class"){
      // Each book declares the subclass entry point in classFeatures. Do not
      // assume level 3, 1, or another rule tied to a particular edition.
      const entry=(record.classFeatures??[]).find(it=>it && typeof it==="object" && it.gainSubclassFeature);
      if(entry){
        const uid=entry.classFeature??"";
        const level=Number(uid.split("|").at(-1));
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
  return index.all.filter(it=>{
    if(it.kind!=="spell")return false;
    if(level!==null && Number(it.record.level)!==Number(level))return false;
    const entry=index.spellLookup?.[canon(it.record.source)]?.[canon(it.record.name)];
    return Object.entries(entry?.class??{}).some(([src,classes])=>
      canon(src)===source && Object.keys(classes).some(n=>canon(n)===wanted));
  });
}
const itemChoiceConfig=(refs, choices, type="feat", restriction={type:"",subtype:"",level:"",list:[],school:[]}, spell=null)=>({
  allowDrops:false,choices,pool:refs.map((it,i)=>({uuid:it.uuid,sort:i*10000})),
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
  const classPool=spellRefsForClass(index,record.name,record.source);
  if(record.preparedSpellsProgression||record.cantripProgression||record.spellsKnownProgression){
    // The 5etools source lookup knows every spell on the class list, including
    // books not being imported. Flag local incompleteness instead of disguising
    // an undersized pool as a full class spell list.
    const total=Object.entries(index.spellLookup??{}).reduce((sum,[src,spells])=>
      sum+Object.values(spells).filter(spell=>Object.entries(spell.class??{}).some(([listSource,classes])=>
        canon(listSource)===canon(record.source) && Object.keys(classes).some(n=>canon(n)===canon(record.name)))).length,0);
    if(total>classPool.length)report.incomplete.add(`${record.name}: only ${classPool.length}/${total} spells on the class list are included in this book; other books must be resolved`);
  }
  if(!classPool.length && (record.preparedSpellsProgression||record.cantripProgression||record.spellsKnownProgression)){
    report.unresolved.add(`${record.name}: 5etools spell-source catalog contains no local spells for this class`);
    return;
  }
  const spells=[
    {progression:record.cantripProgression,level:"0",name:"Choose Cantrips", cantrip:true},
    {progression:record.preparedSpellsProgression??record.spellsKnownProgression,level:"",name:"Choose Spells",cantrip:false}
  ];
  for(const spec of spells){
    const options=classPool.filter(it=>spec.cantrip ? Number(it.record.level)===0 : Number(it.record.level)>0);
    const choices=cumulativeChoices(spec.progression,true);
    if(!Object.keys(choices).length)continue;
    if(!options.length){report.unresolved.add(`${record.name}: no imported spells available for ${spec.name}`);continue;}
    const config=itemChoiceConfig(options,choices,"spell",{type:"",subtype:"",level:spec.level,list:[],school:[]},
      {ability:record.spellcastingAbility?[record.spellcastingAbility]:[], method:"spell",
        uses:{max:"",per:"",requireSlot:false},prepared:2});
    addAdv(adv,choiceAdv(spec.name,1,config,
      {kind:"spellProgression",source:record.source,class:record.name,cantrip:spec.cantrip}));
  }
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
function applyAdditionalSpellChoices(record,index,adv,report){
  if(!Array.isArray(record.additionalSpells))return;
  const groups=new Map();let found=0;
  for(const [variant,block] of record.additionalSpells.entries()){
    const choices=collectSpellChoices(block);
    for(const choice of choices){
      if(!Number.isInteger(choice.count)||choice.count<1)continue;
      found++;
      const key=`${choice.level}|${choice.count}|${choice.daily}`;
      if(!groups.has(key))groups.set(key,{...choice,classes:new Set(),variants:[]});
      const group=groups.get(key);group.classes.add(choice.className);
      group.variants.push({variant,className:choice.className});
    }
  }
  for(const [key,entry] of groups){
    const pool=[...new Map([...entry.classes].flatMap(className=>
      spellRefsForClass(index,className,record.source,entry.level)).map(it=>[it.uuid,it])).values()];
    if(!pool.length){report.unresolved.add(`${record.name}: no local spells for ${key} choice`);continue;}
    const abilities=[...new Set(record.additionalSpells.flatMap(block=>{
      const v=block?.ability;
      return typeof v==="string"?[v]:Array.isArray(v?.choose)?v.choose:[];
    }))];
    const config=itemChoiceConfig(pool,{"0":{count:entry.count,replacement:false}},"spell",
      {type:"",subtype:"",level:String(entry.level),list:[],school:[]},
      {ability:abilities,method:"spell",uses:{max:entry.daily?"1":"",per:entry.daily?"lr":"",requireSlot:false},prepared:2});
    addAdv(adv,choiceAdv(`Choose ${entry.count} Level ${entry.level} Spell${entry.count>1?"s":""}`,0,config,
      {kind:"additionalSpells",source:record.source,variants:entry.variants}));
    if(entry.classes.size>1)report.incomplete.add(`${record.name}: cross-choice class-list coupling is not yet enforced`);
  }
  // Other additionalSpells shapes are retained in provenance, but not silently declared complete.
  if(!found)report.incomplete.add(`${record.name}: additionalSpells without supported choice pattern need grant conversion`);
  else report.incomplete.add(`${record.name}: fixed additionalSpells grants and cast/slot semantics need verification`);
}

const classProgress = r=>({progression: r.casterProgression==="pact"?"pact":r.casterProgression??"none",ability:r.spellcastingAbility??""});
function classifyItem(r){
  const type=String(r.type??"").split("|")[0].toUpperCase();
  if(["M","R"].includes(type))return "weapon";
  if(["LA","MA","HA","S","SCF"].includes(type))return "equipment";
  if(["AT","T","GS","INS"].includes(type))return "tool";
  if(["P","SC","FD","A"].includes(type)||r.miscTags?.includes("CNS"))return "consumable";
  return "loot";
}
function getOverlay(kind,record,foundry){
  const type=kind==="raceFeature"?"raceFeature":kind;
  const file = ["class","subclass","classFeature","subclassFeature"].includes(kind)?foundry.class:
    ["race","raceFeature"].includes(kind)?foundry.race:foundry[kind];
  return (file?.[type]??[]).find(it=>canon(it.name)===canon(record.name)&&canon(it.source)===canon(record.source)
    && (!it.className||canon(it.className)===canon(record.className))
    && (!it.raceName||canon(it.raceName)===canon(record.raceName))
    && (!it.level||Number(it.level)===Number(record.level)))??null;
}
// 5etools supplements use their own foundryId and @spell/@creature references.
// Convert them to native, typed Foundry UUIDs and 16-character activity IDs BEFORE persistence.
const OLD_EFFECT_MODES={0:"custom",1:"multiply",2:"add",3:"downgrade",4:"upgrade",5:"override"};
function normalizeEffects(arr,kind,record,report){
  const out=[];
  for(const [i,e] of (arr??[]).entries()){
    if(!e||typeof e!=="object")continue;
    const changes=(e.changes??[]).map(change=>{
      const c={...change};
      const type=typeof c.type==="string"?c.type:
        typeof c.mode==="string"?c.mode.toLowerCase():OLD_EFFECT_MODES[c.mode];
      delete c.mode;
      if(type)c.type=type;
      else {report.incomplete.add(`${record.name}: unknown ActiveEffect change type ${String(change.mode)}`);c.type="add";}
      return c;
    });
    out.push({_id:`eff${String(i+1).padStart(13,"0")}`,name:e.name??`${record.name} Effect ${i+1}`,
      ...(e.type?{type:e.type}:{}),description:e.description??"",disabled:e.disabled??false,
      transfer:e.transfer??true,changes,duration:e.duration??{},
      flags:{bcc:{foundryId:e.foundryId??""}}});
  }
  return out;
}
function resolveOverlayUUID(value, index, expectedKind, report, context){
  if(typeof value!=="string"||!value.trim())return null;
  const native=value.match(/^Compendium\.[^.]+\.[^.]+\.(Item|Actor)\.[A-Za-z0-9]{16}$/);
  if(native){
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
  const base={_id,name:record.name,flags:originFlags(kind,record,content.sourceId)};
  if(kind==="chapter"){
    return {...base,pages:[{name:record.name,type:"text",text:{content:renderEntries(record.chapter,index,record.source,report)}}]};
  }
  if(["monster","object","vehicle"].includes(kind)){
    const abilities={};for(const ability of ABILITIES)if(record[ability]!=null)abilities[ability]={value:Number(record[ability])};
    const type=kind==="vehicle"?"vehicle":"npc";
    report.incomplete.add(`${record.name}: ${kind} requires actions/defenses/HP automation`);
    return {...base,type,system:{abilities,details:{biography:{value:desc}}}};
  }
  const sys={description:{value:desc},source:sourceMeta(record),identifier:slug(record.name)};
  const adv={};
  let spellSynthesisIssues=[];
  if(kind==="race"){
    sys.type={value:(record.creatureTypes?.[0]??"humanoid"),subtype:record.name};
    sys.movement={speeds:{walk:record.speed?.walk??record.speed??30},units:"ft"};
    const sizes=(record.size??[]).map(k=>SIZE_MAP[k]).filter(Boolean);
    if(sizes.length)addAdv(adv,advancement("Size","Size",0,{sizes}));
    applyTraits(record,adv,report);
  } else if(kind==="background"){
    const allowed=record.ability?.[0]?.choose?.weighted?.from??[];
    if(allowed.length){addAdv(adv,advancement("AbilityScoreImprovement","Background Ability Scores",0,
      {cap:2,points:3,locked:ABILITIES.filter(v=>!allowed.includes(v)),fixed:Object.fromEntries(ABILITIES.map(a=>[a,0]))}));}
    applyTraits(record,adv,report);
  } else if(kind==="class"){
    sys.hd={denomination:`d${record.hd?.faces??8}`};
    sys.spellcasting=classProgress(record);
    addAdv(adv,advancement("HitPoints","Hit Points",1,{}));
    const sk=valuesFromProficiency(record.startingProficiencies?.skills,"skills");
    if(sk.choices.length||sk.grants.length)addAdv(adv,advancement("Trait","Class Skills",1,
      {mode:"default",allowReplacements:false,...sk}));
    applyClassChoices(record,index,adv,report);
    report.incomplete.add(`${record.name}: subclass advancement and spell choices require Character Builder verification`);
  } else if(kind==="subclass"){
    sys.classIdentifier=slug(record.className);
  } else if(kind==="feat"||kind==="optionalfeature"||kind.endsWith("Feature")){
    sys.type={value:kind==="feat"?"feat":"class",subtype:kind==="feat"?({O:"origin",G:"general",EB:"epic"}[record.category]??""):""};
    sys.requirements=record.className??record.raceName??"";
    sys.prerequisites={repeatable:!!record.repeatable,items:[]};
    if(kind==="feat")applyFeatAbilityAdvancement(record,adv,report);
    if(record.additionalSpells)applyAdditionalSpellChoices(record,index,adv,report);
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
    sys.quantity=1;
    if(record.weight!=null)sys.weight={value:record.weight,units:"lb"};
    if(record.value!=null)sys.price={value:record.value/100,denomination:"gp"};
  }
  if(["race","background","class","subclass"].includes(kind))await buildGrants(index,kind,record,adv,report);
  const overlay=getOverlay(kind,record,content.foundry);
  let effects=[];
  if(overlay){
    if(overlay.system)for(const [path,value] of Object.entries(overlay.system))foundry.utils.setProperty(sys,path,value);
    if(Array.isArray(overlay.advancement))for(const a of overlay.advancement) {
      // Native supplement can bring valid ScaleValue advancements.
      if(a.type==="ScaleValue")addAdv(adv,{...structuredClone(a),_id:`a${String(Object.keys(adv).length).padStart(15,"0")}`,level:0,value:{}});
      else report.incomplete.add(`${record.name}: supplemental ${a.type} advancement deferred`);
    }
    effects=normalizeEffects(overlay.effects,kind,record,report);
    if(overlay.activities?.length){
      const native=normalizeActivities(overlay.activities,effects,index,record,report);
      if(Object.keys(native).length) {
        // An actual 5etools Foundry supplement takes precedence over inference.
        sys.activities=native;
        if(kind==="spell")spellSynthesisIssues=[];
      }
    }
  }
  if(kind==="spell")for(const issue of spellSynthesisIssues)
    report.incomplete.add(`${record.name}: ${issue}`);
  if(Object.keys(adv).length)sys.advancement=adv;
  const documentType=kind==="raceFeature"||["classFeature","subclassFeature","optionalfeature"].includes(kind)?"feat":
    kind==="item"?classifyItem(record):PACK_DEFS[kind][3];
  if(kind==="spell" && !Object.keys(sys.activities??{}).length)report.incomplete.add(`${record.name}: spell has no native Activity`);
  return {...base,type:documentType,system:sys,...effects.length?{effects}:{} };
}
export function createReport(content){return {sourceId:content.sourceId,counts:{...content.counts},
  created:{},existing:{},errors:[],warnings:[],validationFailures:[],unresolved:new Set(),incomplete:new Set(),unlocalizedImages:new Set()};}
export function finalizeReport(report){return {...report,unresolved:[...report.unresolved],incomplete:[...report.incomplete],unlocalizedImages:[...report.unlocalizedImages],
  generatedAt:new Date().toISOString()};}
export { PACK_DEFS };
