const ID = "book-compendium-converter";
export async function registerSpellLists(uuids = game.settings.get(ID,"spellLists") ?? []) {
  const registry = globalThis.dnd5e?.registry?.spellLists;
  if (!registry) return [];
  const failures=[];
  for (const uuid of uuids) try {await registry.register(uuid);}
  catch (error) {failures.push({uuid,message:String(error.message??error)});console.warn(`BCC | Spell list registration failed: ${uuid}`,error);}
  return failures;
}
export async function saveSpellLists(entries) {
  const existing = game.settings.get(ID,"spellLists") ?? [];
  const lists=entries.filter(e=>e.kind==="spellList"),uuids=lists.flatMap(e=>e.record.lists.map(p=>`${e.uuid}.JournalEntryPage.${p.pageId}`));
  const books=new Set(lists.map(e=>e.record.source.toLowerCase().replace(/[^a-z0-9]+/g,"-")));
  // Superseded registrations are removed; old user-owned packs are never silently deleted.
  const retained=existing.filter(uuid=>![...books].some(book=>uuid.startsWith(`Compendium.world.bcc-${book}-spell-lists.`)||lists.some(e=>uuid.startsWith(`${e.uuid}.JournalEntryPage.`))));
  await game.settings.set(ID,"spellLists",[...new Set([...retained,...uuids])]);return registerSpellLists(uuids);
}
export async function forgetPackSpellLists(pack){
  const existing=game.settings.get(ID,"spellLists")??[];
  const retained=existing.filter(uuid=>!uuid.startsWith(`Compendium.${pack.collection}.`));
  if(retained.length!==existing.length)await game.settings.set(ID,"spellLists",retained);
}
