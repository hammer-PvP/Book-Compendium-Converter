import {transactionFor} from "./transactions.mjs";
const KEY=Symbol.for("bcc.resourceBindings.v2"),raw=d=>d?.toObject?.()??d;
const norm=s=>String(s??"").trim().toLowerCase().replace(/\bdice\b/g,"die").replace(/ies$/,"y").replace(/s$/,"");
export function matchResource(items,ref){
  const exact=ref.uuid?items.filter(i=>{const d=raw(i);return d._stats?.compendiumSource===ref.uuid||d.flags?.core?.sourceId===ref.uuid||d.flags?.dnd5e?.sourceId===ref.uuid;}):[];
  const candidates=exact.length?exact:items.filter(i=>{const d=raw(i),name=ref.name??ref.consumes?.name;return !!name&&(norm(d.name)===norm(name)||(d.flags?.bcc?.resourceAliases??[]).some(n=>norm(n)===norm(name)))&&(!ref.source||norm(d.system?.source?.book)===norm(ref.source))&&(!ref.className||norm(d.system?.requirements)===norm(ref.className));});
  return candidates.length===1?candidates[0]:null;
}
export function resourceUpdates(items){
  const updates=[];
  for(const item of items){const d=raw(item),update={_id:item.id??d._id};let changed=false;
    for(const binding of d.flags?.bcc?.resourceBindings??[]){
      const target=matchResource(items,binding.reference),current=d.system?.activities?.[binding.activity]?.consumption?.targets?.[binding.index];if(!current)continue;
      const id=target?.id??target?._id??"";
      if(current.target!==id){update[`system.activities.${binding.activity}.consumption.targets.${binding.index}.target`]=id;changed=true;}
    }
    if(changed)updates.push(update);
  }
  return updates;
}
export function bindEmbeddedResources(items){for(const update of resourceUpdates(items)){const d=items.find(i=>(i.id??i._id)===update._id);for(const [key,value] of Object.entries(update)){if(key==="_id")continue;const parts=key.split(".");let current=d;for(const p of parts.slice(0,-1))current=current[p];current[parts.at(-1)]=value;}}}
export function registerResourceBindings(){
  if(globalThis[KEY])return;globalThis[KEY]=true;const pending=new Map();
  const schedule=item=>{const actor=item.documentName==="Actor"?item:item.actor??item.parent;if(!actor||actor.pack||!game.user?.isGM||transactionFor(actor)||Object.values(actor.flags??{}).some(f=>f?.commitSafetyLock)||game.users?.activeGM?.id&&game.users.activeGM.id!==game.user.id)return;
    clearTimeout(pending.get(actor));pending.set(actor,setTimeout(async()=>{pending.delete(actor);if(transactionFor(actor)||Object.values(actor.flags??{}).some(f=>f?.commitSafetyLock))return;const updates=resourceUpdates([...actor.items]);if(updates.length)try{await actor.updateEmbeddedDocuments("Item",updates,{bccResourceBinding:true});}catch(e){console.error("BCC | Resource binding",e);}},100));};
  for(const name of ["createItem","deleteItem","createActor","bcc.itemsMaterialized"])Hooks.on(name,schedule);
  Hooks.on("preCreateItem",(document,data,options)=>{
    const actor=document.parent??document.actor,context=transactionFor(actor);if(!context||!options.keepId||!document.updateSource||options.characterBuilderLevelUpRollback||options.characterBuilderRollback)return;
    const updates=resourceUpdates(options.characterBuilderLevelUpRollback||options.characterBuilderRollback?context.baseline:context.target),update=updates.find(u=>u._id===data._id);
    if(update){const {_id,...changes}=update;document.updateSource(changes);}
  });
  Hooks.on("dnd5e.preUseActivity",activity=>{
    const item=activity.item,actor=item?.actor;if(!actor)return;
    for(const binding of item.flags?.bcc?.resourceBindings??[])if(binding.activity===activity.id){
      const target=matchResource([...actor.items],binding.reference),selected=activity.consumption?.targets?.[binding.index]?.target;
      if(!target||selected!==target.id){ui.notifications.warn(`${item.name}: resource ${binding.reference.name??binding.reference.consumes?.name??"target"} is missing, ambiguous or not yet bound`);return false;}
    }
  });
}
