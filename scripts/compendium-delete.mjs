import {forgetPackSpellLists} from "./spell-lists.mjs";
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
}
