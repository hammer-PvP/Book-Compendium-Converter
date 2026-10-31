import {readJson} from "./source.mjs";
import {canonical,clone} from "./data-model.mjs";
export const artworkKey=(kind,r)=>[kind,r.source,r.name,r.className??"",r.classSource??"",r.subclassShortName??r.shortName??"",r.raceName??""].map(canonical).join("|");
/** Read image metadata from the supplied local data, without importing extra entities. */
export async function loadArtwork(content){
  const files=new Set(["fluff-items.json","fluff-races.json","fluff-backgrounds.json","fluff-feats.json","fluff-optionalfeatures.json"]);
  for(const [folder,kinds] of [["class",["class","subclass"]],["spells",["spell"]],["bestiary",["monster"]]]){
    const index=await readJson(`${folder}/fluff-index.json`,{optional:true})??{};
    for(const kind of kinds)for(const r of content.records[kind]??[]){
      const keys=folder==="class"?[r.className??r.name]:[r.source];
      for(const key of keys){const filename=Object.entries(index).find(([k])=>canonical(k)===canonical(key))?.[1];if(filename)files.add(`${folder}/${filename}`);}
    }
  }
  const rows=[];
  for(const path of files){const data=await readJson(path,{optional:true});for(const [key,value] of Object.entries(data??{}))if(key.endsWith("Fluff")&&Array.isArray(value))for(const r of value)rows.push({kind:key.slice(0,-5),record:r});}
  const output=new Map();
  function images(kind,r,seen=new Set()){
    const key=artworkKey(kind,r);if(seen.has(key))return [];seen.add(key);
    if(r.images?.length)return clone(r.images);
    const ref=r._copy??r[`_${kind}Fluff`];
    if(ref){const parent=rows.find(e=>e.kind===kind&&canonical(e.record.name)===canonical(ref.name)&&canonical(e.record.source)===canonical(ref.source));if(parent)return images(kind,parent.record,seen);}
    return [];
  }
  for(const {kind,record} of rows){const list=images(kind,record);if(list.length)output.set(artworkKey(kind,record),list);}
  // Fluff records often omit class/race context present in the mechanical UID.
  // Only use the short identity when all matches agree on their artwork.
  const short=new Map();
  for(const {kind,record} of rows){const list=images(kind,record);if(!list.length)continue;const key=artworkKey(kind,{name:record.name,source:record.source});if(!short.has(key))short.set(key,new Map());short.get(key).set(JSON.stringify(list),list);}
  for(const [key,choices] of short)if(choices.size===1)output.set(key,[...choices.values()][0]);
  for(const [kind,records] of Object.entries(content.records))for(const r of records){
    const refs=[r,...[r._bccCopyOf,r._bccVariantOf,r.fluff?.[`_${kind}Fluff`]].filter(Boolean)];
    for(const ref of refs){const list=output.get(artworkKey(kind,ref))??output.get(artworkKey(kind,{name:ref.name,source:ref.source}));if(list?.length){output.set(artworkKey(kind,r),list);break;}}
  }
  return output;
}
