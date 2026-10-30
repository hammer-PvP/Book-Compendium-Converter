/** Target-system enum names only. No document mechanics are copied from system compendiums. */
const normalize=value=>String(value??"").split("|")[0].toLowerCase().replace(/[^a-z0-9]/g,"");
const keys={tool:new Map(),weapon:new Map(),armor:new Map()};
let prepared;
export function nativeKey(kind,name){
  const found=keys[kind]?.get(normalize(name));if(found)return found;
  const config=globalThis.CONFIG?.DND5E??{};
  const entries=Object.keys(kind==="tool"?config.tools??{}:kind==="weapon"?config.weaponIds??{}:config.armorIds??{});
  const exact=entries.find(key=>normalize(key)===normalize(name));if(exact)return {key:exact};
  if(kind!=="tool")return null;
  const tokens=String(name).toLowerCase().replace(/['’]s\b/g,"").split(/\W+/).filter(t=>t.length>=4);
  const matches=entries.filter(key=>tokens.some(t=>key.startsWith(t)||t.startsWith(key)||key.length>=4&&t.startsWith(key.slice(0,4))));
  return matches.length===1?{key:matches[0]}:null;
}
export async function prepareNativeKeys(){
  if(prepared)return prepared;
  const config=globalThis.CONFIG?.DND5E;
  if(!config||!globalThis.game?.packs)return;
  prepared=(async()=>{
    const packs=new Map();
    for(const [kind,values] of [["tool",config.tools],["weapon",config.weaponIds],["armor",config.armorIds]])for(const [key,entry] of Object.entries(values??{})){
      const uuid=typeof entry==="string"?entry:entry.id;
      const parsed=/^Compendium\.([^.]+\.[^.]+)\.Item\.([A-Za-z0-9]{16})$/.exec(uuid??"");
      if(!parsed)continue;if(!packs.has(parsed[1]))packs.set(parsed[1],[]);packs.get(parsed[1]).push({kind,key,id:parsed[2]});
    }
    for(const [collection,entries] of packs){
      const pack=game.packs.get(collection);if(!pack)continue;
      try{
        const index=await pack.getIndex({fields:["name","system.type.value"]});
        for(const entry of entries){const row=index.get?.(entry.id)??[...index].find(r=>r._id===entry.id);if(row)keys[entry.kind].set(normalize(row.name),{key:entry.key,category:row.system?.type?.value});}
      }catch(error){console.warn(`BCC | Native enum labels unavailable for ${collection}`,error);}
    }
  })();
  return prepared;
}
