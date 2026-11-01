import {contentHash} from "./integrity.mjs";
import {stableId} from "./hash.mjs";
import {packAddress} from "./destination.mjs";
const rows=v=>v?.contents??Array.from(v?.values?.()??v??[]);
const rules=v=>({one:"2024",classic:"2014"}[v]??v);
export async function providerCatalog(){
  const catalog=new Map();
  for(const pack of rows(globalThis.game?.packs)){
    if(!["Item","Actor"].includes(pack.documentName))continue;
    if(!pack.collection.startsWith("world.bcc-")&&!pack.metadata?.flags?.bcc?.exported)continue;
    const index=await pack.getIndex({fields:["flags.bcc.identity","flags.bcc.rules","flags.bcc.dependency","flags.bcc.sourceId","flags.bcc.bundleComponent"]});
    for(const doc of rows(index))if(doc.flags?.bcc?.identity&&!doc.flags.bcc.bundleComponent&&!doc.system?.container){const key=doc.flags.bcc.identity;
      if(!catalog.has(key))catalog.set(key,[]);catalog.get(key).push({uuid:`Compendium.${pack.collection}.${pack.documentName}.${doc._id}`,rules:rules(doc.flags.bcc.rules),dependency:!!doc.flags.bcc.dependency,sourceId:doc.flags.bcc.sourceId});}
  }
  return catalog;
}
export function chooseProvider(catalog,key,rule){
  let candidates=(catalog.get(key)??[]).filter(p=>!rule||!p.rules||p.rules==="unspecified"||p.rules===rules(rule));
  const primary=candidates.filter(p=>!p.dependency);if(primary.length)candidates=primary;
  return candidates.length===1?{...candidates[0],status:"available"}:{status:candidates.length?"ambiguous":"missing"};
}
export async function applyDependencyPolicy(index,content,packDefs){
  if(content.includeDependencies!==false)return;
  const catalog=await providerCatalog(),dependencies=[],remap=new Map(),parents=new Map(index.all.map(e=>[e._id,e]));
  for(const entry of index.all){
    if(!entry.record._bccDependency||entry.record._bccBundleInstance)continue;
    const provider=chooseProvider(catalog,entry.key,entry.record._bccRules??entry.record.edition);
    const address=packAddress(entry.record.source,packDefs[entry.kind][0]),id=await stableId(`${entry.record.source}:${entry.key}`);
    const previousUuid=entry.uuid;entry.external=true;entry._id=provider.uuid?.split(".").at(-1)??id;
    entry.packId=provider.uuid?.split(".").slice(1,3).join(".")??address.packId;
    entry.uuid=provider.uuid??`Compendium.${address.packId}.${packDefs[entry.kind][2]}.${id}`;
    remap.set(previousUuid,entry.uuid);
    dependencies.push({kind:entry.kind,identity:entry.key,source:entry.record.source,name:entry.record.name,rules:entry.record._bccRules,uuid:entry.uuid,status:provider.status,reasons:entry.record._bccDependencyReasons??[]});
  }
  for(const entry of index.all.filter(e=>e.record._bccBundleInstance)){const parent=parents.get(entry.record._bccBundleInstance.parentId);entry.external=!!parent?.external;if(!entry.external)entry.record._bccDependency=false;const component=entry.record._bccBundleInstance;if(remap.has(component.template))component.template=remap.get(component.template);}
  index.externalReferences=dependencies;
  content.externalDependencies=dependencies;
}
export function dependencySummary(index,source){
  const books=new Map();
  for(const entry of index.externalReferences??[]){
    // Class closures are catalog candidates, not all direct dependencies of the selected book.
    if(!entry.reasons.some(r=>r.includes(`|${source}:`)||r==="explicit book reference"))continue;
    const book=books.get(entry.source)??{source:entry.source,available:0,missing:0,ambiguous:0};
    book[entry.status]++;books.set(entry.source,book);
  }
  return [...books.values()];
}
export function mapStrings(value,replace){
  if(typeof value==="string")return replace(value);
  if(Array.isArray(value))return value.map(v=>mapStrings(v,replace));
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,mapStrings(v,replace)]));
  return value;
}
export function externalReferencesFor(doc,index){
  const serialized=JSON.stringify(doc);
  return (index.externalReferences??[]).filter(e=>serialized.includes(e.uuid)||doc.type==="subclass"&&e.kind==="class"&&e.identity.split("|")[1]===doc.flags?.bcc?.identity?.split("|")[4]&&e.name.toLowerCase().replace(/[^a-z0-9]+/g,"-")===doc.system.classIdentifier);
}
/** Rebind only declared BCC links after the supplying book is imported. */
export async function reconcileBookLinks(){
  const catalog=await providerCatalog(),result={updated:0,pending:[],pendingDetails:[]};
  for(const pack of rows(game.packs).filter(p=>p.collection.startsWith("world.bcc-")&&["Item","Actor","JournalEntry"].includes(p.documentName))){
    const changes=[];
    for(const document of await pack.getDocuments()){
      const refs=document.flags?.bcc?.externalReferences;if(!refs?.length)continue;
      const replacements=new Map(),next=refs.map(ref=>{
        const provider=chooseProvider(catalog,ref.identity,ref.rules);
        if(provider.status==="available"){if(provider.uuid!==ref.uuid)replacements.set(ref.uuid,provider.uuid);return {...ref,uuid:provider.uuid,status:provider.status};}
        result.pending.push(`${document.name}: ${ref.source} / ${ref.name} (${provider.status})`);result.pendingDetails.push({sourceId:document.flags?.bcc?.sourceId,owner:document.name,source:ref.source,name:ref.name,status:provider.status});return {...ref,status:provider.status};
      });
      if(!replacements.size&&JSON.stringify(next)===JSON.stringify(refs))continue;
      const updated=mapStrings(document.toObject(),s=>{for(const [a,b] of replacements)s=s.replaceAll(a,b);return s;});
      updated.flags.bcc.externalReferences=next;
      if(document.flags?.bcc?.contentHash===await contentHash(document))updated.flags.bcc.contentHash=await contentHash(updated);
      changes.push(updated);
    }
    if(changes.length){const cls=globalThis.CONFIG?.[pack.documentName]?.documentClass;if(!cls?.updateDocuments)throw Error(`Cannot reconcile ${pack.collection}`);await cls.updateDocuments(changes,{pack:pack.collection,bccDependencyRebind:true});result.updated+=changes.length;}
  }
  return result;
}
