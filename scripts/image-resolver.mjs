import {ICON_ROWS} from "./icon-catalog.mjs";
export const imageName=value=>String(value??"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
export const referenceIcons=ICON_ROWS.map(([type,name,identifier,rules,book,requirements,img,priority])=>({type,name,img,priority,via:"mapping",system:{identifier,source:{rules,book},requirements}}));
export function imageIdentity(kind,r,doc){
  const parent=r._bccImageParent??r._bccVariantOf;
  const member=r._bccGroupItems?.length===1?r._bccGroupItems[0]:null;
  const names=new Set([r.name,parent?.name,r._baseName,typeof member==="string"?member.split("|")[0]:null,String(r.baseItem??r._bccBaseItem??"").split("|")[0]].filter(Boolean).map(imageName));
  return {type:doc.type??(kind==="monster"?"npc":"feat"),names,identifier:imageName(doc.system?.identifier),
    rules:r._bccRules??(r.edition==="one"?"2024":r.edition==="classic"?"2014":doc.system?.source?.rules),
    source:r.source,parents:[r.className,r.raceName,r._bccImageParent?.name].filter(Boolean).map(imageName)};
}
export function resolveIcon(catalog,kind,r,doc){
  const id=imageIdentity(kind,r,doc);
  const inventory=new Set(["weapon","equipment","loot","tool","container","consumable"]);
  const candidates=catalog.filter(e=>(e.type===id.type||kind==="item"&&inventory.has(e.type)&&inventory.has(id.type))&&(id.names.has(imageName(e.name))||id.identifier&&imageName(e.system?.identifier)===id.identifier));
  const rank=e=>(id.identifier&&imageName(e.system?.identifier)===id.identifier?4:0)
    +(id.rules&&e.system?.source?.rules===id.rules?8:0)
    +(id.source&&imageName(e.system?.source?.book)===imageName(id.source)?8:0)
    +(id.parents.some(p=>imageName(e.system?.requirements).includes(p))?4:0)
    +(kind==="monsterFeature"&&(/monsterfeatures/.test(e.pack??"")||e.system?.type?.value==="monster")?12:0)
    +(e.type===id.type?2:0)+(e.priority??(e.via==="mapping"?1:4));
  candidates.sort((a,b)=>rank(b)-rank(a));
  const top=candidates.filter(e=>rank(e)===rank(candidates[0]??{}));
  // For a single semantic owner (e.g. monster actions), equal-ranked native
  // artwork may vary by publication. A stable provider order avoids losing all
  // available icons while retaining the ambiguity in the report.
  const ambiguous=top.length>0&&new Set(top.map(e=>e.img)).size>1?top:[];
  const native=kind==="monsterFeature"?top.filter(e=>/monsterfeatures/.test(e.pack??"")||e.system?.type?.value==="monster").sort((a,b)=>(a.pack??a.img).localeCompare(b.pack??b.img)):[];
  return {match:!ambiguous.length?top[0]??null:native[0]??null,ambiguous};
}

/** Byte positions must not change when a binary header contains invalid UTF-8. */
export function validImageSignature(ext,bytes){
  const at=(offset,text)=>[...text].every((c,i)=>bytes[offset+i]===c.charCodeAt(0));
  if(ext==="webp")return bytes.length>=12&&at(0,"RIFF")&&at(8,"WEBP");
  if(ext==="png")return [137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n);
  if(["jpg","jpeg"].includes(ext))return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(ext==="gif")return at(0,"GIF87a")||at(0,"GIF89a");
  if(ext==="avif")return at(4,"ftyp")&&Array.from({length:Math.floor((bytes.length-8)/4)},(_,i)=>8+i*4).some(i=>at(i,"avif")||at(i,"avis"));
  if(ext==="svg")return /<svg[\s>]/i.test(new TextDecoder().decode(bytes));
  return false;
}
