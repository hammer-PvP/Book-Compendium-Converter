import {parseSpellFilter,matchesSpellMetadata} from "./spell-filter.mjs";
const slug=v=>String(v??"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const list=v=>v instanceof Set?[...v]:Array.isArray(v)?v:v==null?[]:[v];
const raw=d=>d?.toObject?d.toObject():d;
const text=v=>typeof v==="string"?v:Array.isArray(v)?v.map(text).join(" "):v&&typeof v==="object"?Object.values(v).map(text).join(" "):"";
function serialFilter(filter){return {...filter,levels:filter.levels?[...filter.levels]:null};}
function spellCondition(value,record){
  if(typeof value==="string")return {kind:"item",type:"spell",identifier:slug(value.split("|")[0].replace(/#.*$/,"")),label:value.split("|")[0]};
  if(!value||typeof value.choose!=="string")return {kind:"unsupported",label:"Unsupported spell prerequisite"};
  let filter=parseSpellFilter(value.choose);if(!filter)return {kind:"unsupported",label:value.entrySummary??value.entry??value.choose};
  // Structured entry filters may be more precise than prerequisite.choose.
  for(const match of text(record.entries).matchAll(/\{@filter\s+[^|}]+\|spells\|([^}]+)\}/g)){
    const richer=parseSpellFilter(match[1]);
    if(richer&&JSON.stringify(richer.classes??[])===JSON.stringify(filter.classes??[])&&JSON.stringify([...(richer.levels??[])])===JSON.stringify([...(filter.levels??[])])){filter={...filter,...richer};break;}
  }
  const range=/range of (\d+)\+ (?:feet|ft)/i.exec(text(record.entries));if(range)filter.minimumRange=Number(range[1]);
  if(/deals? damage/i.test(value.entry??"")&&!filter.damageTypes)filter.dealsDamage=true;
  return {kind:"spellFilter",filter:serialFilter(filter),label:value.entrySummary??value.entry??value.choose};
}
export function compilePrerequisites(record){
  if(!Array.isArray(record.prerequisite)||!record.prerequisite.length)return null;
  const any=record.prerequisite.map(group=>({all:Object.entries(group).map(([key,value])=>{
    if(key==="level")return {kind:"level",minimum:Number(typeof value==="number"?value:value.level),className:typeof value==="object"?value.class?.name??null:null,label:`${typeof value==="object"?value.class?.name??"Character":"Character"} level ${typeof value==="number"?value:value.level}`};
    if(key==="spell")return {any:list(value).map(v=>spellCondition(v,record))};
    if(["feat","feature","optionalfeature","item"].includes(key))return {any:list(value).map(v=>typeof v==="string"?{kind:"item",type:key==="item"?null:"feat",identifier:slug(v.split("|")[0].replace(/#.*$/,"")),label:v.split("|")[0]}:{kind:"unsupported",label:`Unsupported ${key} prerequisite`})};
    if(key==="ability")return {any:list(value).map(v=>({all:Object.entries(v).map(([ability,minimum])=>({kind:"ability",ability,minimum:Number(minimum),label:`${ability.toUpperCase()} ${minimum}`}))}))};
    if(key==="race")return {any:list(value).map(v=>typeof v==="object"&&Object.keys(v).some(k=>!["name","source"].includes(k))?{kind:"unsupported",label:"Species prerequisite needs a lineage-aware review"}:{kind:"item",type:"race",identifier:slug(typeof v==="string"?v:v.name),label:typeof v==="string"?v:v.name})};
    if(["spellcasting","spellcasting2020","spellcastingFeature"].includes(key)&&value===true)return {kind:"spellcasting",mode:key,label:key==="spellcasting"?"Ability to cast a spell":key==="spellcasting2020"?"Spellcasting or Pact Magic Feature":"Spellcasting Feature"};
    return {kind:"unsupported",label:`Prerequisite requires review: ${key}`};
  })}));
  return {version:1,any};
}
export function spellMetadata(record,index){
  const memberships=index.spellLookup?.[String(record.source).toLowerCase()]?.[String(record.name).toLowerCase()]?.class??{};
  return {level:Number(record.level),school:record.school,damageInflict:record.damageInflict??[],spellAttack:record.spellAttack??[],range:record.range??{},meta:record.meta??{},classes:[...new Set(Object.values(memberships).flatMap(group=>Object.keys(group).map(slug)))]};
}
function originClass(item,items,seen=new Set()){
  const d=raw(item),flags=d.flags??{};
  // These are acquisition metadata fields, not class-specific rules.
  for(const f of Object.values(flags)){
    const explicit=f?.classSpellAccess?.classIdentifier??f?.levelUpSpell?.classIdentifier??f?.classIdentifier;if(explicit)return slug(explicit);
  }
  if(d.system?.classIdentifier)return slug(d.system.classIdentifier);
  const source=String(d.system?.sourceItem??"");if(source.startsWith("class:"))return slug(source.slice(6));
  const refs=[source,flags.dnd5e?.advancementRoot,flags.dnd5e?.advancementOrigin];
  for(const ref of refs){const owner=items.find(i=>{const v=raw(i),id=v._id??i.id;return id&&String(ref??"").split(".").includes(id);});if(owner){const o=raw(owner),id=o._id??owner.id;if(seen.has(id))continue;seen.add(id);if(o.type==="class")return slug(o.system?.identifier??o.name);if(o.type==="subclass"&&o.system?.classIdentifier)return slug(o.system.classIdentifier);const inherited=originClass(owner,items,seen);if(inherited)return inherited;}}
  return null;
}
export function prerequisiteContext(actor,{items,levels}={}){
  const docs=items??list(actor?.items?.contents??actor?.items),classes=new Map();
  for(const item of docs){const d=raw(item);if(d.type==="class")classes.set(slug(d.system?.identifier??d.name),Number(d.system?.levels??0));}
  for(const state of Object.values(actor?.flags??{}))if(state?.levelUpState){const s=state.levelUpState,cls=docs.find(i=>(i.id??raw(i)._id)===s.selectedClassId);if(cls)classes.set(slug(raw(cls).system?.identifier??raw(cls).name),Number(s.targetClassLevel??classes.get(slug(raw(cls).name))));}
  for(const [key,value] of Object.entries(levels??{}))classes.set(slug(key),Number(value));
  return {actor,items:docs,classes,characterLevel:Math.max(Number(actor?.system?.details?.level??0),[...classes.values()].reduce((a,b)=>a+b,0))};
}
function status(qualified,reason=""){return {qualified,unsupported:false,reason:qualified?"":reason};}
function evaluateNode(node,ctx){
  if(node.all||node.any){const rows=(node.all??node.any).map(n=>evaluateNode(n,ctx));
    if(node.all){const failed=rows.find(r=>!r.qualified&&!r.unsupported);if(failed)return failed;return rows.find(r=>r.unsupported)??status(true);}
    if(rows.some(r=>r.qualified))return status(true);return rows.find(r=>r.unsupported)??status(false,rows.map(r=>r.reason).filter(Boolean).join(" or "));
  }
  if(node.kind==="level")return status((node.className?ctx.classes.get(slug(node.className))??0:ctx.characterLevel)>=node.minimum,`Requires ${node.label}`);
  if(node.kind==="ability")return status(Number(ctx.actor?.system?.abilities?.[node.ability]?.value??0)>=node.minimum,`Requires ${node.label}`);
  if(node.kind==="item")return status(ctx.items.some(i=>{const d=raw(i);return (!node.type||d.type===node.type)&&(slug(d.system?.identifier??d.name)===node.identifier||slug(d.flags?.bcc?.originalName??d.name)===node.identifier||node.type==="race"&&d.flags?.bcc?.speciesIdentifiers?.includes(node.identifier));}),`Requires ${node.label}`);
  if(node.kind==="spellcasting")return status(ctx.items.some(i=>{const d=raw(i),progression=d.system?.spellcasting?.progression;if(d.type==="class"&&progression&&progression!=="none")return node.mode!=="spellcastingFeature"||progression!=="pact";return node.mode==="spellcasting"&&(d.type==="spell"||Object.values(d.system?.activities??{}).some(a=>a.type==="cast"));}),`Requires ${node.label}`);
  if(node.kind==="spellFilter")return status(ctx.items.some(i=>spellMatches(i,node.filter,ctx)),`Requires ${node.label}`);
  return {qualified:false,unsupported:true,reason:node.label??"Prerequisite requires review"};
}
export function spellMatches(item,filter,ctx){
  const d=raw(item);if(d.type!=="spell")return false;
  const meta=d.flags?.bcc?.spellMetadata??{level:Number(d.system?.level??0),school:d.system?.school,damageInflict:[...new Set(Object.values(d.system?.activities??{}).flatMap(a=>(a.damage?.parts??[]).flatMap(p=>list(p.types))))],spellAttack:Object.values(d.system?.activities??{}).filter(a=>a.type==="attack").map(a=>String(a.attack?.type?.value??"").slice(0,1)),range:{type:d.system?.range?.value==="self"?"self":"point",distance:{amount:Number(d.system?.range?.value),type:d.system?.range?.units}},meta:{ritual:list(d.system?.properties).includes("ritual")}};
  if(!matchesSpellMetadata(meta,filter))return false;
  if(filter.dealsDamage&&!meta.damageInflict?.length)return false;
  if(filter.minimumRange){const distance=meta.range?.distance,feet=Number(distance?.amount??0)*(distance?.type==="miles"?5280:1);if(!Number.isFinite(feet)||feet<filter.minimumRange)return false;}
  if(filter.classes?.length){const owner=originClass(item,ctx.items);if(owner)return filter.classes.map(slug).includes(owner);
    // A single owning caster class plus explicit source-list membership is
    // unambiguous; multiclass acquisitions need their real granting metadata.
    const possible=[...ctx.classes.keys()].filter(c=>meta.classes?.includes(c));if(possible.length!==1||!filter.classes.map(slug).includes(possible[0]))return false;
  }
  return true;
}
export function evaluatePrerequisites(expression,actor,options={}){if(!expression)return status(true);if(expression.version!==1)return {qualified:false,unsupported:true,reason:"Unknown prerequisite format"};return evaluateNode(expression,prerequisiteContext(actor,options));}
export function prerequisiteSelectors(expression){const out=[];function walk(n){if(n.kind==="spellFilter")out.push(n);for(const c of n.all??n.any??[])walk(c);}if(expression)walk(expression);return out;}
export function unsupportedPrerequisites(expression){const out=[];function walk(n){if(n.kind==="unsupported")out.push(n.label);for(const c of n.all??n.any??[])walk(c);}if(expression)walk(expression);return out;}
