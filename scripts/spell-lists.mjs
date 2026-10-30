const ID = "book-compendium-converter";
export async function registerSpellLists(uuids = game.settings.get(ID,"spellLists") ?? []) {
  const registry = globalThis.dnd5e?.registry?.spellLists;
  if (!registry) return;
  for (const uuid of uuids) try {await registry.register(uuid);}
  catch (error) {console.warn(`BCC | Spell list registration failed: ${uuid}`,error);}
}
export async function saveSpellLists(entries) {
  const existing = game.settings.get(ID,"spellLists") ?? [];
  const uuids = entries.filter(e => e.kind === "spellList").map(e => `${e.uuid}.JournalEntryPage.bccSpellListPage`);
  const all = [...new Set([...existing,...uuids])];
  await game.settings.set(ID,"spellLists",all);await registerSpellLists(uuids);
}
