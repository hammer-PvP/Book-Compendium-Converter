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
    if(r._copy){const parent=rows.find(e=>e.kind===kind&&canonical(e.record.name)===canonical(r._copy.name)&&canonical(e.record.source)===canonical(r._copy.source));if(parent)return images(kind,parent.record,seen);}
    return [];
  }
  for(const {kind,record} of rows){const list=images(kind,record);if(list.length)output.set(artworkKey(kind,record),list);}
  return output;
}
