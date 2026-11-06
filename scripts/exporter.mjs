import {supplierAddress} from "./book-links.mjs";
import {documentData} from "./document-data.mjs";
import {referenceRole,folderClosure} from "./export-references.mjs";
import {sha256} from "./hash.mjs";
import {unsupportedPrerequisites} from "./prerequisites.mjs";
import {databaseEntries,levelDatabase} from "./export-database.mjs";
import {ExportZip} from "./export-zip.mjs";
import {imageSource} from "./assets.mjs";
import {validImageSignature} from "./image-resolver.mjs";
import {sourceColor} from "./source-colors.mjs";

const SUPPORTED=new Set(["Item","Actor","JournalEntry"]),MEDIA=/\.(?:webp|png|jpe?g|svg|gif|avif|ogg|mp3|wav|flac|mp4|webm)(?:[?#]|$)/i;
const UUID=/Compendium\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z][A-Za-z0-9]*)\.([A-Za-z0-9]{16})(?:\.[A-Za-z][A-Za-z0-9]*\.[A-Za-z0-9]{16})*/g;
const pause=()=>new Promise(r=>setTimeout(r,0));
const plain=documentData;
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
/** Use source catalog abbreviations, keeping different book selections distinct. */
export function suggestExportIdentity(books){
  const ordered=[...books].sort((a,b)=>a.source.localeCompare(b.source)),codes=ordered.map(b=>b.source);
  const slug=s=>String(s).normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
  let id=codes.length?`bcc-${codes.map(slug).join("-")}`:"bcc-library";
  if(id.length>64){let hash=2166136261;for(const ch of codes.join("|"))hash=Math.imul(hash^ch.charCodeAt(0),16777619)>>>0;id=`${id.slice(0,54).replace(/-$/,"" )}-${hash.toString(16).padStart(8,"0")}`;}
  const title=ordered.length?ordered.map(b=>`${b.name} (${b.source})`).join(" · ").slice(0,150):"BCC Library";
  return {id,title,version:"1.0.0"};
}
export function exportIdentity({id,title,version}){
  id=String(id??"").trim();title=String(title??"").trim();version=String(version??"").trim();
  if(!/^[a-z][a-z0-9-]{2,63}$/.test(id)||["world","dnd5e","book-compendium-converter"].includes(id))throw Error("Use um identificador de 3–64 caracteres: letras minúsculas, números e hífens.");
  if(!title||title.length>150)throw Error("Informe o nome do módulo (até 150 caracteres).");
  if(!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version))throw Error("Use uma versão como 1.0.0.");
  return {id,title,version};
}
export async function packFingerprint(documents,folders=[]){
  const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).filter(k=>!["_stats","contentHash","importedAt"].includes(k)).sort().map(k=>[k,stable(v[k])])):v;
  return sha256(JSON.stringify(stable({documents:[...documents].sort((a,b)=>a._id.localeCompare(b._id)),folders:[...folders].sort((a,b)=>a._id.localeCompare(b._id))})));
}
function strings(value,fn,path=[]){
  if(typeof value==="string")fn(value,path);
  else if(Array.isArray(value))value.forEach((v,i)=>strings(v,fn,[...path,i]));
  else if(value&&typeof value==="object")for(const [k,v] of Object.entries(value))strings(v,fn,[...path,k]);
}
function transform(value,fn,path=[]){
  if(typeof value==="string")return fn(value,path);
  if(Array.isArray(value))return value.map((v,i)=>transform(v,fn,[...path,i]));
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,transform(v,fn,[...path,k])]));
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
/** Collapse only mechanically equivalent BCC documents; preserve divergent edits. */
export function deduplicatePacks(packs,report){
  const byUuid=new Map(),groups=new Map(),redirects=new Map();
  for(const row of packs.values())for(const doc of row.documents){const uuid=`Compendium.${row.old}.${row.type}.${doc._id}`;byUuid.set(uuid,doc.flags?.bcc?.identity??uuid);const key=doc.flags?.bcc?.identity;if(!key||row.type==="JournalEntry"||doc.type==="container"||doc.flags?.bcc?.bundleComponent||doc.system?.container)continue;if(!groups.has(key))groups.set(key,[]);groups.get(key).push({row,doc,uuid});}
  const signature=doc=>{
    function stable(v){if(Array.isArray(v))return v.map(stable);if(v&&typeof v==="object")return Object.fromEntries(Object.keys(v).filter(k=>!["_stats","sourceId","dependency","dependencyReasons","importedAt","contentHash","assets"].includes(k)).sort().map(k=>[k,stable(v[k])]));if(typeof v==="string")return v.replace(UUID,u=>byUuid.get(u)??u);return v;}
    const data=structuredClone(doc);for(const key of ["_id","folder","sort","ownership"])delete data[key];return JSON.stringify(stable(data));
  };
  for(const group of groups.values()){
    group.sort((a,b)=>Number(!!a.doc.flags.bcc.dependency)-Number(!!b.doc.flags.bcc.dependency));const winner=group[0],expected=signature(winner.doc);
    for(const candidate of group.slice(1)){if(signature(candidate.doc)!==expected){report.warnings.push(`${candidate.doc.name}: versões divergentes preservadas na exportação`);continue;}redirects.set(candidate.uuid,winner.uuid);candidate.row.documents=candidate.row.documents.filter(d=>d!==candidate.doc);}
  }
  if(redirects.size)report.warnings.push(`${redirects.size} cópias equivalentes consolidadas; vínculos remapeados`);
  return redirects;
}
/** Save explicit module destinations before packaging; supports any export order. */
export async function saveExportPlan(plans){
  if(!game.user?.isGM)throw Error('O plano de exportação requer GM.');
  const books=exportBooks(),targets={};
  for(const book of books){
    const proposed=plans[book.source];if(!proposed)continue;const identity=exportIdentity(proposed);
    for(const pack of book.packs){const loaded=await readPack(pack),folders=values(pack.folders).map(d=>cleanStats(plain(d)));
      targets[pack.collection]={moduleId:identity.id,packName:pack.collection.slice('world.'.length),version:identity.version,fingerprint:await packFingerprint(loaded.documents,folders),documentIds:loaded.documents.map(d=>d._id),planned:true,requires:[]};
    }
  }
  for(const book of books)for(const pack of book.packs){const target=targets[pack.collection];if(!target)continue;const loaded=await readPack(pack),required=new Set();
    for(const doc of loaded.documents)strings(doc,(text,path)=>{if(referenceRole(path,doc)!=='required')return;for(const m of text.matchAll(UUID)){const dep=targets[`${m[1]}.${m[2]}`];if(dep&&dep.moduleId!==target.moduleId)required.add(dep.moduleId);}});
    target.requires=[...required];
  }
  const existing=game.settings.get('book-compendium-converter','exportTargets')??{};
  await game.settings.set('book-compendium-converter','exportTargets',{...existing,...targets});return targets;
}
/** Read-only snapshot of persisted compendiums. No source JSON is re-imported. */
export async function validateExport(sources,identity,onProgress=()=>{},options={}){
  if(!game.user?.isGM)throw Error("A exportação requer usuário GM.");
  identity=exportIdentity(identity);
  const books=exportBooks().filter(b=>sources.includes(b.source));if(!books.length)throw Error("Selecione ao menos um livro importado.");
  const report={errors:[],warnings:[],books:books.map(b=>b.source),dependencies:[],packs:[],assets:0,documents:0,generatedAt:new Date().toISOString()};
  let exported={};try{exported=game.settings?.get("book-compendium-converter","exportTargets")??{};}catch{}
  const worldExports=new Map();
  const packs=new Map(),externalModules=new Map(),bookModules=new Set(),references=new Set(),loaded=new Map(),suppliers=new Map();
  const problems=new Map();
  const problem=(collection,message,owner)=>{const key=`${collection}: ${message}`;if(!problems.has(key))problems.set(key,new Set());if(owner)problems.get(key).add(owner);};
  async function load(pack){
    if(!loaded.has(pack.collection))loaded.set(pack.collection,(async()=>{
      if(!SUPPORTED.has(pack.documentName))throw Error(`Unsupported pack type ${pack.documentName}`);
      onProgress(`Lendo ${pack.title??pack.collection}...`);
      const data=await readPack(pack),folders=values(pack.folders).map(d=>cleanStats(plain(d)));
      return {...data,folders,fingerprint:await packFingerprint(data.documents,folders)};
    })());return loaded.get(pack.collection);
  }
  const requiredBooks=new Set(),declared=new Map();
  for(const pack of books.flatMap(b=>b.packs)){
    let data;try{data=await load(pack);}catch(error){problem(pack.collection,error.message);continue;}
    report.errors.push(...data.errors);if(pack.invalidDocumentIds?.size)problem(pack.collection,`${pack.invalidDocumentIds.size} documentos inválidos`);
    const docs=data.documents.filter(d=>!d.flags?.bcc?.dependency||d.flags?.bcc?.bundleComponent),ids=new Set(docs.map(d=>d._id)),documents=docs.filter(d=>!d.system?.container||ids.has(d.system.container));
    const omitted=data.documents.length-documents.length;if(omitted)report.warnings.push(`${pack.collection}: ${omitted} cópias externas antigas excluídas; reconstrua este livro para atualizar seus vínculos.`);
    if(!documents.length)continue;
    packs.set(pack.collection,{old:pack.collection,name:pack.collection.slice('world.'.length),label:pack.title??pack.metadata?.label??pack.collection,type:pack.documentName,documents,folders:folderClosure(data.folders,documents),fingerprint:data.fingerprint});
  }
  const selectedByIdentity=new Map();
  for(const row of packs.values())for(const doc of row.documents)if(doc.flags?.bcc?.identity&&!doc.flags.bcc.bundleComponent)selectedByIdentity.set(doc.flags.bcc.identity,`Compendium.${row.old}.${row.type}.${doc._id}`);
  const lists=[...packs.values()].flatMap(row=>row.documents.flatMap(d=>d.pages??[])).filter(p=>p.type==='spells');
  for(const row of packs.values())for(const doc of row.documents)if(doc.type==='class'&&doc.flags?.bcc?.castingProfile&&!lists.some(p=>p.system?.type==='class'&&p.system.identifier===doc.system.identifier))problem(row.old,'lista nativa de magias da classe ausente; reconstrua o livro',doc.name);
  const logicalRedirects=new Map();
  for(const row of packs.values())for(const doc of row.documents){
    const requests=new Map();
    strings(doc,(text,path)=>{
      if(referenceRole(path,doc)!=='required')return;for(const m of text.matchAll(UUID))requests.set(m[0],m);
      if(text.startsWith('bcc-unresolved:'))problem(row.old,`recurso não resolvido ${text.slice(15)}`,doc.name);
      if(path.includes('prerequisites')&&/(?:^|:)object-object$|^\[object Object\]$/.test(text))problem(row.old,'pré-requisito inválido; reconstrua com a versão atual',doc.name);
      if(!path.includes('flags')&&/(?:^|@UUID\[|data-uuid=["'])((?:Actor|Item|JournalEntry)\.[A-Za-z0-9]{16})(?=$|[.\]"'])/.test(text))problem(row.old,'referência direta a documento do World',doc.name);
    });
    const refs=doc.flags?.bcc?.externalReferences??[];
    if(doc.type==='subclass')for(const ref of refs.filter(r=>r.kind==='class')){const m=[...ref.uuid.matchAll(UUID)][0];if(m)requests.set(m[0],m);}
    for(const [uuid,m]of requests){
      const collection=`${m[1]}.${m[2]}`;
      if(packs.has(collection)&&packs.get(collection).documents.some(d=>d._id===m[4])){references.add(uuid);continue;}
      const external=game.packs.get(collection);let ref=refs.find(r=>r.uuid===uuid);
      if(!ref&&external){const data=await load(external),found=data.documents.find(d=>d._id===m[4]);if(found?.flags?.bcc?.identity)ref={identity:found.flags.bcc.identity,kind:found.flags.bcc.category,source:found.flags.bcc.identity.split('|')[1],name:found.name,uuid,rules:found.flags.bcc.rules};}
      if(ref){
        const local=selectedByIdentity.get(ref.identity);if(local){logicalRedirects.set(uuid,local);references.add(local);continue;}
        const target=supplierAddress(ref,exported),parts=uuid.split('.');
        if(m[1]!=='world'&&external?.metadata?.flags?.bcc?.exported){target.moduleId=m[1];target.packName=m[2];target.version=game.modules?.get(m[1])?.version;}
        if(target.moduleId===identity.id){problem(collection,'o identificador de exportação coincide com um fornecedor externo',doc.name);continue;}
        const portable=`Compendium.${target.moduleId}.${target.packName}.${parts.slice(3).join('.')}`;
        logicalRedirects.set(uuid,portable);requiredBooks.add(ref.source);externalModules.set(target.moduleId,{version:target.version});bookModules.add(target.moduleId);
        suppliers.set(ref.source,{...target,collection,status:ref.status??(external?'available':'missing')});
        doc.flags??={};doc.flags.bcc??={};doc.flags.bcc.externalReferences??=[];if(!doc.flags.bcc.externalReferences.some(r=>r.identity===ref.identity))doc.flags.bcc.externalReferences.push({...ref});declared.set(portable,ref);continue;
      }
      if(packs.has(collection)){problem(collection,`documento referenciado ausente ${m[4]}`,doc.name);continue;}
      if(m[1]==='world'){problem(collection,'referência externa sem identidade de origem; reconstrua o livro',doc.name);continue;}
      if(m[1]===game.system.id||external?.metadata?.packageType==='system'){try{if(!await fromUuid(uuid))problem(collection,`referência do sistema ausente ${uuid}`,doc.name);}catch(error){problem(collection,error.message,doc.name);}continue;}
      if(external&&game.modules?.get(m[1]))externalModules.set(m[1],game.modules.get(m[1]));else problem(collection,'referência externa sem definição de fornecedor',doc.name);
    }
  }
  const duplicateRefs=deduplicatePacks(packs,report);for(const [a,b]of logicalRedirects)duplicateRefs.set(a,b);
  for(const uuid of references){const parts=uuid.split('.'),row=packs.get(`${parts[1]}.${parts[2]}`),doc=row?.documents.find(d=>d._id===parts[4]);if(row&&(!doc||!embeddedExists(doc,parts.slice(5))))problem(row.old,`documento referenciado ausente ${parts.slice(3).join('.')}`);}
  report.requiredBooks=[...requiredBooks].sort();report.dependencyPlan=[...suppliers.values()];
  for(const p of report.dependencyPlan)if(p.status==='ambiguous')report.warnings.push(`${p.source}: há múltiplos fornecedores; o vínculo permanece pendente até existir uma origem inequívoca.`);
  report.externalRequirements=report.dependencyPlan.map(p=>({...p,message:`Instale e ative o livro ${p.source} para utilizar os recursos que o referenciam.`}));
  report.referenceIssues=[...problems].map(([message,owners])=>({message,owners:[...owners]}));report.errors.push(...report.referenceIssues.map(p=>`${p.message}${p.owners.length?` (${p.owners.length} documento(s))`:''}`));report.dependencies=[];
  // Containers use sibling IDs rather than UUIDs; validate these links too.
  function containers(docs,label){
    const byId=new Map(docs.map(d=>[d._id,d]));
    for(const doc of docs){
      if(doc.system?.container){const parent=byId.get(doc.system.container);if(!parent||parent.type!=="container")report.errors.push(`${label} / ${doc.name}: container ausente ou inválido ${doc.system.container}`);
        const seen=new Set([doc._id]);let current=doc;while(current?.system?.container){const id=current.system.container;if(seen.has(id)){report.errors.push(`${label} / ${doc.name}: ciclo de containers`);break;}seen.add(id);current=byId.get(id);}}
      if(doc.type==="container"&&Number(doc.system?.quantity??1)!==1)report.errors.push(`${label} / ${doc.name}: container precisa de uma instância por unidade`);
      for(const issue of unsupportedPrerequisites(doc.flags?.bcc?.prerequisiteExpression))report.warnings.push(`${label} / ${doc.name}: ${issue}`);
      if(doc.items)containers(doc.items,`${label} / ${doc.name}`);
    }
  }
  for(const row of packs.values())containers(row.documents,row.label);
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
      const digest=await sha256(await blob.arrayBuffer());
      asset.path=`assets/${digest}.${ext}`;asset.blob=blob;
    }catch(error){report.errors.push(`Mídia ${asset.source}: ${error.message}`);}
    await pause();
  }
  const aliases=new Map();for(const asset of assets.values())if(asset.path){for(const alias of asset.aliases)aliases.set(alias,`modules/${identity.id}/${asset.path}`);aliases.set(asset.source,`modules/${identity.id}/${asset.path}`);}
  const spellLists=[];
  for(const row of packs.values()){
    row.documents=row.documents.map(d=>transform(d,(text,path)=>{
      text=text.replace(UUID,uuid=>duplicateRefs.get(uuid)??uuid);
      if(referenceRole(path,d)==="descriptive")text=text.replace(/@UUID\[([^\]]+)\](?:\{([^}]+)\})?/g,(tag,uuid,label)=>{const parts=uuid.split("."),collection=`${parts[1]}.${parts[2]}`;if(parts[0]==="Compendium"&&parts[1]==="world"&&!packs.get(collection)?.documents.some(d=>d._id===parts[4])&&!worldExports.has(collection)&&!declared.has(uuid)&&![...declared.values()].some(r=>r.uuid===uuid))return label??"Reference";return tag;});
      let out=text.replace(UUID,(uuid,owner,name)=>worldExports.get(`${owner}.${name}`)?.redirects?.[uuid]??(worldExports.has(`${owner}.${name}`)?uuid.replace(`Compendium.${owner}.${name}.`,`Compendium.${worldExports.get(`${owner}.${name}`).moduleId}.${worldExports.get(`${owner}.${name}`).packName}.`):owner==="world"&&packs.has(`${owner}.${name}`)?uuid.replace(`Compendium.${owner}.${name}.`,`Compendium.${identity.id}.${packs.get(`${owner}.${name}`).name}.`):uuid));
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
  const assigned=new Set(exportBooks().flatMap(b=>b.packs.map(p=>p.collection))),extra=[...packs.values()].filter(row=>!assigned.has(row.old)).map(row=>row.name);
  const manifest={id:identity.id,title:identity.title,version:identity.version,description:"Native D&D5e compendiums exported from Book Compendium Converter.",authors:[{name:game.user.name??"Game Master"}],compatibility:{minimum:"14.369",verified:"14.369"},relationships:{systems:[{id:"dnd5e",type:"system",compatibility:{minimum:"6.0.6"}}],...Object.fromEntries([["requires",[...externalModules].filter(([id])=>!bookModules.has(id))],["recommends",[...externalModules].filter(([id])=>bookModules.has(id))]].filter(([,entries])=>entries.length).map(([kind,entries])=>[kind,entries.map(([id,module])=>({id,type:"module",...(module.version?{compatibility:{minimum:module.version}}:{})}))]))},packs:[...packs.values()].map(p=>({name:p.name,label:p.label,path:`packs/${p.name}`,type:p.type,system:"dnd5e",flags:{bcc:{exported:true}}})),packFolders:exportBooks().map(b=>({name:b.name,color:b.color,sorting:"a",packs:b.packs.map(p=>packs.get(p.collection)?.name).filter(Boolean)})).filter(b=>b.packs.length).concat(extra.length?[{name:"Dependencies",sorting:"a",packs:extra}]:[]),esmodules:["scripts/runtime.mjs"],flags:{dnd5e:{spellLists},bcc:{exportVersion:3,runtimeVersion:"0.1.3",books:report.books,requiredBooks:report.requiredBooks}}};
  return {manifest,packs,assets,report,hierarchy:embeddedHierarchy(),exportTargets:Object.fromEntries([...packs.values()].filter(row=>books.some(b=>b.packs.some(p=>p.collection===row.old))).map(row=>[row.old,{moduleId:identity.id,packName:row.name,version:identity.version,fingerprint:row.fingerprint,requires:[...externalModules.keys()],documentIds:row.documents.map(d=>d._id),redirects:Object.fromEntries([...duplicateRefs].filter(([uuid])=>uuid.startsWith(`Compendium.${row.old}.`)).map(([a,b])=>[a,b.replace(/^Compendium\.world\.([^.]+)\./,`Compendium.${identity.id}.$1.`)]))}]))};
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
  for(const file of ["prerequisite-runtime.mjs","prerequisites.mjs","spell-filter.mjs","containers-runtime.mjs","transactions.mjs","spell-grants-runtime.mjs","resource-bindings.mjs","document-data.mjs","casting-profile.mjs","charges.mjs","book-links.mjs","feature-runtime.mjs"]){const response=await fetch(foundry.utils.getRoute?.(`modules/book-compendium-converter/scripts/${file}`)??`modules/book-compendium-converter/scripts/${file}`,{credentials:"same-origin"});if(!response.ok)throw Error(`Não foi possível carregar ${file}`);await zip.add(`${root}/scripts/${file}`,await response.text(),{compress:true});}
  await zip.add(`${root}/export-report.json`,JSON.stringify(snapshot.report,null,2),{compress:true});
  await zip.add(`${root}/README.md`,`# ${snapshot.manifest.title}\n\nExtract this folder to FoundryVTT/Data/modules/${root}/, restart Foundry and enable the module in a D&D5e world. Native compendiums and spell lists are provided without BCC, Plutonium or local 5etools data. Each book contains only its own content. Required books are listed in module.json and export-report.json; their documents are never bundled. Existing Actor inventories are not synchronized.\n\nThis package contains a snapshot of the validated compendium documents; it does not certify mechanical completeness.\n`);
  if(game.settings?.set){let targets={};try{targets=game.settings.get("book-compendium-converter","exportTargets")??{};}catch{}await game.settings.set("book-compendium-converter","exportTargets",{...targets,...snapshot.exportTargets});}
  return zip.blob();
}
export function downloadExport(blob,name){const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
