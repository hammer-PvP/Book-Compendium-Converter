import {databaseEntries,levelDatabase} from "./export-database.mjs";
import {ExportZip} from "./export-zip.mjs";
import {imageSource} from "./assets.mjs";
import {validImageSignature} from "./image-resolver.mjs";
import {sourceColor} from "./source-colors.mjs";

const SUPPORTED=new Set(["Item","Actor","JournalEntry"]),MEDIA=/\.(?:webp|png|jpe?g|svg|gif|avif|ogg|mp3|wav|flac|mp4|webm)(?:[?#]|$)/i;
const UUID=/Compendium\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z][A-Za-z0-9]*)\.([A-Za-z0-9]{16})(?:\.[A-Za-z][A-Za-z0-9]*\.[A-Za-z0-9]{16})*/g;
const pause=()=>new Promise(r=>setTimeout(r,0));
const plain=doc=>doc.toObject?doc.toObject(true):structuredClone(doc);
const values=collection=>collection?.contents??[...(collection?.values?.()??collection??[])];
export function exportBooks(){
  const groups=new Map();
  for(const pack of game.packs.values()){
    if(!pack.collection.startsWith("world.bcc-")||!SUPPORTED.has(pack.documentName))continue;
    const folder=pack.folder?.name?pack.folder:game.folders?.get?.(pack.folder);
    const source=pack.metadata?.flags?.bcc?.sourceId??folder?.flags?.bcc?.sourceId;
    if(!source)continue;
    if(!groups.has(source))groups.set(source,{source,name:folder?.name??source,color:sourceColor(source),packs:[]});
    groups.get(source).packs.push(pack);
  }
  return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
export function exportIdentity({id,title,version}){
  id=String(id??"").trim();title=String(title??"").trim();version=String(version??"").trim();
  if(!/^[a-z][a-z0-9-]{2,63}$/.test(id)||["world","dnd5e","book-compendium-converter"].includes(id))throw Error("Use um identificador de 3–64 caracteres: letras minúsculas, números e hífens.");
  if(!title||title.length>150)throw Error("Informe o nome do módulo (até 150 caracteres).");
  if(!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version))throw Error("Use uma versão como 1.0.0.");
  return {id,title,version};
}
function strings(value,fn,path=[]){
  if(typeof value==="string")fn(value,path);
  else if(Array.isArray(value))value.forEach((v,i)=>strings(v,fn,[...path,i]));
  else if(value&&typeof value==="object")for(const [k,v] of Object.entries(value))strings(v,fn,[...path,k]);
}
function transform(value,fn){
  if(typeof value==="string")return fn(value);
  if(Array.isArray(value))return value.map(v=>transform(v,fn));
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,transform(v,fn)]));
  return value;
}
function mediaReferences(text){
  const result=[];
  if(MEDIA.test(text)&&!/[<>\s]/.test(text))result.push(text);
  // Full path fields may legitimately contain spaces.
  if(MEDIA.test(text)&&!/^[<{]/.test(text)&&!/[<>]/.test(text)&&!text.includes("\n")&&text.length<2048&&/^(?:assets|worlds|modules|systems|icons|bcc|https?:\/\/)/i.test(text))result.push(text);
  for(const m of text.matchAll(/\b(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi))if(MEDIA.test(m[1]))result.push(m[1]);
  return result;
}
function embeddedHierarchy(){
  const out={};
  for(const [type,config] of Object.entries(globalThis.CONFIG??{})){
    const embedded=config?.documentClass?.metadata?.embedded;if(embedded&&typeof embedded==="object")out[type]=embedded;
  }
  return out;
}
function cleanStats(doc){
  delete doc._key;
  if(doc._stats){delete doc._stats.lastModifiedBy;delete doc._stats.exportSource;}
  if(doc.flags?.bcc){delete doc.flags.bcc.contentHash;delete doc.flags.bcc.importedAt;}
  // Source URLs are provenance, not a requirement to contact the source again.
  if(doc.flags?.bcc?.assets)delete doc.flags.bcc.assets.files;
  for(const key of ["items","effects","pages","categories"])for(const child of doc[key]??[])if(typeof child==="object")cleanStats(child);
  return doc;
}
function embeddedExists(doc,suffix){
  let current=doc;const fields={JournalEntryPage:"pages",JournalEntryCategory:"categories",Item:"items",ActiveEffect:"effects"};
  for(let i=0;i<suffix.length;i+=2){current=current?.[fields[suffix[i]]]?.find(d=>d._id===suffix[i+1]);if(!current)return false;}
  return true;
}
async function readPack(pack){
  const errors=[],hooks=globalThis.Hooks;
  const listener=hooks?.on?.("error",(_location,error,data={})=>{const message=[data.msg,error?.message].filter(Boolean).join(" — ");if(message.includes(pack.collection))errors.push(message);});
  try{
    const documents=await pack.getDocuments();
    for(const doc of documents)if(typeof doc.validate==="function"&&doc.validate({strict:true})===false)errors.push(`${doc.name}: documento inválido`);
    return {documents:documents.map(d=>cleanStats(plain(d))),errors};
  }finally{if(listener!=null)hooks.off("error",listener);}
}
/** Read-only snapshot of persisted compendiums. No source JSON is re-imported. */
export async function validateExport(sources,identity,onProgress=()=>{}){
  if(!game.user?.isGM)throw Error("A exportação requer usuário GM.");
  identity=exportIdentity(identity);
  const books=exportBooks().filter(b=>sources.includes(b.source));if(!books.length)throw Error("Selecione ao menos um livro importado.");
  const report={errors:[],warnings:[],books:books.map(b=>b.source),dependencies:[],packs:[],assets:0,documents:0,generatedAt:new Date().toISOString()};
  const pending=books.flatMap(b=>b.packs),packs=new Map(),externalModules=new Map(),references=new Set();
  for(let i=0;i<pending.length;i++){
    const pack=pending[i];if(packs.has(pack.collection))continue;
    if(!SUPPORTED.has(pack.documentName)){report.errors.push(`Compêndio dependente de tipo não suportado: ${pack.collection}`);continue;}
    onProgress(`Lendo ${pack.title??pack.collection} (${i+1}/${pending.length})...`);
    let documents,folders;
    try{const loaded=await readPack(pack);documents=loaded.documents;report.errors.push(...loaded.errors);folders=values(pack.folders).map(d=>cleanStats(plain(d)));}
    catch(error){report.errors.push(`${pack.collection}: ${error.message}`);continue;}
    if(pack.invalidDocumentIds?.size)report.errors.push(`${pack.collection}: ${pack.invalidDocumentIds.size} documentos inválidos no compêndio.`);
    const targetName=pack.collection.slice("world.".length),row={old:pack.collection,name:targetName,label:pack.title??pack.metadata?.label??targetName,type:pack.documentName,documents,folders};
    packs.set(pack.collection,row);
    for(const doc of documents)strings(doc,(text,path)=>{
      for(const match of text.matchAll(UUID)){
        references.add(match[0]);const collection=`${match[1]}.${match[2]}`;
        if(packs.has(collection)||pending.some(p=>p.collection===collection))continue;
        const dependency=game.packs.get(collection);
        if(match[1]==="world"){
          if(dependency&&SUPPORTED.has(dependency.documentName)){pending.push(dependency);report.dependencies.push(collection);}
          else report.errors.push(`${doc.name}: compêndio dependente indisponível ${collection}`);
        }else if(dependency?.metadata?.packageType==="system"||match[1]===game.system.id){/* Provided by the game system. */}
        else if(dependency&&game.modules?.get(match[1]))externalModules.set(match[1],game.modules.get(match[1]));
        else report.errors.push(`${doc.name}: dependência externa indisponível ${collection}`);
      }
      if(text.startsWith("bcc-unresolved:")&&!path.includes("description"))report.errors.push(`${doc.name}: recurso não resolvido ${text.slice(15)}`);
      if(text.includes("Actor.")||text.includes("Item.")||text.includes("JournalEntry.")){
        if(!path.includes("flags")&&!path.includes("_stats")&&/(?:^|@UUID\[|data-uuid=["'])((?:Actor|Item|JournalEntry)\.[A-Za-z0-9]{16})(?=$|[.\]"'])/.test(text))report.errors.push(`${doc.name}: vínculo direto com documento do World; inclua uma referência de compêndio.`);
      }
    });
    await pause();
  }
  for(const uuid of references){
    const parts=uuid.split("."),collection=`${parts[1]}.${parts[2]}`,row=packs.get(collection);
    if(row){const doc=row.documents.find(d=>d._id===parts[4]);if(!doc||!embeddedExists(doc,parts.slice(5)))report.errors.push(`Documento referenciado não encontrado: ${uuid}`);}
    else {try{if(!(await fromUuid(uuid)))report.errors.push(`Referência externa não encontrada: ${uuid}`);}catch(error){report.errors.push(`${uuid}: ${error.message}`);}}
  }
  const assets=new Map();
  for(const row of packs.values())for(const doc of row.documents)strings(doc,(text)=>{
    for(const raw of mediaReferences(text)){
      const source=imageSource(raw.replaceAll("&amp;","&"));if(!source){report.errors.push(`${doc.name}: caminho de mídia inválido ${raw}`);continue;}
      if(source.startsWith("icons/")||source.startsWith(`systems/${game.system.id}/`))continue;
      if(source.startsWith("systems/")){report.errors.push(`${doc.name}: mídia de outro sistema ${source}`);continue;}
      if(!assets.has(source))assets.set(source,{source,aliases:new Set()});assets.get(source).aliases.add(raw);
    }
  });
  // Validate bytes now; generation uses these exact validated bytes.
  let done=0,totalBytes=0;
  for(const asset of assets.values()){
    onProgress(`Conferindo mídia ${++done}/${assets.size}...`);
    try{
      const remote=/^https?:\/\//i.test(asset.source),url=remote?asset.source:(foundry.utils.getRoute?.(asset.source)??asset.source);
      const response=await fetch(url,{credentials:remote?"omit":"same-origin",signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error(`HTTP ${response.status}`);
      const blob=await response.blob();if(!blob.size||blob.size>50*1024*1024)throw Error("Arquivo vazio ou maior que 50 MiB");
      const ext=/\.([a-z0-9]+)(?:[?#]|$)/i.exec(asset.source)?.[1].toLowerCase();
      if(["webp","png","jpg","jpeg","svg","gif","avif"].includes(ext)&&!validImageSignature(ext,new Uint8Array(await blob.slice(0,1024).arrayBuffer())))throw Error("Formato de imagem inválido");
      if(!ext)throw Error("Extensão de mídia não identificada");
      totalBytes+=blob.size;if(totalBytes>512*1024*1024)throw Error("Seleção maior que 512 MiB; exporte menos livros por vez.");
      const digest=[...new Uint8Array(await crypto.subtle.digest("SHA-256",await blob.arrayBuffer()))].map(n=>n.toString(16).padStart(2,"0")).join("");
      asset.path=`assets/${digest}.${ext}`;asset.blob=blob;
    }catch(error){report.errors.push(`Mídia ${asset.source}: ${error.message}`);}
    await pause();
  }
  const aliases=new Map();for(const asset of assets.values())if(asset.path){for(const alias of asset.aliases)aliases.set(alias,`modules/${identity.id}/${asset.path}`);aliases.set(asset.source,`modules/${identity.id}/${asset.path}`);}
  const spellLists=[];
  for(const row of packs.values()){
    row.documents=row.documents.map(d=>transform(d,text=>{
      let out=text.replace(UUID,(uuid,owner,name)=>owner==="world"&&packs.has(`${owner}.${name}`)?uuid.replace(`Compendium.${owner}.${name}.`,`Compendium.${identity.id}.${packs.get(`${owner}.${name}`).name}.`):uuid);
      if(aliases.has(out))return aliases.get(out);
      if(/[<>]/.test(out))out=out.replace(/\b(src|href|poster)\s*=\s*(["'])([^"']+)\2/gi,(m,key,quote,path)=>aliases.has(path)?`${key}=${quote}${aliases.get(path)}${quote}`:m);
      return out;
    }));
    for(const doc of row.documents)for(const page of doc.pages??[])if(page.type==="spells")spellLists.push(`Compendium.${identity.id}.${row.name}.JournalEntry.${doc._id}.JournalEntryPage.${page._id}`);
    report.documents+=row.documents.length;report.packs.push({name:row.name,label:row.label,type:row.type,documents:row.documents.length,folders:row.folders.length});
  }
  if(externalModules.size)report.warnings.push(`Requer módulos externos: ${[...externalModules.keys()].join(", ")}`);
  report.warnings.push("A validação confere estrutura, referências e arquivos. Mecânicas e Activities precisam de testes no Foundry.");
  report.errors=[...new Set(report.errors)];report.assets=new Set([...assets.values()].map(a=>a.path).filter(Boolean)).size;report.assetBytes=totalBytes;
  const manifest={id:identity.id,title:identity.title,version:identity.version,description:"Native D&D5e compendiums exported from Book Compendium Converter.",authors:[{name:game.user.name??"Game Master"}],compatibility:{minimum:"14.369",verified:"14.369"},relationships:{systems:[{id:"dnd5e",type:"system",compatibility:{minimum:"6.0.6"}}],...(externalModules.size?{requires:[...externalModules].map(([id,module])=>({id,type:"module",compatibility:{minimum:module.version}}))}:{})},packs:[...packs.values()].map(p=>({name:p.name,label:p.label,path:`packs/${p.name}`,type:p.type,system:"dnd5e",flags:{bcc:{exported:true}}})),packFolders:books.map(b=>({name:b.name,color:b.color,sorting:"a",packs:b.packs.map(p=>packs.get(p.collection)?.name).filter(Boolean)})),esmodules:["scripts/runtime.mjs"],flags:{dnd5e:{spellLists},bcc:{exportVersion:1,books:report.books}}};
  return {manifest,packs,assets,report,hierarchy:embeddedHierarchy()};
}
export async function buildExport(snapshot,onProgress=()=>{}){
  if(!game.user?.isGM)throw Error("A exportação requer usuário GM.");
  if(snapshot.report.errors.length)throw Error("Resolva os erros da validação antes de exportar.");
  const zip=new ExportZip(),root=snapshot.manifest.id;
  await zip.add(`${root}/module.json`,JSON.stringify(snapshot.manifest,null,2),{compress:true});
  let count=0;
  for(const row of snapshot.packs.values()){
    onProgress(`Empacotando ${row.label} (${++count}/${snapshot.packs.size})...`);
    const records=databaseEntries(row.documents,row.folders,row.type,snapshot.hierarchy);
    for(const [file,bytes] of levelDatabase(records))await zip.add(`${root}/packs/${row.name}/${file}`,bytes,{compress:true});
    await pause();
  }
  const seen=new Set();count=0;
  for(const asset of snapshot.assets.values()){if(seen.has(asset.path))continue;seen.add(asset.path);onProgress(`Incluindo mídia ${++count}/${snapshot.report.assets}...`);await zip.add(`${root}/${asset.path}`,asset.blob);await pause();}
  const runtimeResponse=await fetch(foundry.utils.getRoute?.("modules/book-compendium-converter/scripts/export-runtime.mjs")??"modules/book-compendium-converter/scripts/export-runtime.mjs",{credentials:"same-origin"});if(!runtimeResponse.ok)throw Error("Não foi possível carregar o suporte do módulo exportado.");
  await zip.add(`${root}/scripts/runtime.mjs`,await runtimeResponse.text(),{compress:true});
  await zip.add(`${root}/export-report.json`,JSON.stringify(snapshot.report,null,2),{compress:true});
  await zip.add(`${root}/README.md`,`# ${snapshot.manifest.title}\n\nExtract this folder to FoundryVTT/Data/modules/${root}/, restart Foundry and enable the module in a D&D5e world. Native compendiums and spell lists are provided without BCC, Plutonium or local 5etools data. Any external module dependencies are listed in module.json. Existing Actor inventories are not synchronized.\n\nThis package contains a snapshot of the validated compendium documents; it does not certify mechanical completeness.\n`);
  return zip.blob();
}
export function downloadExport(blob,name){const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
