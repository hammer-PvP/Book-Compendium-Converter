/** Resource references cannot know future embedded Item IDs. This small,
 * original runtime is included in exported modules; it has no BCC dependency. */
const moduleId=/\/modules\/([^/]+)\//.exec(import.meta.url)?.[1];
const normalize=value=>String(value??"").trim().toLowerCase();
function raw(item){return item.toObject?item.toObject():item;}
export function bindExportedResources(items,owner=moduleId){
  const updates=[];
  for(const item of items){const data=raw(item),update={_id:item.id??data._id};let changed=false;
    for(const binding of data.flags?.bcc?.resourceBindings??[]){
      const ref=binding.reference??{};if(owner&&!String(ref.uuid??data._stats?.compendiumSource??"").startsWith(`Compendium.${owner}.`))continue;
      const exact=ref.uuid?items.filter(candidate=>{const r=raw(candidate);return r._stats?.compendiumSource===ref.uuid||r.flags?.core?.sourceId===ref.uuid;}):[];
      const matches=exact.length?exact:items.filter(candidate=>{const r=raw(candidate);return !!ref.name&&normalize(r.name)===normalize(ref.name)&&(!ref.source||normalize(r.system?.source?.book)===normalize(ref.source))&&(!ref.className||normalize(r.system?.requirements)===normalize(ref.className));});
      const target=data.system?.activities?.[binding.activity]?.consumption?.targets?.[binding.index];
      if(matches.length===1&&target){const id=matches[0].id??matches[0]._id;if(target.target!==id){update[`system.activities.${binding.activity}.consumption.targets.${binding.index}.target`]=id;changed=true;}}
    }
    if(changed)updates.push(update);
  }
  return updates;
}
if(globalThis.Hooks){
  const pending=new Map();
  const schedule=item=>{
    const actor=item.actor;if(!actor||actor.pack||!game.user.isGM||game.users?.activeGM?.id&&game.users.activeGM.id!==game.user.id)return;
    clearTimeout(pending.get(actor.uuid));pending.set(actor.uuid,setTimeout(async()=>{
      pending.delete(actor.uuid);const updates=bindExportedResources([...actor.items]);if(!updates.length)return;
      try{await actor.updateEmbeddedDocuments("Item",updates,{bccExportResourceBinding:true});}catch(error){console.error(`${moduleId} | Resource binding failed`,error);}
    },100));
  };
  Hooks.on("createItem",schedule);Hooks.on("deleteItem",schedule);
}
