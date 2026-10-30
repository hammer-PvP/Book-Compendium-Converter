import {organizeDocuments} from "./organization.mjs";
import {contentHash, auditReferences} from "./integrity.mjs";
import {saveSpellLists} from "./spell-lists.mjs";
import {buildIndex, convertOne, createReport, finalizeReport, PACK_DEFS} from "./converter.mjs";

// Use the game-system document classes, not Foundry core globals.
// D&D5e NPC data preparation calls Actor5e methods such as getCRExp().
// `new Actor(...)` uses the core class, which lacks those methods and logs
// misleading preparation errors even if subsequent writes are reported as OK.
function getDocumentClass(documentName) {
  const cls=CONFIG?.[documentName]?.documentClass;
  if (typeof cls!=="function") throw new Error(`BCC: nenhuma classe de documento do sistema para ${documentName}`);
  return cls;
}
const LABELS=Object.fromEntries(Object.entries(PACK_DEFS).map(([k,v])=>[k,v[1]]));
const batches=(items,size=35)=>Array.from({length:Math.ceil(items.length/size)},(_,i)=>items.slice(i*size,(i+1)*size));

async function getFolder(book){
  const folders=game.folders.filter(f=>f.type==="Compendium"&&f.name===book.name&&f.flags?.bcc?.sourceId===book.id);
  if(folders.length)return folders[0];
  const collision=game.folders.some(f=>f.type==="Compendium"&&f.name===book.name);
  if(collision)throw new Error(`Já existe uma pasta de Compendiums chamada "${book.name}". Renomeie-a para evitar conflito.`);
  return Folder.create({name:book.name,type:"Compendium",color:"#987e4d",flags:{bcc:{sourceId:book.id}}});
}

async function getPack(index,kind,folder,content){
  const meta=index.packKeys.get(kind);
  let pack=game.packs.get(meta.packId);
  if(!pack){
    pack=await foundry.documents.collections.CompendiumCollection.createCompendium({
      name:meta.packName,label:meta.label,type:meta.docType,system:meta.docType==="Item"||meta.docType==="Actor"?"dnd5e":undefined,
      package:meta.package,flags:{bcc:{sourceId:content.sourceId,category:kind}}
    });
  }
  if(pack.documentName!==meta.docType)throw new Error(`Pacote ${meta.packId} tem tipo incompatível: ${pack.documentName}`);
  await pack.setFolder(folder);
  return pack;
}

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const transientError=error=>/timeout|timed out|network|failed to fetch|502|503|504|429|connection reset|socket hang up|aborterror/i.test(String(error?.message??error));
function recordFailure(report,kind,doc,error,phase){
  const issue={category:kind,name:doc.name,id:doc._id,phase,message:String(error?.message??error)};
  report.validationFailures.push(issue);
  report.errors.push(`${kind} / ${doc.name} [${doc._id}]: ${phase} — ${issue.message}`);
}
function preflight(cls,doc,pack,kind,report){
  try{
    // Constructing a client document does not persist it; this also validates nested dnd5e Activities.
    const test=new cls(doc,{pack:pack.collection});
    // Validation of the schema is not sufficient if data preparation logged
    // a non-throwing error; confirm a D&D5e Actor has its required methods.
    if(kind==="monster" && typeof test.getCRExp!=="function")
      throw new Error("Actor5e inválido no preflight: getCRExp indisponível");
    if(typeof test.validate==="function" && test.validate({strict:true})===false)
      throw new Error("A validação estrita retornou false");
    return true;
  }catch(error){recordFailure(report,kind,doc,error,"schema preflight");return false;}
}
async function writeOne(cls,pack,doc,kind,report){
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const saved=await cls.create(doc,{pack:pack.collection,keepId:true});
      if(!saved)throw new Error("The server returned no document");
      await stamp(cls,pack,[saved]);
      report.created[kind]=(report.created[kind]||0)+1;
      return;
    }catch(error){
      // A transport failure can happen after a successful commit. Confirm before retrying.
      if(transientError(error)){
        try{if((await pack.getIndex()).some(x=>x._id===doc._id)){
          report.created[kind]=(report.created[kind]||0)+1;
          return;
        }}catch(_){}
      }
      if(attempt===3||!transientError(error)){
        recordFailure(report,kind,doc,error,"create");return;
      }
      await pause(300*attempt);
    }
  }
}
async function stamp(cls,pack,documents){
  if(!documents.length)return;
  const updates=[];for(const document of documents)updates.push({_id:document.id??document._id,"flags.bcc.contentHash":await contentHash(document)});
  await cls.updateDocuments(updates,{pack:pack.collection});
}
async function createBatch(pack,docs,kind,report,options){
  const cls=getDocumentClass(pack.documentName);
  const initialIds=new Set((await pack.getIndex()).map(it=>it._id));
  const fresh=[],updates=[];
  const current=initialIds.size&&options.mode!=="create"?new Map((await pack.getDocuments()).map(d=>[d.id,d])):new Map();
  for(const doc of docs){
    if(initialIds.has(doc._id)){
      const existing=current.get(doc._id);
      if(options.mode==="create"){
        report.existing[kind]=(report.existing[kind]||0)+1;
        report.incomplete.add(`${doc.name}: existing document skipped; its mechanics were not regenerated`);continue;
      }
      if(existing?.flags?.bcc?.sourceId!==report.sourceId){recordFailure(report,kind,doc,new Error("Existing document is not owned by this BCC import"),"update ownership");continue;}
      if(options.mode!=="rebuild"&&(!existing.flags.bcc.contentHash||existing.flags.bcc.contentHash!==await contentHash(existing))){
        report.existing[kind]=(report.existing[kind]||0)+1;report.preserved=(report.preserved??0)+1;
        report.incomplete.add(`${doc.name}: prior-version or locally modified document preserved`);continue;
      }
      if(preflight(cls,doc,pack,kind,report))updates.push({...doc,flags:{...existing.toObject().flags,...doc.flags}});
      continue;
    }
    if(preflight(cls,doc,pack,kind,report))fresh.push(doc);
  }
  for(const batch of batches(updates,25)){
    try{
      const saved=await cls.updateDocuments(batch,{pack:pack.collection,diff:false,recursive:false});
      const savedIds=new Set((saved??[]).filter(Boolean).map(d=>d.id??d._id));
      report.updated[kind]=(report.updated[kind]??0)+savedIds.size;await stamp(cls,pack,saved??[]);
      for(const doc of batch)if(!savedIds.has(doc._id))recordFailure(report,kind,doc,new Error("Server did not confirm the updated document"),"verify update");
    }
    catch(error){for(const doc of batch)recordFailure(report,kind,doc,error,"update");}
  }
  for(const batch of batches(fresh,25)){
    try{
      const results=await cls.createDocuments(batch,{pack:pack.collection,keepId:true});
      await stamp(cls,pack,results??[]);
      const savedIds=new Set((results??[]).filter(Boolean).map(x=>x.id??x._id));
      report.created[kind]=(report.created[kind]||0)+savedIds.size;
      if(savedIds.size!==batch.length){
        report.warnings.push(`${kind}: batch returned ${savedIds.size}/${batch.length}; checking missing documents individually`);
        for(const doc of batch)if(!savedIds.has(doc._id))await writeOne(cls,pack,doc,kind,report);
      }
    }catch(error){
      report.warnings.push(`${kind}: batch failed (${error.message}); retrying individual documents after verification`);
      const currentIds=new Set((await pack.getIndex()).map(it=>it._id));
      for(const doc of batch){
        if(currentIds.has(doc._id)){report.created[kind]=(report.created[kind]||0)+1;continue;}
        await writeOne(cls,pack,doc,kind,report);
      }
    }
  }
  // Query the actual persisted index, not the number of attempted creates.
  const persisted=new Set((await pack.getIndex()).map(it=>it._id));
  const recordedFailures=new Set(report.validationFailures.filter(x=>x.category===kind).map(x=>x.id));
  for(const doc of docs){
    if(!persisted.has(doc._id) && !recordedFailures.has(doc._id))
      recordFailure(report,kind,doc,new Error("Document absent from compendium after write"),"verify");
  }
}

