import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {applyDependencyPolicy,externalReferencesFor} from '../scripts/book-dependencies.mjs';
import {validateExport,buildExport,deduplicatePacks,suggestExportIdentity} from '../scripts/exporter.mjs';
import {buildIndex,convertOne,createReport} from '../scripts/converter.mjs';
import {stableId} from '../scripts/hash.mjs';
const storage=new Map(),packs=new Map();
globalThis.game={user:{isGM:true,name:'Test'},system:{id:'dnd5e'},packs,folders:new Map(),modules:new Map(),settings:{get:(_id,key)=>structuredClone(storage.get(key)),set:async(_id,key,value)=>storage.set(key,structuredClone(value))}};
globalThis.CONFIG={};globalThis.foundry={utils:{getRoute:p=>p}};
globalThis.fetch=async path=>new Response(await readFile(new URL('../scripts/'+String(path).split('/').at(-1),import.meta.url)));
const S='1111111111111111',F='2222222222222222',uuid=`Compendium.world.bcc-base-spells.Item.${S}`;
const spell={_id:S,name:'Synthetic Spell',type:'spell',img:'icons/svg/book.svg',system:{level:1},flags:{bcc:{identity:'spell|base|synthetic spell||||||',rules:'2024',sourceId:'BASE',dependency:false}}};
const feature={_id:F,name:'Synthetic Gift',type:'feat',system:{advancement:{grant:{type:'ItemGrant',configuration:{items:[{uuid}]}}}},flags:{bcc:{identity:'feat|supplement|synthetic gift||||||',sourceId:'SUP',rules:'2024'}}};
const pack=(collection,source,documents)=>({collection,documentName:'Item',metadata:{flags:{bcc:{sourceId:source}}},folder:{name:source,flags:{bcc:{sourceId:source}}},folders:[],async getDocuments(){return documents;},async getIndex(){return documents;}});
packs.set('world.bcc-base-spells',pack('world.bcc-base-spells','BASE',[spell]));packs.set('world.bcc-sup-feats',pack('world.bcc-sup-feats','SUP',[feature]));
globalThis.fromUuid=async ref=>{const [,owner,name,,id]=ref.split('.');return (await packs.get(`${owner}.${name}`)?.getDocuments())?.find(d=>d._id===id);};
const before=JSON.stringify([spell,feature]);
const base=await validateExport(['BASE'],{id:'synthetic-base',title:'Base',version:'1.0.0'});assert.deepEqual(base.report.errors,[]);assert.ok((await buildExport(base)).size>1000);
const dependent=await validateExport(['SUP'],{id:'synthetic-sup',title:'Supplement',version:'1.0.0'},()=>{},{includeDependencies:false});assert.deepEqual(dependent.report.errors,[]);assert.equal(dependent.packs.size,1);assert.equal(dependent.manifest.relationships.requires[0].id,'synthetic-base');assert.ok(JSON.stringify([...dependent.packs.values()]).includes('Compendium.synthetic-base.bcc-base-spells.'));
spell.system.level=2;const stale=await validateExport(['SUP'],{id:'synthetic-sup',title:'Supplement',version:'1.0.0'},()=>{},{includeDependencies:false});assert.ok(stale.report.errors.some(s=>s.includes('Reexporte')));spell.system.level=1;
const standalone=await validateExport(['SUP'],{id:'synthetic-all',title:'Standalone',version:'1.0.0'});assert.deepEqual(standalone.report.errors,[]);assert.equal(standalone.packs.size,2);assert.equal(JSON.stringify([spell,feature]),before);
const key=spell.flags.bcc.identity,record={name:spell.name,source:'BASE',_bccRules:'2024',_bccDependency:true,_bccDependencyReasons:['Synthetic Gift|SUP: explicit mechanical reference']};
const entry={kind:'spell',key,record,_id:'old0000000000001',uuid:'Compendium.world.bcc-sup-spells.Item.old0000000000001'},index={all:[entry]};
await applyDependencyPolicy(index,{includeDependencies:false},{spell:['spells','','Item']});assert.equal(entry.uuid,uuid);assert.equal(entry.external,true);assert.equal(index.externalReferences[0].status,'available');
packs.clear();const pending={all:[{kind:'spell',key,record,_id:'old0000000000001',uuid:'old'}]};await applyDependencyPolicy(pending,{includeDependencies:false},{spell:['spells','','Item']});assert.equal(pending.externalReferences[0].status,'missing');assert.equal(pending.all[0]._id,await stableId('BASE:'+key));assert.equal(externalReferencesFor({system:{uuid:pending.all[0].uuid}},pending).length,1);
const a={old:'world.bcc-base-spells',type:'Item',documents:[spell]},copy=structuredClone(spell);copy._id='3333333333333333';copy.flags.bcc.sourceId='SUP';copy.flags.bcc.dependency=true;const b={old:'world.bcc-sup-spells',type:'Item',documents:[copy]};const report={warnings:[]};assert.equal(deduplicatePacks(new Map([[a.old,a],[b.old,b]]),report).size,1);assert.equal(b.documents.length,0);
const container={...structuredClone(spell),type:'container'},containerCopy={...structuredClone(container),_id:'4444444444444444'};const preserved=new Map([['a',{old:'world.a',type:'Item',documents:[container]}],['b',{old:'world.b',type:'Item',documents:[containerCopy]}]]);assert.equal(deduplicatePacks(preserved,{warnings:[]}).size,0);
console.log('PASS standalone/separate export, provider fingerprint drift, read-only snapshots, clean import UUIDs, missing providers, equivalent dedup and container instance preservation');

