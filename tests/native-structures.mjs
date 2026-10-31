import assert from "node:assert/strict";
import {createHash,randomBytes} from "node:crypto";
import {sha256Fallback,stableId} from "../scripts/hash.mjs";
import {materializeBundles,applyBundleData} from "../scripts/bundles.mjs";
import {splitContainerInstances} from "../scripts/containers-runtime.mjs";
import {compilePrerequisites,evaluatePrerequisites} from "../scripts/prerequisites.mjs";
import {installConsumerAdapter} from "../scripts/prerequisite-runtime.mjs";

for(const size of [0,1,55,56,63,64,65,1024,50000]){const bytes=randomBytes(size);assert.equal(Buffer.from(sha256Fallback(bytes)).toString("hex"),createHash("sha256").update(bytes).digest("hex"));}
assert.equal(await stableId("stable document"),createHash("sha256").update("stable document").digest("hex").slice(0,16));

const source={name:"Synthetic Gift",source:"TEST",prerequisite:[{level:{level:2,class:{name:"Channeler"}},spell:[{choose:"level=0|class=Channeler",entry:"a cantrip that deals damage"}]}],entries:["{@filter eligible spells|spells|level=0|class=Channeler|damage type=fire|spell attack=r|range=point}"]};
const expression=compilePrerequisites(source),cls={_id:"class00000000001",name:"Channeler",type:"class",system:{identifier:"channeler",levels:2}},spell={_id:"spell00000000001",name:"Synthetic Spark",type:"spell",system:{identifier:"synthetic-spark",level:0},flags:{bcc:{classIdentifier:"channeler",spellMetadata:{level:0,damageInflict:["fire"],spellAttack:["R"],range:{type:"point"},classes:["channeler"]}}}};
const actor={type:"character",system:{details:{level:2},abilities:{str:{value:10}}},items:[cls,spell],flags:{consumer:{levelUpState:{selectedClassId:cls._id,targetClassLevel:2}}}};
assert.equal(evaluatePrerequisites(expression,actor).qualified,true);
for(const mutation of [s=>s.flags.bcc.classIdentifier="other-class",s=>s.flags.bcc.spellMetadata.damageInflict=[],s=>s.flags.bcc.spellMetadata.spellAttack=[],s=>s.flags.bcc.spellMetadata.level=1]){const copy=structuredClone(spell);mutation(copy);assert.equal(evaluatePrerequisites(expression,{...actor,items:[cls,copy]}).qualified,false);}
assert.equal(evaluatePrerequisites(expression,{...actor,items:[cls]}).qualified,false);
const renamed=structuredClone(source);renamed.name="Different Name";renamed.source="OTHER";assert.deepEqual(compilePrerequisites(renamed),expression);
assert.equal(evaluatePrerequisites(compilePrerequisites({prerequisite:[{unknownCondition:true}]}),actor).unsupported,true);
const alternate=compilePrerequisites({prerequisite:[{ability:[{str:13}],spell:["synthetic spark#c"]},{feat:["Synthetic Alternative"]}]});
assert.equal(evaluatePrerequisites(alternate,actor).qualified,false);assert.equal(evaluatePrerequisites(alternate,{...actor,items:[...actor.items,{type:"feat",system:{identifier:"synthetic-alternative"}}]}).qualified,true);

const entry=(name,record={})=>({kind:"item",key:name,_id:name.padEnd(16,"0"),packId:"world.synthetic",uuid:`Compendium.world.synthetic.Item.${name.padEnd(16,"0")}`,record:{name,source:"TEST",...record}});
const a=entry("KitA",{weight:4,packContents:["Box",{item:"Bolt",quantity:10},{special:"Literal component"}]}),b=entry("KitB",{packContents:["Box","Bolt"]}),box=entry("Box",{type:"C",weight:1}),bolt=entry("Bolt",{weight:.1});
const index={all:[a,b,box,bolt],byKey:new Map()},lookup=(_,kind,name)=>[a,b,box,bolt].find(e=>e.record.name===name);
await materializeBundles(index,lookup);assert.deepEqual(index.bundleIssues,[]);const ac=index.all.filter(e=>e.record._bccBundleInstance?.parentId===a._id),bc=index.all.filter(e=>e.record._bccBundleInstance?.parentId===b._id);assert.equal(ac.length,3);assert.equal(ac.find(e=>e.record.name==="Bolt").record._bccBundleInstance.quantity,10);assert.ok(ac.every(e=>bc.every(o=>o._id!==e._id)));assert.equal(box.record._bccBundleInstance,undefined);
const system={},flags={},report={unresolved:new Set(),incomplete:new Set(),information:new Set()};applyBundleData(a.record,system,flags,report,index);assert.equal(system.weight.value,2);assert.equal(flags.bundle.declaredWeight,4);
let next=0;const split=splitContainerInstances([{_id:"root",type:"container",name:"Kit",flags:{bcc:{}},system:{quantity:2}},{_id:"bag",type:"container",system:{container:"root",quantity:1}},{_id:"child",type:"loot",system:{container:"bag",quantity:10}}],()=>String(++next).padStart(16,"0"));assert.equal(split.length,6);assert.equal(split[4].system.container,split[3]._id);assert.equal(split[5].system.container,split[4]._id);assert.equal(split[5].system.quantity,10);

const featureUuid="Compendium.synthetic.feats.Item.1111111111111111",spellUuid="Compendium.synthetic.spells.Item.2222222222222222",feature={_id:"feature000000001",name:"Synthetic Gift",type:"feat",flags:{bcc:{prerequisiteExpression:expression}}};
globalThis.fromUuid=async uuid=>uuid===featureUuid?feature:uuid===spellUuid?spell:null;
const context=()=>({invocations:{options:[{uuid:featureUuid,disabled:false,prerequisiteIdentifiers:[]}]},cantripGroups:[{items:[{uuid:spellUuid,identifier:"synthetic-spark"}]}]});let commits=0;
class Consumer{static async buildContext(){return context();}static async apply(source,actor,registry,form){assert.equal((await this.buildContext(source,actor,registry)).invocations.options[0].disabled,false);commits++;return true;}}
installConsumerAdapter(Consumer);const empty={...actor,items:[cls]};assert.equal((await Consumer.buildContext(null,empty,{})).invocations.options[0].disabled,true);
const valid=new FormData();valid.append("levelUp.cantrips","synthetic-spark");valid.append("levelUp.invocation.0.uuid",featureUuid);valid.append("levelUp.invocation.0.target","synthetic-spark");assert.equal(await Consumer.apply(null,empty,{},valid),true);
const invalid=new FormData();invalid.append("levelUp.invocation.0.uuid",featureUuid);await assert.rejects(()=>Consumer.apply(null,empty,{},invalid));assert.equal(commits,1);
console.log("PASS SHA-256 parity, data-driven prerequisite selectors/logic, independent containers and projected consumer validation");
