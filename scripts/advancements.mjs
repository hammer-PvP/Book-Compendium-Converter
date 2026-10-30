import {clone} from "./data-model.mjs";
const domains=a=>a.classRestriction==="primary"?["primary"]:a.classRestriction==="secondary"?["secondary"]:["primary","secondary"];
function normalize(raw,slug){
  const value=clone(raw);value.name||=value.title??"";delete value.title;
  value.configuration??={};value.configuration.identifier||=slug(value.name);
  return value;
}
/** Native supplements override inferred scales only in their applicable class domain. */
export function upsertScaleValue(adv,raw,add,slug){
  const value=normalize(raw,slug),applies=domains(value);let reuse;
  for(const [key,old] of Object.entries(adv))if(old.type==="ScaleValue"&&
    (old.configuration?.identifier||slug(old.name??old.title))===value.configuration.identifier){
    const remaining=domains(old).filter(d=>!applies.includes(d));
    if(remaining.length===domains(old).length)continue;
    if(remaining.length)old.classRestriction=remaining[0];else{delete adv[key];reuse??=key;}
  }
  if(reuse)adv[reuse]={...value,_id:reuse,level:0,value:{}};
  else add(adv,{...value,_id:undefined,level:0,value:{}});
}
export function consolidateScaleValues(adv,slug,report,owner){
  const seen=new Map();
  for(const [key,raw] of Object.entries(adv))if(raw.type==="ScaleValue"){
    const a=normalize(raw,slug),id=a.configuration.identifier,used=seen.get(id)??new Set(),remaining=domains(a).filter(d=>!used.has(d));
    if(!remaining.length){delete adv[key];report.information?.add(`${owner}: repeated scale ${id} consolidated`);continue;}
    if(remaining.length===1)a.classRestriction=remaining[0];
    for(const d of remaining)used.add(d);seen.set(id,used);adv[key]=a;
  }
}
