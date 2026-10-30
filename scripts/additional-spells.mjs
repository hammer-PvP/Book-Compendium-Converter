import {canonical as lc} from "./data-model.mjs";
import {parseSpellFilter,matchesSpellMetadata} from "./spell-filter.mjs";
export function preferredCandidates(refs,owner={}){
  const out=new Map();
  const ownerRules=owner._bccRules??owner.edition;
  const rank=e=>(owner.source&&lc(e.record.source)===lc(owner.source)?4:0)+(ownerRules&&(e.record._bccRules??e.record.edition)===ownerRules?2:0)+(e.record._bccDependency?0:1);
  for(const entry of refs){const key=`${entry.kind}|${lc(entry.record.name)}`,previous=out.get(key);if(!previous||rank(entry)>rank(previous))out.set(key,entry);}
  return [...out.values()].sort((a,b)=>Number(a.record.level??0)-Number(b.record.level??0)||a.record.name.localeCompare(b.record.name,"en"));
}
export function filterSpellPool(filter,index,record,classPool,report) {
  const parsed=parseSpellFilter(filter);
  if(!parsed){report?.incomplete.add(`${record.name}: unsupported spell filter ${filter}`);return [];}
  const pool=parsed.classes?[...new Map(parsed.classes.flatMap(name=>classPool(index,name,record.source)).map(e=>[e.uuid,e])).values()]:index.all.filter(e=>e.kind==="spell");
  return preferredCandidates(pool.filter(e=>matchesSpellMetadata(e.record,parsed)),record);
}
export function expandedSpellPool(record,index,classPool,lookup,report) {
  const out=new Map();
  function walk(v){
    if(typeof v==="string"){const ref=lookup(index,"spell",v.replace(/#.*$/,""),record.source);if(ref)out.set(ref.uuid,ref);else report.unresolved.add(`${record.name}: expanded spell ${v}`);}
    else if(Array.isArray(v))v.forEach(walk);
    else if(v&&typeof v==="object"){
      if(typeof v.all==="string"||typeof v.choose==="string")for(const ref of filterSpellPool(v.all??v.choose,index,record,classPool,report))out.set(ref.uuid,ref);
      else if(v.choose?.from)walk(v.choose.from);
      else Object.values(v).forEach(walk);
    }
  }
  for(const block of record.additionalSpells??[])walk(block.expanded);
  return [...out.values()];
}
/** Preserve each recipe's level, ability and frequency instead of merging unrelated choices. */
export function addSpellRecipes(record,index,adv,report,{add,lookup,classPool,choiceConfig,choiceAdv}) {
  if (!record.additionalSpells?.length) return;
  if (record._bccAdditionalOptions?.length) {
    const pool = record._bccAdditionalOptions.map(name => lookup(index,"optionalfeature",`${name}|${record.source}`,record.source)).filter(Boolean);
    add(adv,choiceAdv("Choose Spellcasting Option",0,choiceConfig(pool,{"0":{count:1,replacement:false}},"feat"),{kind:"additionalSpellVariants"}));return;
  }
  for (const block of record.additionalSpells) {
    const ability = typeof block.ability === "string" ? [block.ability] : block.ability?.choose ?? [];
    function visit(value, context) {
      if (Array.isArray(value)) {for (const child of value) visit(child,context);return;}
      if (typeof value === "string") {
        const uid = value.replace(/#.*$/, ""), ref = lookup(index,"spell",uid,record.source);
        if (!ref) {report.unresolved.add(`${record.name}: additional spell ${uid}`);return;}
        if (context.mode === "expanded") return;
        const spell = {ability,method:context.mode === "innate" ? "innate" : "spell",prepared:2,uses:{max:context.count ? String(context.count) : "",per:context.period ?? "",requireSlot:false}};
        add(adv,{type:"ItemGrant",name:`${block.name ?? "Additional Spell"}: ${ref.record.name}`,level:context.level,configuration:{items:[{uuid:ref.uuid,optional:false,sort:0}],optional:false,sorting:"m",spell},value:{}});return;
      }
      if (!value || typeof value !== "object") return;
      if(context.mode==="expanded")return;
      if(value.all){for(const ref of filterSpellPool(value.all,index,record,classPool,report))visit(`${ref.record.name}|${ref.record.source}`,context);return;}
      if (value.choose) {
        let pool = [], level = null;
        if (typeof value.choose === "string") {
          const filter = value.choose;
          const levelMatch = /(?:^|\|)level=(\d+)(?:\||$)/i.exec(filter);
          level = levelMatch ? Number(levelMatch[1]) : null;
          pool = filterSpellPool(filter,index,record,classPool,report);
        } else if (Array.isArray(value.choose.from)) pool = value.choose.from.map(uid => lookup(index,"spell",uid,record.source)).filter(Boolean);
        if (!pool.length) {report.unresolved.add(`${record.name}: empty additional-spell choice`);return;}
        const spell = {ability,method:context.mode === "innate" ? "innate" : "spell",prepared:2,uses:{max:context.count ? String(context.count) : "",per:context.period ?? "",requireSlot:false}};
        const config = choiceConfig(pool,{[context.level]:{count:Number(value.count ?? value.choose?.count ?? 1),replacement:false}},"spell",{type:"",subtype:"",level:level == null ? "" : String(level),list:[],school:[]},spell);
        add(adv,choiceAdv(block.name ?? "Choose Additional Spell",context.level,config,{kind:"additionalSpells",mode:context.mode}));return;
      }
      for (const [key,child] of Object.entries(value)) {
        if (/^(?:daily|rest|weekly|resource|limited)$/.test(key)) {
          if (key === "resource" || key === "limited") {report.incomplete.add(`${record.name}: ${key} additional-spell consumption needs resource binding`);continue;}
          if(key==="weekly")report.incomplete.add(`${record.name}: weekly spell uses require manual recovery; no native weekly recovery period`);
          for (const [count,spells] of Object.entries(child)) visit(spells,{...context,count:parseInt(count),period:key === "rest" ? "sr" : key === "weekly" ? "" : /long rest/i.test(JSON.stringify(record.entries??[]))?"lr":"day"});
        } else if (/^\d+$/.test(key)) visit(child,{...context,level:Number(key)});
        else if (/^s\d+$/.test(key)) {report.incomplete.add(`${record.name}: spell-slot-level grant ${key} needs progression binding`);}
        else if (["_","will","ritual"].includes(key)) visit(child,context);
        else report.incomplete.add(`${record.name}: unsupported additional-spell key ${key}`);
      }
    }
    for (const mode of ["known","prepared","innate","expanded"]) if (block[mode]) visit(block[mode],{mode,level:0});
  }
}
