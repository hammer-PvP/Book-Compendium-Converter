import {forgetPackSpellLists,forgetDocumentSpellLists} from "./spell-lists.mjs";
const escapeHtml=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
export function canDeleteWorldPack(pack){
  return !!game.user?.isGM&&!!pack&&pack.collection?.startsWith("world.")&&
    (!pack.metadata?.packageType||pack.metadata.packageType==="world")&&typeof pack.deleteCompendium==="function";
}
function assertWorldPack(pack){
  if(!canDeleteWorldPack(pack)||game.packs.get(pack.collection)!==pack)throw Error("BCC | Apenas GM pode excluir um compêndio pertencente ao World.");
}
export async function deleteWorldPack(pack){
  assertWorldPack(pack);
  const index=await pack.getIndex(),count=index.size??index.length;
  const approved=await foundry.applications.api.DialogV2.wait({window:{title:"Excluir tudo — compêndio do World"},
    content:`<p>Excluir permanentemente <strong>${escapeHtml(pack.title??pack.metadata?.label??pack.collection)}</strong> (<code>${escapeHtml(pack.collection)}</code>) e seus <strong>${count}</strong> documentos?</p><p>Documentos já copiados para o mundo ou para personagens permanecem.</p><label><input type="checkbox" name="bcc-delete-content" aria-required="true"> Excluir todo o conteúdo do compendium</label>`,
    buttons:[{action:"cancel",label:"Cancelar",default:true,callback:()=>false},{action:"delete",label:"Excluir tudo",icon:"fa-solid fa-trash",disabled:true,callback:(_event,_button,dialog)=>dialog.element.querySelector('[name="bcc-delete-content"]')?.checked===true}],
    render:(_event,dialog)=>{const checkbox=dialog.element.querySelector('[name="bcc-delete-content"]'),button=dialog.element.querySelector('[data-action="delete"]');checkbox?.addEventListener("change",()=>{if(button)button.disabled=!checkbox.checked;});},rejectClose:false});
  if(approved!==true)return false;
  assertWorldPack(pack);
  await pack.deleteCompendium();
  await forgetPackSpellLists(pack);
  ui.notifications.info("BCC | Compêndio e conteúdo excluídos. Recarregue o Foundry para atualizar listas de magias em uso.");
  return true;
}
const packFor=target=>game.packs.get(target?.dataset?.pack??target?.dataset?.entryId??target?.closest?.("[data-pack]")?.dataset.pack);
const values=collection=>collection?.contents??[...(collection?.values?.()??collection??[])];
const folderRef=value=>typeof value==="string"?value:value?.id??value?._id??null;
function descendants(folders,id){
  const ids=new Set([id]);let prior;
  do{prior=ids.size;for(const f of folders)if(ids.has(folderRef(f.folder)))ids.add(f.id??f._id);}while(ids.size!==prior);
  return ids;
}
async function confirmRemoval(title,content){
  return await foundry.applications.api.DialogV2.wait({window:{title},content:`${content}<label><input type="checkbox" name="bcc-delete-content"> Confirmo a exclusão permanente de todo o conteúdo indicado.</label>`,
    buttons:[{action:"cancel",label:"Cancelar",default:true,callback:()=>false},{action:"delete",label:"Excluir tudo",disabled:true,callback:(_e,_b,d)=>d.element.querySelector('[name="bcc-delete-content"]')?.checked===true}],
    render:(_e,d)=>{const checkbox=d.element.querySelector('[name="bcc-delete-content"]'),button=d.element.querySelector('[data-action="delete"]');checkbox?.addEventListener("change",()=>{if(button)button.disabled=!checkbox.checked;});},rejectClose:false})===true;
}
function assertFolder(pack,folder){
  assertWorldPack(pack);
  if(!folder||pack.folders?.get?.(folder.id??folder._id)!==folder||folder.pack!==pack.collection)throw Error("BCC | A pasta não pertence ao compêndio selecionado.");
}
export async function deletePackFolder(pack,folder){
  assertFolder(pack,folder);
  const ids=descendants(values(pack.folders),folder.id??folder._id),rows=values(await pack.getIndex({fields:["folder"]}));
  const documents=rows.filter(r=>ids.has(folderRef(r.folder)));
  if(!await confirmRemoval("Excluir pasta e conteúdo",`<p>Excluir <strong>${escapeHtml(folder.name)}</strong> de <strong>${escapeHtml(pack.title??pack.collection)}</strong>, com <strong>${documents.length}</strong> documentos e <strong>${ids.size-1}</strong> subpastas?</p>`))return false;
  assertFolder(pack,folder);
  const current=descendants(values(pack.folders),folder.id??folder._id);
  if(current.size!==ids.size||[...current].some(id=>!ids.has(id)))throw Error("BCC | As subpastas mudaram. Revise a exclusão novamente.");
  const latest=values(await pack.getIndex({fields:["folder"]})).filter(r=>current.has(folderRef(r.folder)));
  if(latest.length!==documents.length||latest.some(r=>!documents.some(d=>(d._id??d.id)===(r._id??r.id))))throw Error("BCC | O conteúdo mudou. Revise a exclusão novamente.");
  const locked=pack.locked;
  try{if(locked)await pack.configure({locked:false});await folder.delete({deleteSubfolders:true,deleteContents:true});}
  finally{if(locked&&game.packs.get(pack.collection)===pack)await pack.configure({locked:true});}
  const retained=values(await pack.getIndex());
  if(documents.some(d=>retained.some(r=>(r._id??r.id)===(d._id??d.id))))throw Error("BCC | Alguns documentos não foram excluídos; confira o compêndio.");
  const listsChanged=await forgetDocumentSpellLists(pack,documents.map(d=>d._id??d.id));
  ui.notifications.info(`BCC | Pasta e conteúdo excluídos.${listsChanged?" Recarregue para atualizar listas de magias em uso.":""}`);return true;
}
function bookFolderPlan(folder){
  if(!game.user?.isGM||!folder||folder.type!=="Compendium"||game.folders?.get(folder.id)!==folder)throw Error("BCC | Selecione uma pasta de compêndios do World.");
  const ids=descendants(values(game.folders).filter(f=>f.type==="Compendium"),folder.id);
  const packs=values(game.packs).filter(p=>ids.has(folderRef(p.folder??p.metadata?.folder)));
  if(packs.some(p=>!canDeleteWorldPack(p)))throw Error("BCC | A pasta contém compêndios de sistema ou módulo. Nenhum conteúdo foi excluído.");
  return {ids,packs};
}
export async function deleteCompendiumFolder(folder){
  const plan=bookFolderPlan(folder);let count=0;
  for(const pack of plan.packs){const rows=await pack.getIndex();count+=rows.size??rows.length;}
  if(!await confirmRemoval("Excluir pasta e compêndios",`<p>Excluir <strong>${escapeHtml(folder.name)}</strong>, suas subpastas e <strong>${plan.packs.length}</strong> compêndios do World, contendo <strong>${count}</strong> documentos?</p>`))return false;
  const current=bookFolderPlan(folder);
  if(current.ids.size!==plan.ids.size||[...current.ids].some(id=>!plan.ids.has(id))||current.packs.length!==plan.packs.length||current.packs.some(p=>!plan.packs.includes(p)))throw Error("BCC | A pasta mudou. Revise a exclusão novamente.");
  for(const pack of current.packs){assertWorldPack(pack);await pack.deleteCompendium();await forgetPackSpellLists(pack);}
  await folder.delete({deleteSubfolders:true,deleteContents:false});
  ui.notifications.info("BCC | Pasta e compêndios excluídos. Recarregue para atualizar listas de magias em uso.");return true;
}
const folderIdFor=target=>target?.dataset?.folderId??target?.closest?.("[data-folder-id]")?.dataset.folderId;
function deletionError(error){console.error("BCC | Delete folder",error);ui.notifications.error(error.message);}
export function addDeleteFolderOption(options,application,bookFolders=false){
  const folderFor=target=>bookFolders?game.folders?.get(folderIdFor(target)):application.collection?.folders?.get(folderIdFor(target));
  options.push({label:"Excluir pasta e todo o conteúdo",icon:"fa-solid fa-trash",group:"bcc",visible:target=>{
    try{const folder=folderFor(target);if(bookFolders)bookFolderPlan(folder);else assertFolder(application.collection,folder);return true;}catch{return false;}
  },onClick:(_event,target)=>{const folder=folderFor(target??_event);return (bookFolders?deleteCompendiumFolder(folder):deletePackFolder(application.collection,folder)).catch(deletionError);}});
  return options;
}
export function addDeletePackOption(options){
  options.push({label:"Excluir tudo",icon:"fa-solid fa-trash",group:"bcc",visible:target=>canDeleteWorldPack(packFor(target)),onClick:(_event,target)=>deleteWorldPack(packFor(target)).catch(error=>{console.error("BCC | Delete compendium",error);ui.notifications.error(error.message);})});
  return options;
}
let registered=false;
export function registerCompendiumDeletion(){
  if(registered)return;
  const target="foundry.applications.sidebar.tabs.CompendiumDirectory.prototype._getEntryContextOptions";
  if(globalThis.libWrapper?.register){libWrapper.register("book-compendium-converter",target,function(wrapped,...args){return addDeletePackOption(wrapped(...args));},"WRAPPER");}
  else{
    const proto=foundry.applications.sidebar.tabs.CompendiumDirectory.prototype,original=proto._getEntryContextOptions;
    proto._getEntryContextOptions=function(...args){return addDeletePackOption(original.apply(this,args));};
  }
  registered=true;
  function wrap(proto,path,bookFolders){
    if(!proto||typeof proto._getFolderContextOptions!=="function")return;
    if(globalThis.libWrapper?.register)libWrapper.register("book-compendium-converter",path,function(wrapped,...args){return addDeleteFolderOption(wrapped(...args),this,bookFolders);},"WRAPPER");
    else {const original=proto._getFolderContextOptions;proto._getFolderContextOptions=function(...args){return addDeleteFolderOption(original.apply(this,args),this,bookFolders);};}
  }
  wrap(foundry.applications.sidebar.tabs.CompendiumDirectory.prototype,"foundry.applications.sidebar.tabs.CompendiumDirectory.prototype._getFolderContextOptions",true);
  wrap(foundry.applications.sidebar.apps?.Compendium?.prototype,"foundry.applications.sidebar.apps.Compendium.prototype._getFolderContextOptions",false);
}
