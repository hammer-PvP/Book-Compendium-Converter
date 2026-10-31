import {canonical} from "./data-model.mjs";
import {loadArtwork,artworkKey} from "./artwork-source.mjs";
import {findSupplement} from "./library-source.mjs";
export const ASSET_ROOT="assets/srd5e";
const ID="book-compendium-converter";
const norm=value=>String(value??"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
const extension=value=>/\.([a-z0-9]+)(?:[?#]|$)/i.exec(value)?.[1]?.toLowerCase();
const TYPES={webp:"image/webp",png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",svg:"image/svg+xml",gif:"image/gif",avif:"image/avif"};
const FALLBACK={spell:"icons/svg/book.svg",class:"icons/svg/book.svg",subclass:"icons/svg/book.svg",race:"icons/svg/mystery-man.svg",background:"icons/svg/door-exit.svg",feat:"icons/svg/upgrade.svg",optionalfeature:"icons/svg/upgrade.svg",raceFeature:"icons/svg/upgrade.svg",classFeature:"icons/svg/upgrade.svg",subclassFeature:"icons/svg/upgrade.svg",monster:"icons/svg/mystery-man.svg",object:"icons/svg/item-bag.svg",vehicle:"icons/svg/wing.svg",weapon:"icons/svg/sword.svg",equipment:"icons/svg/shield.svg",tool:"icons/svg/hammer.svg",loot:"icons/svg/item-bag.svg",container:"icons/svg/chest.svg",consumable:"icons/svg/potion.svg"};
export function imageSource(value){
  if(typeof value!=="string"||!value.trim())return null;
  let path=value.trim().replaceAll("\\","/").replace(/^Data\//i,"");
  if(/^(?:https?):\/\//i.test(path)){try{const u=new URL(path);if(u.username||u.password)return null;u.hash="";return u.href;}catch{return null;}}
  if(/^[a-z][a-z\d+.-]*:/i.test(path)||path.startsWith("//"))return null;
  path=path.replace(/^\//,"");
  let decoded;try{decoded=decodeURIComponent(path);}catch{return null;}
  return decoded.split("/").some(p=>p==="..")||/[\x00-\x1f]/.test(path)?null:path;
}
async function hash(value){return [...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,"0")).join("");}
function href(image,root){
  const value=image?.href??image;
  if(typeof value==="string")return imageSource(value);
  if(value?.url)return imageSource(value.url);
  if(value?.path)return imageSource(`${root.replace(/\/$/,"")}/${value.path.replace(/^img\//,"")}`);
  return null;
}
function rules(r){return r._bccRules??(r.edition==="one"?"2024":r.edition==="classic"?"2014":r.system?.source?.rules);}
function nativeType(kind,doc){return doc?.type??({race:"race",background:"background",class:"class",subclass:"subclass",spell:"spell",monster:"npc",object:"vehicle",vehicle:"vehicle",item:"loot"}[kind]??"feat");}
/** Copies image bytes through Foundry's native file API. No artwork ships with BCC. */
export class AssetImporter{
  constructor(content,index,report,onProgress=()=>{}){
    this.content=content;this.index=index;this.report=report;this.onProgress=onProgress;this.files=new Set();this.pending=new Map();this.used=new Set();this.initialFiles=new Set();this.reusedFiles=new Set();this.transportFailures=new Map();this.catalog=[];this.matches=new Map();this.artwork=new Map();this.refs=new Map(index.all.map(e=>[e.uuid,e]));
    this.root=game.settings.get(ID,"artworkSource")||"bcc/5etools/img";
    report.assets={root:ASSET_ROOT,copied:0,reused:0,fields:0,fallbacks:0,failures:[],matches:0,ambiguous:[],unresolved:[]};
    this.stats=report.assets;
  }
  async prepare(){
    this.picker=globalThis.foundry?.applications?.apps?.FilePicker?.implementation??globalThis.foundry?.applications?.apps?.FilePicker;
    if(!this.picker?.upload||!this.picker?.browse)throw Error("BCC | FilePicker do Foundry indisponível para importar ícones.");
    let parent="";
    for(const segment of ASSET_ROOT.split("/")){
      const directory=await this.picker.browse("data",parent),target=parent?`${parent}/${segment}`:segment;
      if(!(directory.dirs??[]).some(d=>imageSource(d)?.replace(/\/$/,"")===target)){
        try{await this.picker.createDirectory("data",target);}catch(error){const check=await this.picker.browse("data",parent);if(!(check.dirs??[]).some(d=>imageSource(d)?.replace(/\/$/,"")===target))throw error;}
      }
      parent=target;
    }
    for(const path of (await this.picker.browse("data",ASSET_ROOT)).files??[])this.files.add(imageSource(path));
    this.initialFiles=new Set(this.files);this.artworkAvailable=true;
    if(!/^https?:\/\//i.test(this.root)){
      const root=imageSource(this.root)?.replace(/\/$/,"");
      try{const parent=root?.split("/").slice(0,-1).join("/")??"",listing=await this.picker.browse("data",parent);this.artworkAvailable=(listing.dirs??[]).some(d=>imageSource(d)?.replace(/\/$/,"")===root);}
      catch{this.artworkAvailable=false;}
      if(!this.artworkAvailable)this.report.information?.add(`Artwork directory ${this.root} unavailable; using installed images and native category icons`);
    }
    this.artwork=await loadArtwork(this.content);
    const packs=[...(game.packs?.values?.()??[])].filter(p=>["Item","Actor"].includes(p.documentName)&&!p.collection.startsWith("world.bcc-"));
    for(const [i,pack] of packs.entries()){
      this.onProgress(`Ícones: indexando fontes disponíveis (${i+1}/${packs.length})...`);
      try{
        const entries=await pack.getIndex({fields:["name","type","img","system.identifier","system.source.book","system.source.rules","system.requirements"]});
        for(const row of entries)if(row.img)this.catalog.push({name:row.name,type:row.type,img:row.img,system:row.system??{},pack:pack.collection});
      }catch(error){this.stats.failures.push({phase:"index",source:pack.collection,message:String(error.message??error)});}
    }
  }
  lookup(kind,r,doc){
    const type=nativeType(kind,doc),names=new Set([r.name,r._bccImageParent?.name,r._bccVariantOf?.name,r._baseName,String(r.baseItem??r._bccBaseItem??"").split("|")[0]].filter(Boolean).map(norm)),identifier=norm(doc.system?.identifier),key=[type,identifier,r.source,rules(r),r.className,...names].join("|");
    if(this.matches.has(key))return this.matches.get(key);
    const candidates=this.catalog.filter(e=>e.type===type&&(names.has(norm(e.name))||identifier&&norm(e.system.identifier)===identifier));
    const rank=e=>(canonical(e.system.source?.book)===canonical(r.source)?8:0)+(rules(r)&&rules(r)===rules(e)?4:0)+(r.className&&norm(e.system.requirements).includes(norm(r.className))?2:0);
    candidates.sort((a,b)=>rank(b)-rank(a)||a.pack.localeCompare(b.pack));
    const top=candidates.filter(e=>rank(e)===rank(candidates[0]??{}));
    const out=new Set(top.map(e=>e.img)).size===1?top[0]:null;
    if(!out&&top.length)this.stats.ambiguous.push({name:r.name,source:r.source,type,candidates:top.map(e=>({name:e.name,pack:e.pack}))});
    this.matches.set(key,out);return out;
  }
  candidates(kind,r,doc){
    const overlay=findSupplement(kind,r,this.content.foundry??{}),out=[];
    for(const path of [r.foundryImg,overlay?.img,doc.img,r.img])if(path)out.push({source:path,via:"explicit"});
    const found=this.lookup(kind,r,doc);if(found)out.push({source:found.img,via:"compendium",pack:found.pack});
    let images=[...(r.fluff?.images??[]),...(r.images??[]),...(this.artwork.get(artworkKey(kind,r))??[])];
    if(!images.length){const parent=r._bccImageParent??(r.raceName?{kind:"race",name:r.raceName,source:r.source}:r.className?{kind:"class",name:r.className,source:r.classSource??r.source}:r._bccVariantOf?{kind,...r._bccVariantOf}:null);if(parent)images=this.artwork.get(artworkKey(parent.kind,parent))??[];}
    for(const image of images){const source=href(image,this.root);if(source&&(this.artworkAvailable||/^https?:\/\//i.test(source)))out.push({source,via:"artwork"});}
    const native=globalThis.CONFIG?.DND5E?.defaultArtwork?.[doc.type==="npc"||doc.type==="vehicle"?"Actor":"Item"]?.[doc.type];
    const school=doc.type==="spell"?globalThis.CONFIG?.DND5E?.spellSchools?.[doc.system?.school]?.icon:null;
    for(const source of [school,native])if(source&&TYPES[extension(source)])out.push({source,via:"category"});
    const fallback=FALLBACK[kind==="item"?doc.type:kind]??FALLBACK[doc.type]??"icons/svg/item-bag.svg";
    out.push({source:fallback,via:"category"},{source:"icons/svg/item-bag.svg",via:"category"});
    return [...new Map(out.map(e=>[imageSource(e.source),{...e,source:imageSource(e.source)}])).values()].filter(e=>e.source);
  }
  async copy(raw){
    const source=imageSource(raw);if(!source)throw Error("Invalid image path");
    if(this.pending.has(source))return this.pending.get(source);
    const task=this._copy(source);this.pending.set(source,task);return task;
  }
  reuse(path){if(this.initialFiles.has(path))this.reusedFiles.add(path);this.stats.reused=this.reusedFiles.size;}
  async _copy(source){
    if(source.startsWith(`${ASSET_ROOT}/`)&&this.files.has(source)){this.reuse(source);return {path:source,source,reused:true};}
    const key=await hash(source),prefix=`${ASSET_ROOT}/${key}.`,known=[...this.files].find(p=>p.startsWith(prefix));
    if(known){this.reuse(known);return {path:known,source,reused:true};}
    const url=/^https?:\/\//i.test(source)?source:(foundry.utils.getRoute?.(source)??source);
    const remote=/^https?:\/\//i.test(source),origin=remote?new URL(source).origin:null;
    if(remote&&(this.transportFailures.get(origin)??0)>=3)throw Error("Remote image provider unavailable after three transport failures");
    let response;
    try{response=await fetch(url,{signal:AbortSignal.timeout(12000),credentials:remote?"omit":"same-origin"});}
    catch(error){if(remote)this.transportFailures.set(origin,(this.transportFailures.get(origin)??0)+1);throw error;}
    if(!response.ok)throw Error(`HTTP ${response.status}`);
    const blob=await response.blob(),mime=blob.type.split(";")[0].toLowerCase();
    const ext=Object.keys(TYPES).find(k=>TYPES[k]===mime)??extension(source);
    if(!blob.size||blob.size>20*1024*1024||!TYPES[ext]||(mime&&!mime.startsWith("image/")&&mime!=="application/octet-stream"))throw Error("Response is not a supported image (maximum 20 MiB)");
    const header=new Uint8Array(await blob.slice(0,1024).arrayBuffer()),ascii=new TextDecoder().decode(header);
    const valid=ext==="svg"?/<svg[\s>]/i.test(ascii):ext==="png"?[137,80,78,71,13,10,26,10].every((n,i)=>header[i]===n):["jpg","jpeg"].includes(ext)?header[0]===255&&header[1]===216&&header[2]===255:ext==="webp"?ascii.startsWith("RIFF")&&ascii.slice(8,12)==="WEBP":ext==="gif"?/^GIF8[79]a/.test(ascii):ext==="avif"?ascii.includes("ftyp")&&ascii.includes("avif"):false;
    if(!valid)throw Error("Invalid image signature");
    const file=new File([blob],`${key}.${ext}`,{type:TYPES[ext]}),expected=`${ASSET_ROOT}/${file.name}`;
    const result=await this.picker.upload("data",ASSET_ROOT,file,{}, {notify:false});
    if(result?.error||result?.status==="error")throw Error(result.error??"Upload failed");
    const path=imageSource(result?.path);
    if(path&&path!==expected)throw Error("Upload returned an unexpected path");
    if(!path){const check=await this.picker.browse("data",ASSET_ROOT);if(!(check.files??[]).some(p=>imageSource(p)===expected))throw Error("Upload was not confirmed by the server");}
    this.files.add(expected);this.stats.copied++;return {path:expected,source,reused:false};
  }
  async field(owner,field,candidates,files){
    for(const candidate of candidates){
      try{const asset=await this.copy(candidate.source);this.used.add(asset.path);files.push({field,...asset,via:candidate.via,...candidate.pack?{pack:candidate.pack}:{}});this.stats.fields++;if(candidate.via==="category")this.stats.fallbacks++;return asset.path;}
      catch(error){const issue={source:candidate.source,message:String(error.message??error)};if(!this.stats.failures.some(e=>e.source===issue.source))this.stats.failures.push(issue);}
    }
    this.stats.unresolved.push(`${owner.name}: ${field}`);return null;
  }
  async apply(doc,entry){
    const r=entry?.record??{name:doc.name,source:doc.system?.source?.book},kind=entry?.kind??(doc.type==="spell"?"spell":doc.type==="feat"?"optionalfeature":"item"),files=[];
    if(doc.system){const path=await this.field(doc,"img",this.candidates(kind,r,doc),files);if(path)doc.img=path;}
    for(const [id,a] of Object.entries(doc.system?.activities??{})){
      const source=a.img??globalThis.CONFIG?.DND5E?.activityTypes?.[a.type]?.documentClass?.metadata?.img;
      const candidates=[...source?[{source,via:"activity"}]:[],...doc.img?[{source:doc.img,via:"owner"}]:[]];
      if(candidates.length){const path=await this.field(doc,`system.activities.${id}.img`,candidates,files);if(path)a.img=path;}
    }
    for(const [i,e] of (doc.effects??[]).entries()){const path=await this.field(doc,`effects.${e._id??i}.img`,[{source:e.img??"icons/svg/aura.svg",via:"effect"}],files);if(path)e.img=path;}
    if(doc.prototypeToken){const media=kind==="object"?"objects":kind==="vehicle"?"vehicles":"bestiary";
      const token=r.token?.name&&r.token?.source?`${this.root.replace(/\/$/,"")}/${media}/tokens/${r.token.source}/${r.token.name}.webp`:typeof r.token==="string"?r.token:null;
      const source=r.tokenUrl??href(r.tokenHref,this.root)??token??doc.prototypeToken.texture?.src;const candidates=source?[{source,via:"token"},...doc.img?[{source:doc.img,via:"portrait"}]:[]]:doc.img?[{source:doc.img,via:"portrait"}]:[];if(candidates.length){const path=await this.field(doc,"prototypeToken.texture.src",candidates,files);if(path){doc.prototypeToken.texture??={};doc.prototypeToken.texture.src=path;}}}
    if(files.length){doc.flags??={};doc.flags.bcc??={};doc.flags.bcc.assets={version:1,root:ASSET_ROOT,files};}
    for(const item of doc.items??[]){const ref=this.refs.get(item._stats?.compendiumSource??item.flags?.bcc?.actorOrigin);await this.apply(item,ref);}
    return doc;
  }
  async verify(){
    const actual=new Set(((await this.picker.browse("data",ASSET_ROOT)).files??[]).map(imageSource));
    for(const path of this.used)if(!actual.has(path))throw Error(`BCC | Arquivo de imagem ausente após gravação: ${path}`);
    this.stats.matches=this.catalog.length;return this.stats;
  }
}

/** Input for a future exporter: unique local files, independent of their original provider. */
export function collectAssetFiles(document){
  const files=new Map();
  function visit(doc){for(const file of doc.flags?.bcc?.assets?.files??[])if(file.path?.startsWith(`${ASSET_ROOT}/`))files.set(file.path,{path:file.path,moduleRelative:`assets/${file.path.split("/").at(-1)}`});for(const item of doc.items??[])visit(item);}
  visit(document.toObject?document.toObject():document);return [...files.values()];
}
