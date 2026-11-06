import assert from 'node:assert/strict';
import {documentData} from '../scripts/document-data.mjs';
import {withTransaction} from '../scripts/transactions.mjs';
import {castingProfile,castingView,installCastingService,castingOptions} from '../scripts/casting-profile.mjs';
import {variantBases} from '../scripts/magic-variants.mjs';
import {chargeRange,configureCharges,initializeCharges} from '../scripts/charges.mjs';
import {compilePrerequisites,evaluatePrerequisites} from '../scripts/prerequisites.mjs';
import {validateExport,saveExportPlan} from '../scripts/exporter.mjs';
const item={_id:'1111111111111111',name:'Fixture',type:'feat',system:{activities:{use:{type:'utility'}}},flags:{bcc:{identity:'fixture'}}};
let serializers=0;const document={_source:new Proxy(item,{}),toObject(){serializers++;return {...item,system:new Proxy(item.system,{})};}};
const copy=documentData(document);assert.deepEqual(copy,item);assert.equal(serializers,1);copy.system.activities.use.type='damage';assert.equal(item.system.activities.use.type,'utility');
await withTransaction({items:[]},{items:[document]},async()=>{});
assert.deepEqual(documentData({values:new Set(['one']),map:new Map([['a',1]])}),{values:['one'],map:{a:1}});
assert.throws(()=>documentData({bad:()=>{}}),/source.bad/);const circle={};circle.self=circle;assert.throws(()=>documentData(circle),/circular/);
for(const name of ['Synthetic One','Synthetic Two']){
 const profile=castingProfile({casterProgression:'artificer',preparedSpellsChange:'restLong'}),cls={id:'class',type:'class',name,flags:{bcc:{castingProfile:profile}},system:{identifier:name,levels:1,spellcasting:{progression:'artificer'}},toObject(){return {_id:this.id,type:this.type,system:this.system,flags:this.flags};}};
 const actor={items:[cls]},view=castingView(actor);assert.equal(view.items.find(i=>i.type==='class').system.spellcasting.progression,'half');assert.equal(cls.system.spellcasting.progression,'artificer');
 const models={fullList:new Set(),limited:new Set(),spellbook:new Set()};class Service{static async buildContext(draft){await Promise.resolve();return {classIdentifier:name,model:models.fullList.has(name)?'fullList':'wrong',progression:draft.items[Symbol.iterator]().next().value.system.spellcasting.progression};}static async save(draft){return this.buildContext(draft);}}
 installCastingService(Service,models,0,['buildContext','save']);const result=await Service.save(actor);assert.equal(result.model,'fullList');assert.equal(result.progression,'half');assert.equal(models.fullList.size,0);
}
const bases=[{name:'Blade',source:'OLD',edition:'classic',weaponCategory:'martial'},{name:'Blade',source:'NEW',edition:'one',weaponCategory:'martial',mastery:['sap']}];
assert.equal(variantBases(bases,{requires:[{weaponCategory:'martial'}]},'MAGIC','2024')[0].source,'NEW');assert.equal(variantBases(bases,{requires:[{name:'Blade',source:'NEW'}]},'MAGIC','2024')[0].source,'NEW');assert.deepEqual(variantBases(bases.toReversed(),{requires:[{weaponCategory:'martial'}]},'MAGIC','2024'),variantBases(bases,{requires:[{weaponCategory:'martial'}]},'MAGIC','2024'));
assert.deepEqual(chargeRange('1d8 + 1'),{min:2,max:9});assert.deepEqual(chargeRange('1d4 - 1'),{min:0,max:3});assert.equal(chargeRange('1d8 * fn()'),null);
const flags={},system={uses:{max:'1d8+1',spent:0}},report={incomplete:new Set()};configureCharges({name:'Random charge fixture',charges:'{@dice 1d8 + 1}'},system,flags,report);assert.equal(system.uses.max,'9');
const charged={...item,type:'weapon',system:{...system,quantity:2},flags:{bcc:flags}};let rolls=0;const initialized=await initializeCharges([charged],{roll:async()=>++rolls+2,randomId:()=> '2222222222222222'});assert.equal(initialized.length,2);assert.equal(initialized[0].system.uses.max,'3');assert.equal(initialized[1].system.uses.max,'4');assert.equal(charged.system.quantity,2);assert.deepEqual(await initializeCharges(initialized,{roll:()=>assert.fail('reroll')}),initialized);assert.equal((await initializeCharges([charged],{preserve:true}))[0],charged);
globalThis.game={settings:{get:(_n,k)=>k==='bccActorPrerequisitePolicies'?{'Actor.test':{campaigns:['Example'],renown:{guild:25}}}:undefined}};
const feat={type:'feat',flags:{bcc:{featCategories:['CAT']}}},actor={uuid:'Actor.test',items:[feat],flags:{bcc:{prerequisitePolicy:{campaigns:['Example'],renown:{guild:25}}}}};
for(const prereq of [{featCategory:['CAT']},{campaign:['Example']},{otherSummary:{entry:'Renown 25+ with a {@book Guild|SRC|1}',entrySummary:'Guild 25+'}}])assert.equal(evaluatePrerequisites(compilePrerequisites({prerequisite:[prereq]}),actor).qualified,true);
assert.equal(evaluatePrerequisites(compilePrerequisites({prerequisite:[{exclusiveFeatCategory:['CAT']}]}),actor).qualified,false);
assert.equal(evaluatePrerequisites(compilePrerequisites({prerequisite:[{campaign:['Example']}]}),{items:[]}).unsupported,true);
const storage=new Map(),packs=new Map();globalThis.game={user:{isGM:true},system:{id:'dnd5e'},packs,folders:new Map(),modules:new Map(),settings:{get:(_n,k)=>storage.get(k),set:async(_n,k,v)=>storage.set(k,v)}};globalThis.foundry={utils:{}};globalThis.CONFIG={};
const A='aaaaaaaaaaaaaaaa',B='bbbbbbbbbbbbbbbb',C='cccccccccccccccc',uuid=id=>`Compendium.world.bcc-base-actors.Actor.${id}`;
const mkPack=(collection,source,type,docs)=>({collection,documentName:type,metadata:{flags:{bcc:{sourceId:source}}},folder:{name:source},folders:[],getDocuments:async()=>docs});
const root={...item,system:{link:uuid(A)}};const embedded={_id:'eeeeeeeeeeeeeeee',name:'Complete copy',type:'weapon',system:{damage:{base:{number:1}}},_stats:{compendiumSource:'Compendium.world.absent.Item.ffffffffffffffff'}};
packs.set('world.bcc-sup-feats',mkPack('world.bcc-sup-feats','SUP','Item',[root]));packs.set('world.bcc-base-actors',mkPack('world.bcc-base-actors','BASE','Actor',[{_id:A,name:'Needed',items:[embedded],flags:{bcc:{identity:'monster|base|needed||||||',sourceId:'BASE'}}},{_id:B,name:'Unused',system:{link:'Compendium.world.missing.Item.'+C}}]));
const identity={id:'synthetic-supplement',title:'Supplement',version:'1.0.0'};
const snapshot=await validateExport(['SUP'],identity);assert.deepEqual(snapshot.report.errors,[]);assert.equal(snapshot.report.documents,1);assert.equal(snapshot.packs.has('world.bcc-base-actors'),false);assert.equal(snapshot.manifest.packFolders.length,1);
await saveExportPlan({SUP:identity,BASE:{id:'synthetic-provider',title:'Base',version:'1.0.0'}});
const separate=await validateExport(['SUP'],identity,()=>{},{includeDependencies:false});assert.deepEqual(separate.report.errors,[]);assert.equal(separate.packs.size,1);assert.equal(separate.manifest.relationships.recommends[0].id,'synthetic-provider');assert.ok(separate.report.dependencyPlan[0].planned);
console.log('PASS Proxy/document serialization, casting skeletons without source mutation, qualified variant bases, random-charge lifecycle, prerequisite policies, minimal export closure and planned providers');

const table={type:'table',rows:[['Option A','{@filter A|spells|class=First;Second}','Intelligence'],['Option B','{@filter B|spells|class=Third}','Wisdom']]};assert.equal(castingOptions([table]).length,2);assert.deepEqual(castingOptions([table])[0].classes,['first','second']);
const campaign=compilePrerequisites({prerequisite:[{campaign:['Other']}]});assert.equal(evaluatePrerequisites(campaign,actor).qualified,false);const forged={id:'forged',items:[],flags:{bcc:{prerequisitePolicy:{campaigns:['Other']}}}};assert.equal(evaluatePrerequisites(campaign,forged).qualified,false);
// A cycle must be diagnosed, rather than publishing unresolvable module relationships.
const targets=storage.get('exportTargets');targets['world.bcc-base-actors'].requires=[identity.id];storage.set('exportTargets',targets);const cyclic=await validateExport(['SUP'],identity,()=>{},{includeDependencies:false});assert.deepEqual(cyclic.report.errors,[]);assert.equal(cyclic.packs.size,1);
console.log('PASS structural casting-option tables and separate-module dependency-cycle detection');
