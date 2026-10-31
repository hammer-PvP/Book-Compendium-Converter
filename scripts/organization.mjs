import {itemType} from "./equipment.mjs";
import {sourceColor} from "./source-colors.mjs";
const LEVEL = n => Number(n) ? `Level ${Number(n)}` : "Cantrips";
export function documentPath(entry,index) {
  const {kind,record:r} = entry, prefix = r._bccDependency ? [`Dependencies · ${r.source}`] : [];
  if (kind === "chapter") return ["Chapters"];
  if (kind === "spell") return [...prefix,LEVEL(r.level)];
  if (kind === "item") {
    const type = itemType(r), group = ({weapon:"Weapons",equipment:"Armor & Equipment",tool:"Tools",consumable:"Consumables",container:"Containers",loot:"Adventuring Gear"})[type];
    const subtype = type === "weapon" ? `${r.weaponCategory === "martial" ? "Martial" : "Simple"} ${String(r.type).split("|")[0] === "R" ? "Ranged" : "Melee"}` : null;
    return [...prefix,group,...subtype ? [subtype] : []];
  }
  if (["classFeature","subclassFeature"].includes(kind)) return [...prefix,r.className ?? "Features",`Level ${kind==="subclassFeature"&&r._bccTargetRules==="2024"?Math.max(3,Number(r.level??0)):Number(r.level??0)}`];
  if (kind === "raceFeature") return [...prefix,r.raceName ?? "Species Features"];
  if (kind === "subclass") return [...prefix,r.className ?? "Subclasses"];
  if (kind === "feat") return [...prefix,({O:"Origin Feats",G:"General Feats",EB:"Epic Boons"})[r.category] ?? "Feats"];
  if (kind === "optionalfeature") {
    if (r._bccAuxiliary) return [...prefix,"Spellcasting Options"];
    const step = index.records.class.flatMap(c => c.optionalfeatureProgression ?? []).find(s => s.featureType?.some(t => r.featureType?.includes(t)));
    return [...prefix,step?.name ?? "Optional Features"];
  }
  return prefix;
}
async function folderId(key) {const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(key)));return [...bytes.slice(0,8)].map(n => n.toString(16).padStart(2,"0")).join("");}
export async function organizeDocuments(pack,documents,entries,index) {
  const folders = new Map((pack.folders?.contents ?? [...(pack.folders ?? [])]).map(f => [f.id ?? f._id,f]));
  const needed = new Map(), entryById = new Map(entries.map(e => [e._id,e]));
  for (const [i,doc] of documents.entries()) {
    const entry = entryById.get(doc._id); if (!entry) continue;
    let parent = null, path = "";
    for (const [depth,name] of documentPath(entry,index).entries()) {
      path += `/${name}`;const _id = await folderId(`${pack.collection}:${path}`);
      const level=/^Level (\d+)$/.exec(name),sort=level?Number(level[1])*10000:needed.size*10000;
      if (!folders.has(_id) && !needed.has(_id)) needed.set(_id,{_id,name,type:pack.documentName,folder:parent,sorting:entry.kind === "chapter" ? "m" : "a",sort,color:sourceColor(entry.record.source),flags:{bcc:{managed:true,depth}}});
      parent = _id;
    }
    doc.folder = parent;doc.sort = entry.kind === "chapter" ? Number(entry.record.sequence)*10000 : i*10000;
  }
  // Parents precede children in insertion order. Existing folders are never deleted or renamed.
  for (const folder of needed.values()) await Folder.create(folder,{pack:pack.collection,keepId:true});
  // Manual sorting belongs to the parent directory; repair existing BCC level
  // folders as well so reimporting fixes the previous 15,3,5,9 order.
  const all=[...folders.values(),...needed.values()],parents=new Set(all.filter(f=>/^Level \d+$/.test(f.name)&&f.flags?.bcc?.managed).map(f=>f.folder?.id??f.folder??null));
  const updates=[];
  if(parents.has(null)&&globalThis.game?.settings){
    const current=game.settings.get("core","collectionSortingModes");
    const modes=current&&typeof current==="object"?{...current}:{};
    if(modes[pack.collection]!=="m"){modes[pack.collection]="m";await game.settings.set("core","collectionSortingModes",modes);}
  }
  for(const f of all){if(!f.flags?.bcc?.managed)continue;const id=f.id??f._id,row={_id:id};
    if(parents.has(id)&&f.sorting!=="m")row.sorting="m";
    const level=/^Level (\d+)$/.exec(f.name);if(level&&f.sort!==Number(level[1])*10000)row.sort=Number(level[1])*10000;
    if(Object.keys(row).length>1)updates.push(row);
  }
  if(updates.length)await Folder.updateDocuments(updates,{pack:pack.collection});
}
