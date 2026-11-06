import {documentData} from './document-data.mjs';
const KEY=Symbol.for('bcc.bookLinks.v1');
const rows=v=>v?.contents??Array.from(v?.values?.()??v??[]);
export const sourceSlug=s=>String(s??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
/** Logical source identities survive World IDs, package names and export order. */
export function supplierAddress(ref,targets={}){
  const parts=ref.uuid?.split('.')??[],source=sourceSlug(ref.source??ref.identity?.split('|')[1]);
  const suffix=({race:'species',raceFeature:'species-features',background:'backgrounds',feat:'feats',item:'equipment',optionalfeature:'optional-features',class:'classes',subclass:'subclasses',classFeature:'class-features',subclassFeature:'subclass-features',spell:'spells',monster:'actors',object:'objects',vehicle:'vehicles'})[ref.kind??ref.identity?.split('|')[0]];
  const name=suffix?`bcc-${source}-${suffix}`:parts[2]??`bcc-${source}-equipment`,target=targets[`world.${name}`];
  return {moduleId:target?.moduleId??`bcc-${source}`,packName:target?.packName??name,version:target?.version,source:ref.source??ref.identity?.split('|')[1],planned:!!target};
}
export function replaceLinks(value,replacements){
  if(typeof value==='string'){for(const [from,to]of replacements)value=value.replaceAll(from,to);return value;}
  if(Array.isArray(value))return value.map(v=>replaceLinks(v,replacements));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,replaceLinks(v,replacements)]));return value;
}
export function selectBookProvider(candidates,source,{preferWorld=false,rule}={}){
  const normalize=r=>({one:'2024',classic:'2014'}[r]??r);
  let pool=candidates.filter(c=>!c.dependency&&sourceSlug(c.sourceId)===sourceSlug(source)&&(!rule||!c.rules||c.rules==='unspecified'||normalize(c.rules)===normalize(rule)));
  if(!pool.length)return {status:'missing'};
  const preferred=pool.filter(c=>preferWorld?c.uuid.startsWith('Compendium.world.'):!c.uuid.startsWith('Compendium.world.'));if(preferred.length)pool=preferred;
  const unique=[...new Map(pool.map(c=>[c.uuid,c])).values()];return unique.length===1?{...unique[0],status:'available'}:{status:'ambiguous',candidates:unique.map(c=>c.uuid)};
}
export function rebindBookDocument(data,catalog,{preferWorld=false}={}){
  data=documentData(data);const replacements=new Map(),pending=[];
  function visit(doc){
    for(const ref of doc.flags?.bcc?.externalReferences??[]){const match=selectBookProvider(catalog.get(ref.identity)??[],ref.source,{preferWorld,rule:ref.rules});if(match.status==='available'){replacements.set(ref.uuid,match.uuid);ref.status='available';}else{ref.status=match.status;pending.push({...ref});}}
    for(const child of doc.items??[])visit(child);
  }
  visit(data);return {data:replaceLinks(data,replacements),pending};
}
export async function bookProviderCatalog({getIndex}={}){
  const catalog=new Map();
  for(const pack of rows(globalThis.game?.packs)){
    if(!['Item','Actor'].includes(pack.documentName)||(!pack.collection.startsWith('world.bcc-')&&!pack.metadata?.flags?.bcc?.exported))continue;
    const index=await (getIndex?getIndex(pack):pack.getIndex({fields:['flags.bcc.identity','flags.bcc.rules','flags.bcc.sourceId','flags.bcc.dependency','flags.bcc.bundleComponent','system.container']}));
    for(const doc of rows(index)){const b=doc.flags?.bcc;if(!b?.identity||b.bundleComponent||doc.system?.container)continue;const key=b.identity;if(!catalog.has(key))catalog.set(key,[]);catalog.get(key).push({uuid:`Compendium.${pack.collection}.${pack.documentName}.${doc._id}`,sourceId:b.sourceId,rules:b.rules,dependency:!!b.dependency});}
  }
  return catalog;
}
/** In-memory module reads only; World links are reconciled persistently by BCC
 * so their manual-edit protection fingerprints remain valid. */
export function registerBookLinks(){
  if(globalThis[KEY])return;const proto=globalThis.foundry?.documents?.collections?.CompendiumCollection?.prototype;if(!proto)return;globalThis[KEY]=true;
  const original={getDocument:proto.getDocument,getDocuments:proto.getDocuments,getIndex:proto.getIndex};let catalogPromise;
  const clear=()=>{catalogPromise=null;};
  const catalog=()=>catalogPromise??=bookProviderCatalog({getIndex:pack=>original.getIndex.call(pack,{fields:['flags.bcc.identity','flags.bcc.rules','flags.bcc.sourceId','flags.bcc.dependency','flags.bcc.bundleComponent','system.container']})}).catch(e=>{clear();throw e;});
  async function bind(doc){if(doc?.pack?.startsWith('world.'))return doc;if(!doc?.flags?.bcc?.externalReferences?.length&&!rows(doc?.items).some(i=>i.flags?.bcc?.externalReferences?.length))return doc;const result=rebindBookDocument(documentData(doc),await catalog());doc.updateSource?.(result.data);return doc;}
  proto.getDocument=async function(...args){return bind(await original.getDocument.apply(this,args));};
  proto.getDocuments=async function(...args){return Promise.all((await original.getDocuments.apply(this,args)).map(bind));};
  for(const event of ['createCompendium','deleteCompendium'])Hooks.on(event,clear);
  for(const event of ['createItem','updateItem','deleteItem','createActor','deleteActor'])Hooks.on(event,doc=>{if(doc.pack)clear();});
  game.bccRuntime??={};game.bccRuntime.refreshBookLinks=clear;
  const check=()=>{const active=rows(game.modules).filter(m=>m.active&&m.flags?.bcc?.books),available=new Set(active.flatMap(m=>m.flags.bcc.books).map(sourceSlug));const missing=[...new Set(active.flatMap(m=>m.flags.bcc.requiredBooks??[]).filter(s=>!available.has(sourceSlug(s))))];if(missing.length&&game.user?.isGM)ui.notifications.warn(`BCC · Para usar todos os recursos, instale e ative os livros: ${missing.join(', ')}.`);};
  if(game.ready)check();else Hooks.once('ready',check);
}
