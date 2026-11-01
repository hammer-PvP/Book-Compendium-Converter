import {transactionFor} from "./transactions.mjs";
const KEY=Symbol.for("bcc.spellGrants.v1"),running=new WeakMap();
const rows=v=>v?.contents??Array.from(v?.values?.()??v??[]);
const raw=d=>d?._source??d?.toObject?.()??d;
export function availableSlotLevel(actor){
  let maximum=0;
  for(const [key,slot] of Object.entries(actor?.system?.spells??{})){
    const level=key==="pact"?Number(slot.level):Number(/^spell(\d+)$/.exec(key)?.[1]);
    if(level&&Number(slot.max??slot.override??0)>0)maximum=Math.max(maximum,level);
  }
  return maximum;
}
export function grantEligible(advancement,actor){
  const condition=advancement.flags?.bcc?.spellGrantCondition;if(!condition)return true;
  return condition.kind==="slotLevel"&&availableSlotLevel(actor)>=condition.minimum;
}
/** Native ItemGrant remains the source of UUIDs, spell configuration and ownership.
 * Optional entries keep consumers which do not understand slot conditions from
 * granting them early; this runtime reconciles them only when eligible. */
export async function reconcileSpellGrants(actor){
  if(!actor||actor.type!=="character"||actor.pack||!actor.createEmbeddedDocuments||Object.values(actor.flags??{}).some(f=>f?.commitSafetyLock))return;
  if(running.has(actor))return running.get(actor);
  const task=(async()=>{
    for(const owner of rows(actor.items))for(const [key,adv] of Object.entries(raw(owner).system?.advancement??{})){
      if(adv.type!=="ItemGrant"||!adv.flags?.bcc?.spellGrantCondition||!grantEligible(adv,actor))continue;
      const origin=`${owner.id??owner._id}.${key}`,added={...(adv.value?.added??{})};let changed=false;
      for(const configured of adv.configuration?.items??[]){
        const uuid=configured.uuid;
        const existing=rows(actor.items).find(i=>{const d=raw(i);return d.flags?.dnd5e?.advancementOrigin===origin&&(d._stats?.compendiumSource===uuid||d.flags?.core?.sourceId===uuid||added[d._id]===uuid);});
        if(existing){if(Number(existing.system.prepared)!==2)await existing.update({"system.prepared":2});if(added[existing.id]!==uuid){added[existing.id]=uuid;changed=true;}continue;}
        const source=await globalThis.fromUuid(uuid);if(!source)throw Error(`${owner.name}: conditional spell is unavailable (${uuid})`);
        const data=source.toObject?source.toObject():structuredClone(source);delete data._id;
        data.system??={};data.system.prepared=2;data.system.method=adv.configuration.spell?.method??"spell";
        const abilities=rows(adv.configuration.spell?.ability);if(abilities.length===1)data.system.ability=abilities[0];
        else if(abilities.length>1){const chosen=adv.value?.ability;if(!chosen)throw Error(`${owner.name}: choose a spellcasting ability before granting this spell`);data.system.ability=chosen;}
        data.flags??={};data.flags.dnd5e={...data.flags.dnd5e,advancementOrigin:origin,advancementRoot:owner.flags?.dnd5e?.advancementRoot??origin};
        data.flags.bcc={...data.flags.bcc,conditionalSpellOwner:origin};data._stats={...data._stats,compendiumSource:uuid};
        const [created]=await actor.createEmbeddedDocuments("Item",[data],{bccConditionalGrant:true});
        if(!created)throw Error(`${owner.name}: conditional spell was not created`);
        added[created.id]=uuid;changed=true;
      }
      if(changed)await owner.update({[`system.advancement.${key}.value.added`]:added},{bccConditionalGrant:true});
    }
  })();running.set(actor,task);try{return await task;}finally{running.delete(actor);}
}
export function installGrantGuard(cls){
  const proto=cls?.prototype;if(!proto||proto[KEY])return;proto[KEY]=true;
  const apply=proto.apply,configured=proto.configuredForLevel,automatic=proto.automaticApplicationValue;
  proto.apply=async function(...args){if(!grantEligible(this,this.actor))return {};return apply.apply(this,args);};
  proto.configuredForLevel=function(...args){return !grantEligible(this,this.actor)||configured.apply(this,args);};
  proto.automaticApplicationValue=async function(...args){if(!grantEligible(this,this.actor))return {selected:[]};return automatic.apply(this,args);};
}
export function registerSpellGrantRuntime(){
  if(globalThis[KEY])return;globalThis[KEY]=true;
  const install=()=>installGrantGuard(globalThis.CONFIG?.DND5E?.advancementTypes?.ItemGrant?.documentClass);
  install();Hooks.once("ready",install);
  const pending=new Map();
  const schedule=document=>{
    const actor=document?.documentName==="Actor"?document:document?.actor??document?.parent;
    if(!actor||actor.type!=="character"||actor.pack||!game.user?.isGM||running.has(actor)||transactionFor(actor))return;
    clearTimeout(pending.get(actor));pending.set(actor,setTimeout(()=>{pending.delete(actor);if(transactionFor(actor))return;reconcileSpellGrants(actor).catch(e=>{console.error("BCC | Conditional spell grants",e);ui.notifications.error(e.message);});},100));
  };
  for(const name of ["createItem","updateItem","deleteItem","updateActor","bcc.itemsMaterialized"])Hooks.on(name,schedule);
}