export async function importBook(content, onProgress=()=>{}, options={mode:"create"}){
  if(!game.user.isGM)throw new Error("A importação requer usuário GM.");
  if(game.system.id!=="dnd5e")throw new Error("A versão inicial requer o sistema dnd5e.");
  const index=await buildIndex(content);
  const report=createReport(content);
  const folder=await getFolder(content.book);
  report.folderId=folder.id;
  let processed=0;
  const total=index.all.length;
  // Persist target Actors and Spells before Activities that reference them.
  const order=["monster","object","vehicle","spell","item","raceFeature","classFeature",
    "subclassFeature","optionalfeature","feat","race","background","subclass","class","spellList","chapter"];
  for(const kind of order){
    const entries=index.all.filter(entry=>entry.kind===kind);
    if(!entries.length)continue;
    onProgress(`${LABELS[kind]}: preparando ${entries.length} documentos (${processed}/${total})...`);
    const pack=await getPack(index,kind,folder,content);
    const docs=[];
    for (const entry of entries){
      try{ docs.push(await convertOne(entry,index,content,report)); }
      catch(e){report.errors.push(`${kind} / ${entry.record.name}: conversão — ${e.message}`);}
      processed++;
    }
    auditReferences(docs,index,report);
    await organizeDocuments(pack,docs,entries,index);
    onProgress(`${LABELS[kind]}: gravando ${docs.length} documentos...`);
    await createBatch(pack,docs,kind,report,options);
  }
  await saveSpellLists(index.all.filter(e=>!report.validationFailures.some(f=>f.id===e._id)));
  report.countDocuments=index.all.length;
  report.persistedTotal=Object.values(report.created).reduce((a,b)=>a+b,0)+Object.values(report.updated).reduce((a,b)=>a+b,0)+
    Object.values(report.existing).reduce((a,b)=>a+b,0);
  report.failedCount=report.validationFailures.length;
  report.status=report.errors.length?"failed":(report.unresolved.size||report.incomplete.size?"incomplete":"complete");
  const output=finalizeReport(report);
  const audit={sourceId:content.sourceId,bookName:content.book.name,compendiumFolder:folder.id,
    countByType:output.created,importedAt:output.generatedAt};
  await game.settings.set("book-compendium-converter","lastImport",audit);
  onProgress(`${output.status==="failed"?"Importação com falhas":"Gravação concluída"}: ${output.persistedTotal}/${output.countDocuments} documentos presentes, ${output.errors.length} erros, ${output.unresolved.length} vínculos pendentes. Ainda não homologado para Character Builder.`);
  return output;
}
