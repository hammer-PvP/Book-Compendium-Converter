import {canonical as canon} from "./data-model.mjs";

/** A named stat-block reference is sufficient to link a native summon profile,
 * never to invent unprovided scaling formulas or lifecycle automation. */
export function addSummonProfiles(record,system,index,report){
  if(!record.miscTags?.includes("SMN"))return false;
  if(Object.values(system.activities??{}).some(a=>a.type==="summon"&&a.profiles?.length))return false;
  const refs=new Map();
  function scan(value){
    if(typeof value==="string"&&/stat block/i.test(value))for(const m of value.matchAll(/\{@creature\s+([^}]+)\}/gi)){
      const [name,source="MM"]=m[1].split("|");
      const actors=index.all.filter(e=>e.kind==="monster"&&canon(e.record.name)===canon(name)&&canon(e.record.source)===canon(source));
      if(actors.length===1)refs.set(actors[0].uuid,actors[0]);
      else report.unresolved.add(`${record.name}: summon Actor ${m[1]} is missing or ambiguous`);
    }
    else if(Array.isArray(value))value.forEach(scan);
    else if(value&&typeof value==="object")scan(value.entries??value.items??[]);
  }
  scan(record.entries);if(!refs.size)return false;
  const fallback=Object.values(system.activities??{}).find(a=>a.type==="utility");
  const id=fallback?._id??"bccSummonProfile";
  (system.activities??={})[id]={...fallback,_id:id,name:"Summon",type:"summon",summon:{prompt:true,mode:""},
    profiles:[...refs.values()].map((r,i)=>({_id:`bccProf${String(i+1).padStart(9,"0")}`,name:r.record.name,uuid:r.uuid,count:"1"}))};
  report.information.add(`${record.name}: native Summon profiles linked to explicit source stat blocks`);
  report.incomplete.add(`${record.name}: summon stat-block scaling and lifecycle require live validation`);
  return true;
}
