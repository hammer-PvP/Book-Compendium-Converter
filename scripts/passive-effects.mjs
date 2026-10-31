import {plainText} from "./data-model.mjs";

function lines(value,out=[],gated=false){
  if(typeof value==="string")out.push({text:plainText(value),gated});
  else if(Array.isArray(value)){
    let context=gated;
    for(const child of value){lines(child,out,context);if(typeof child==="string"&&/\b(?:while|when|if|until)\b[^.!?]*(?:following|benefits|:)\s*:?$/i.test(plainText(child)))context=true;}
  }
  else if(value&&typeof value==="object")lines(value.entries??value.entry??value.items??[],out,gated);
  return out;
}
/** Only unconditional, complete source statements are interpreted. Structured
 * source effects always win; conditional and activated bonuses stay explicit. */
export function addPassiveEffects(record,kind,effects,report){
  if(!["raceFeature","classFeature","subclassFeature","optionalfeature","feat"].includes(kind))return;
  const changes=[];
  const existing=key=>effects.some(e=>e.transfer!==false&&!e.disabled&&(e.system?.changes??e.changes??[]).some(c=>c.key===key));
  const nodes=lines(record.entries),text=nodes.map(n=>n.text),bonusKey="system.attributes.ac.bonus";
  const activated=text.some(line=>/\b(?:as (?:an?|a bonus) action|for (?:the next )?\d+ (?:minute|round|hour)|until the (?:start|end) of)\b/i.test(line));
  const bonuses=nodes.filter(n=>!n.gated&&!activated).flatMap(({text:line})=>line.split(/(?<=[.!?])\s+/).flatMap(sentence=>{
    const m=/^You (?:gain|have) (?:a |an )?\+([1-9]\d?) bonus to (?:your )?(?:Armor Class|AC)\.$/i.exec(sentence.trim());
    return m?[Number(m[1])]:[];
  }));
  if(new Set(bonuses).size===1&&!existing(bonusKey))changes.push({key:bonusKey,type:"add",value:String(bonuses[0])});
  if(record._bccOption)for(const sense of ["darkvision","blindsight","tremorsense","truesight"]){
    const value=record[sense],key=`system.attributes.senses.ranges.${sense}`;
    if(typeof value==="number"&&value>0&&!existing(key))changes.push({key,type:"upgrade",value:String(value)});
  }
  if(changes.length){
    let n=effects.length+1,id;do{id=`eff${String(n++).padStart(13,"0")}`;}while(effects.some(e=>e._id===id));
    effects.push({_id:id,name:record.name,type:"base",disabled:false,transfer:true,img:"icons/svg/aura.svg",system:{changes},flags:{bcc:{sourcePattern:"unconditional-passive",source:record.source}}});
    report.information.add(`${record.name}: native passive effect derived from explicit source mechanics`);
  }
  if(!existing(bonusKey)&&text.some(s=>/\bbonus to (?:your )?(?:Armor Class|AC)\b/i.test(s)))report.incomplete.add(`${record.name}: conditional or unsupported AC bonus retained in description; no passive bonus invented`);
}