const kinds=['race','background','feat','item','optionalfeature','class','subclass','classFeature','subclassFeature','spell','monster','object','vehicle'];
const content={sourceId:'TEST',chapters:[],foundry:{},records:Object.fromEntries(kinds.map(k=>[k,[]]))};
content.records.feat.push({name:'Structured Gift',source:'TEST',entries:[],foundryEffects:[{_id:'effect0000000001',name:'Native Effect',changes:[]}],foundryActivities:[{_id:'native0000000001',name:'Enchant',type:'enchant',effects:[{_id:'effect0000000001',riders:{activity:['native0000000002']}}]},{_id:'native0000000002',name:'Rider',type:'utility'}]});
const nativeIndex=await buildIndex(content),nativeReport=createReport(content),native=await convertOne(nativeIndex.all[0],nativeIndex,content,nativeReport);
const activities=Object.values(native.system.activities);assert.ok(activities.every(a=>native.system.activities[a._id]===a));assert.equal(activities[0].effects[0]._id,native.effects[0]._id);assert.deepEqual(activities[0].effects[0].riders.activity,[activities[1]._id]);assert.equal(nativeReport.unresolved.size,0);
console.log('PASS source-native Effects and Activity IDs/riders are normalized consistently');

assert.equal(suggestExportIdentity([{source:'XPHB',name:'Player Handbook'}]).id,'bcc-xphb');assert.equal(suggestExportIdentity([{source:'AU',name:'Arcana'}]).id,'bcc-au');
assert.deepEqual(suggestExportIdentity([{source:'XPHB',name:'Player Handbook'},{source:'AU',name:'Arcana'}]),suggestExportIdentity([{source:'AU',name:'Arcana'},{source:'XPHB',name:'Player Handbook'}]));
const many=Array.from({length:15},(_,i)=>({source:'SOURCE'+i,name:'Book '+i}));assert.ok(suggestExportIdentity(many).id.length<=64);assert.ok(suggestExportIdentity(many).title.length<=150);assert.notEqual(suggestExportIdentity(many).id,suggestExportIdentity(many.slice(0,-1)).id);
console.log('PASS automatic names use source abbreviations and stable bounded collection identifiers');

// Missing IDs can be recovered only when source cardinality makes the association unique.
const unique=structuredClone(content);unique.records.feat=[{name:'Anonymous Definition',source:'TEST',entries:[],foundryEffects:[{name:'Declared Bonus',changes:[{key:'system.abilities.str.value',mode:'ADD',value:2}]}],foundryActivities:[{name:'Apply',type:'utility',effects:[{foundryId:'unidentifiedRef'}]}]}];
const ui=await buildIndex(unique),ur=createReport(unique),ud=await convertOne(ui.all[0],ui,unique,ur);assert.equal(Object.values(ud.system.activities)[0].effects[0]._id,ud.effects[0]._id);assert.equal(ur.unresolved.size,0);assert.equal(ur.recoveredReferences.length,1);assert.equal(ud.effects[0].transfer,false);
unique.records.feat[0].foundryEffects.push({name:'Another Definition',changes:[{key:'system.abilities.dex.value',mode:'ADD',value:2}]});const ai=await buildIndex(unique),ar=createReport(unique);await convertOne(ai.all[0],ai,unique,ar);assert.ok([...ar.unresolved].some(s=>s.includes('missing Effect')));
console.log('PASS unique anonymous Effect association and refusal to guess ambiguous definitions');

const custom=structuredClone(content);custom.records.feat=[];custom.records.class=[{name:'Different Display Name',source:'TEST',foundryIdentifier:'custom-identity',casterProgression:'artificer',spellsKnownProgression:[1]}];custom.records.classFeature=[{name:'Source Table',className:'Different Display Name',classSource:'TEST',source:'TEST',level:1,entries:[{type:'table',rows:[['Option','{@filter Candidates|spells|class=Source}','Intelligence']]}]}];const ci=await buildIndex(custom),cr=createReport(custom),role=ci.all.find(e=>e.record._bccCastingRole);const cd=await convertOne(role,ci,custom,cr);assert.equal(cd.flags.bcc.castingRole.classIdentifier,'custom-identity');assert.equal((await buildIndex(custom)).all.filter(e=>e.record._bccCastingRole).length,1);console.log('PASS casting roles respect explicit native identifiers and repeated analysis is idempotent');
