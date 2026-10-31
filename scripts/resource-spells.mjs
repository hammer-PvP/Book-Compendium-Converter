import {canonical as lc} from "./data-model.mjs";
export function resolveResource(index,record,name){
  // A consumption label can name either the resource pool or its owning Item.
  // Apply grammatical singular/plural matching without assuming a class name.
  const singular=value=>lc(value).replace(/\bdice\b/g,"die").replace(/ies$/, "y").replace(/s$/, "");
  let matches=index.all.filter(e=>(e.record.resources?.some(r=>singular(r.name)===singular(name))||singular(e.record.name)===singular(name))
    &&(!record.className||lc(e.record.className)===lc(record.className))
    &&(!record.classSource||lc(e.record.classSource??e.record.source)===lc(record.classSource)));
  const sameSource=matches.filter(e=>lc(e.record.source)===lc(record.classSource??record.source));
  if(sameSource.length)matches=sameSource;
  else if(record._bccRules){const compatible=matches.filter(e=>!e.record._bccRules||e.record._bccRules===record._bccRules);matches=compatible;}
  return matches.length===1?matches[0]:null;
}
/** A linked Cast activity spends the declared resource without granting a second
 * copy of the spell or inventing an unrelated per-day spell-use pool.
 */
export function addResourceSpellActivities(record,system,index,report){
  for(const [i,spec] of (record._bccResourceSpells??[]).entries()){
    const target=resolveResource(index,record,spec.resource);
    if(!target){report.unresolved.add(`${record.name}: spell resource ${spec.resource} has no unique definition`);continue;}
    if(Object.values(system.activities??{}).some(a=>a.type==="cast"&&a.spell?.uuid===spec.uuid)){
      report.incomplete.add(`${record.name}: resource spell ${spec.name} already has a supplemental Cast Activity; verify its consumption`);continue;
    }
    const id=`bccRes${String(i+1).padStart(10,"0")}`;
    (system.activities??={})[id]={_id:id,name:spec.name,type:"cast",spell:{uuid:spec.uuid,level:spec.spellLevel,ability:spec.ability,spellbook:false},
      consumption:{spellSlot:false,targets:[{type:"itemUses",target:target.uuid,value:String(spec.cost)}]},
      ...(spec.level?{activation:{condition:`Requires ${record.className??"character"} level ${spec.level}`,override:false}}:{})};
    (record._bccResourceBindings??=[]).push({activity:id,index:0,reference:{name:target.record.name,source:target.record.source,className:target.record.className,uuid:target.uuid}});
    report.information.add(`${record.name} / ${spec.name}: ${spec.cost} ${spec.resource}; native resource target will bind when granted to an Actor`);
  }
}
