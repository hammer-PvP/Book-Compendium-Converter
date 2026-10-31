import {plainText,canonical} from "./data-model.mjs";
import {parseSpellFilter} from "./spell-filter.mjs";
const slug=value=>String(value??"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
/** Classify the timing/representation of source recipes, never an entity name. */
export function spellChoicePolicy(record,selector,{mode,count=1},overlay){
  const text=plainText(record._bccGrantText??record.entries);
  const restObject=/\b(?:conjure|create|summon)\b[^.!?]{0,160}\b(?:at|by) the end of\b[^.!?]{0,160}\brest\b/i.test(text)
    &&/\bwhen (?:the|this|your) [^.!?]{1,70}\bappears\b[^.!?]{0,12}\bchoose\b/i.test(text);
  if(restObject)return {representation:"deferred",trigger:"rest-created-resource",periods:[...(/short(?:\s+or\s+long)?\s+rest/i.test(text)?["sr"]:[]),...(/long(?:\s+or\s+short)?\s+rest/i.test(text)?["lr"]:[])],reason:"Choice belongs to the resource created at rest, rather than a new acquisition Advancement"};
  const parsed=typeof selector==="string"?parseSpellFilter(selector):null;
  const parent=record.className;
  if(mode==="known"&&parent&&parsed?.levels?.size===1&&parsed.levels.has(0)&&parsed.classes?.length===1&&canonical(parsed.classes[0])===canonical(parent)){
    const key=`system.scale.${slug(parent)}.cantrips-known`;
    const changes=[...(overlay?.effects??[]),...(record.foundryEffects??[])].filter(e=>e.transfer!==false).flatMap(e=>e.system?.changes??e.changes??[]);
    const native=changes.filter(c=>c.key===key&&["add","2"].includes(String(c.type??c.mode??"add").toLowerCase())).reduce((n,c)=>n+Number(c.value||0),0);
    if(native>0&&native!==count)return {representation:"native",trigger:"acquisition",warning:"Native cantrip scale and spell-choice recipe disagree; retained for review"};
    if(native===count||/\b(?:extra|additional)\b[^.!?]{0,35}\bcantrip\b/i.test(text))return {representation:"derived-scale",classIdentifier:slug(parent),key,count,addEffect:native!==count,reason:"Additional class cantrip entitlement is represented by the native derived scale"};
  }
  return {representation:"native",trigger:"acquisition"};
}
export function entitlementEffects(decisions){
  return decisions.filter(d=>d.representation==="derived-scale"&&d.addEffect).map((d,i)=>({_id:`ent${String(i+1).padStart(13,"0")}`,name:"Additional Cantrip Entitlement",type:"base",transfer:true,disabled:false,img:"icons/svg/upgrade.svg",system:{changes:[{key:d.key,type:"add",value:String(d.count)}]},flags:{bcc:{grantEntitlement:true}}}));
}
