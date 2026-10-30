import {canonical as lc} from "./data-model.mjs";
function match(items, ref) {
  const candidates = items.filter(item => {
    const data = item.toObject ? item.toObject() : item;
    if (ref.uuid && (data._stats?.compendiumSource === ref.uuid || data.flags?.core?.sourceId === ref.uuid)) return true;
    return lc(data.name) === lc(ref.name) && (!ref.source || lc(data.system?.source?.book) === lc(ref.source))
      && (!ref.className || lc(data.system?.requirements) === lc(ref.className));
  });
  return candidates.length === 1 ? candidates[0] : null;
}
export function bindEmbeddedResources(items) {
  for (const item of items) for (const binding of item.flags?.bcc?.resourceBindings ?? []) {
    const target = match(items,binding.reference);
    const activity = item.system?.activities?.[binding.activity];
    if (target && activity?.consumption?.targets?.[binding.index]) activity.consumption.targets[binding.index].target = target._id ?? target.id;
  }
}
/** Compendium items cannot know their future embedded IDs. Resolve only BCC-declared relationships after native grants. */
export function registerResourceBindings() {
  const pending = new Map();
  function schedule(item) {
    const actor = item.actor;
    if (!actor || actor.pack || !game.user.isGM || game.users?.activeGM?.id && game.users.activeGM.id !== game.user.id) return;
    clearTimeout(pending.get(actor.uuid));
    pending.set(actor.uuid,setTimeout(async () => {
      pending.delete(actor.uuid);const updates = [];
      for (const document of actor.items) {
        const update = {_id:document.id};let changed = false;
        for (const binding of document.flags?.bcc?.resourceBindings ?? []) {
          const target = match([...actor.items],binding.reference);
          const activity = document.system.activities.get(binding.activity);
          if (!target || !activity?.consumption?.targets?.[binding.index]) continue;
          if (activity.consumption.targets[binding.index].target === target.id) continue;
          update[`system.activities.${binding.activity}.consumption.targets.${binding.index}.target`] = target.id;changed = true;
        }
        if (changed) updates.push(update);
      }
      if (updates.length) try {await actor.updateEmbeddedDocuments("Item",updates,{bccResourceBinding:true});}
      catch (error) {console.error("BCC | Native resource binding failed",error);}
    },100));
  }
  Hooks.on("createItem",schedule);
  Hooks.on("deleteItem",schedule);
}
