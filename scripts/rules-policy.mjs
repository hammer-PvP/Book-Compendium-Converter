import {clone,canonical as canon} from "./data-model.mjs";

export function recordRules(record){
  return record._bccRules??(record.edition==="one"?"2024":record.edition==="classic"?"2014":null);
}
/** Operates on a fresh graph, never on source caches or existing Actor choices. */
export function prepareRules(content,target="source"){
  if(!["source","2014","2024"].includes(target))throw Error("Invalid import rules target");
  const out=clone(content);out.targetRules=target;out.counts??={};out.dependencies??={};
  for(const rows of Object.values(out.records))for(const r of rows){
    r._bccTargetRules=target;
    // A compatibility copy may retain the old publication's edition flag.
    if(r.classSource){const parent=out.records.class.find(c=>canon(c.name)===canon(r.className)&&canon(c.source)===canon(r.classSource));
      if(parent&&recordRules(parent))r._bccRules=recordRules(parent);
    }
  }
  if(target!=="source"){
    const groups=new Map();
    for(const r of out.records.subclass){const key=[r.name,r.source,r.className].map(canon).join("|");if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
    out.records.subclass=[...groups.values()].flatMap(rows=>{const preferred=rows.filter(r=>recordRules(r)===target);return preferred.length===1?preferred:rows;});
  }
  for(const [kind,rows] of Object.entries(out.records)){out.counts[kind]=rows.length;out.dependencies[kind]=rows.filter(r=>r._bccDependency).length;}
  return out;
}
function moveChoices(table,floor){
  if(!table||Array.isArray(table))return table;
  const out={};
  for(const [key,row] of Object.entries(table)){
    const target=Number(key)>0&&Number(key)<floor?String(floor):key;
    if(out[target]&&typeof row==="object")out[target]={...out[target],...row,count:Number(out[target].count??0)+Number(row.count??0),replacement:!!out[target].replacement||!!row.replacement};
    else out[target]=clone(row);
  }
  return out;
}
export function applyRulesAdvancements(kind,record,adv,report){
  if(record._bccTargetRules!=="2024")return;
  const owner=kind==="subclass";
  for(const a of Object.values(adv)){
    if(!owner&&!(kind==="class"&&a.type==="Subclass"))continue;
    if(Number(a.level)>0&&Number(a.level)<3){a.level=3;report.information.add(`${record.name}: initial subclass Advancement delayed to class level 3 for 2024 compatibility`);}
    if(owner&&a.configuration?.choices)a.configuration.choices=moveChoices(a.configuration.choices,3);
    // Preserve scale progression, including its highest initial value at 3.
    if(owner&&a.type==="ScaleValue"&&a.configuration?.scale){
      const scale=a.configuration.scale,early=Object.keys(scale).map(Number).filter(n=>n>0&&n<3).sort((a,b)=>a-b);
      if(early.length){if(!scale[3])scale[3]=clone(scale[early.at(-1)]);early.forEach(n=>delete scale[n]);}
    }
  }
}
