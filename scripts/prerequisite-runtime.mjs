import {documentData} from "./document-data.mjs";
import {registerChargeRuntime} from "./charges.mjs";
import {registerCastingAdapter} from "./casting-profile.mjs";
import {evaluatePrerequisites,prerequisiteContext,prerequisiteSelectors,spellMatches} from "./prerequisites.mjs";
import {installBatchAdapter,installCommitAdapter,prerequisiteItems,retainedAcquisition} from "./transactions.mjs";
import {registerSpellGrantRuntime,reconcileSpellGrants} from "./spell-grants-runtime.mjs";
import {registerContainerRuntime} from "./containers-runtime.mjs";
const KEY=Symbol.for("bcc.prerequisites.runtime.v2"),BLOCK="bcc-prerequisite-unsatisfied";
const rows=items=>items?.contents??Array.from(items??[]);
const object=documentData;
const documents=new Map(),contexts=new WeakMap(),pendingForms=new WeakMap();
async function load(uuid){if(!String(uuid).startsWith("Compendium."))return null;if(!documents.has(uuid))documents.set(uuid,Promise.resolve(globalThis.fromUuid(uuid)).catch(()=>null));return documents.get(uuid);}
function optionRows(value,out=[],seen=new Set()){
  if(!value||typeof value!=="object"||seen.has(value))return out;seen.add(value);
  if(typeof value.uuid==="string")out.push(value);
  for(const child of Object.values(value))if(child&&typeof child==="object")optionRows(child,out,seen);
  return out;
}
function activeClass(actor){const state=Object.values(actor?.flags??{}).find(v=>v?.levelUpState)?.levelUpState;const cls=rows(actor?.items).find(i=>(i.id??i._id)===state?.selectedClassId);return cls?.system?.identifier??null;}
export async function projectedItems(actor,context={},form){
  const items=rows(actor?.items).map(object),options=optionRows(context),removed=new Set();
  if(form?.entries)for(const [name,value] of form.entries())if(/\.remove$/.test(name)&&value)removed.add(String(value));
  const result=items.filter(i=>!removed.has(i._id));
  if(form?.entries)for(const [name,value] of form.entries()){
    if(!value||!/\.(?:cantrips|spells)$|\.replace(?:Cantrip|Spell)\.add$|\.invocation\.\d+\.uuid$|\.replaceInvocation\.add$/.test(name))continue;
    const option=options.find(o=>o.uuid===String(value)||o.identifier===String(value));if(!option)continue;
    const source=await load(option.uuid);if(!source)continue;const item=object(source);
    // The source list is not the acquisition class. Record the selected class
    // on projected spells so multiclass checks do not guess their origin.
    if(item.type==="spell"){item.flags??={};item.flags.bcc??={};item.flags.bcc.classIdentifier=activeClass(actor);}
    if(!result.some(i=>i._id===item._id))result.push(item);
  }
  return result;
}
export async function checkSubmittedPrerequisites(actor,context,form){
  const items=await projectedItems(actor,context,form);
  for(const [name,value] of form.entries()){
    if(!/\.uuid$|\.replaceInvocation\.add$/.test(name)||!String(value).startsWith("Compendium."))continue;
    const doc=await load(String(value)),expression=doc?.flags?.bcc?.prerequisiteExpression;if(!expression)continue;
    const result=evaluatePrerequisites(expression,actor,{items:items.filter(i=>i._id!==(doc.id??doc._id))});
    if(!result.qualified)throw Error(`${doc.name}: ${result.reason}`);
    const selectors=prerequisiteSelectors(expression),targetName=name.replace(/\.uuid$/,".target").replace(/\.add$/,".target"),target=form.get(targetName);
    if(target&&selectors.length){const selected=items.find(i=>i.type==="spell"&&i.system?.identifier===target),ctx=prerequisiteContext(actor,{items});if(!selected||!selectors.some(s=>spellMatches(selected,s.filter,ctx)))throw Error(`${doc.name}: selected spell does not meet the source requirements`);}
  }
}
export async function decoratePrerequisiteContext(context,actor,form){
  const items=await projectedItems(actor,context,form);
  // Include only pending candidates the consumer marks as actually selected.
  for(const row of optionRows(context))if(row.checked||row.pendingSelected){const doc=await load(row.uuid);if(doc){const d=object(doc);if(d.type==="spell"){d.flags??={};d.flags.bcc??={};d.flags.bcc.classIdentifier=activeClass(actor);}if(!items.some(i=>i._id===d._id))items.push(d);}}
  for(const row of optionRows(context)){
    if(!("prerequisiteIdentifiers" in row)&&!row.bccPrerequisite)continue;
    const doc=await load(row.uuid),expression=doc?.flags?.bcc?.prerequisiteExpression;if(!expression||!("disabled" in row||"prerequisiteIdentifiers" in row))continue;
    const result=evaluatePrerequisites(expression,actor,{items});
    row.bccPrerequisite=expression;row.prerequisiteQualified=result.qualified;
    row.prerequisiteIdentifiers=result.qualified?[]:[BLOCK];row.prerequisiteIdentifiersString=row.prerequisiteIdentifiers.join("|");
    if(!result.qualified){row.disabled=true;row.disabledReason=result.reason;row.prerequisiteLabelsString=result.reason.replace(/^Requires /,"");}
  }
  contexts.set(actor,context);return context;
}
/** Optional consumer adapter; no Character Builder source is copied or modified. */
export function installConsumerAdapter(service){
  if(service[KEY])return;service[KEY]=true;
  const build=service.buildContext,apply=service.apply;
  service.buildContext=async function(source,actor,...args){await reconcileSpellGrants(actor);return decoratePrerequisiteContext(await build.call(this,source,actor,...args),actor,pendingForms.get(actor));};
  service.apply=async function(source,actor,registry,form,...args){pendingForms.set(actor,form);try{const context=await this.buildContext(source,actor,registry);await checkSubmittedPrerequisites(actor,context,form);return await apply.call(this,source,actor,registry,form,...args);}finally{pendingForms.delete(actor);}};
}
export async function decorateApplication(app){
  const actor=app.draft??app.actor,root=app.element;if(!actor||!root?.querySelectorAll)return;
  const update=async()=>{
    const context=contexts.get(actor)??{},formElement=root.matches?.("form")?root:root.querySelector("form"),form=new FormData();
    // Read only successful controls; unselected catalog candidates never count.
    for(const input of (formElement??root).querySelectorAll("input[name], select[name]")){if(input.disabled||input.type==="checkbox"&&!input.checked||input.type==="radio"&&!input.checked)continue;if(input.value)form.append(input.name,input.value);}
    const items=await projectedItems(actor,context,form);
    for(const option of root.querySelectorAll("select option[value]")){
      if(!option.value.startsWith("Compendium."))continue;
      const doc=await load(option.value),expression=doc?.flags?.bcc?.prerequisiteExpression;if(!expression)continue;
      const result=evaluatePrerequisites(expression,actor,{items});
      if(!option.dataset.bccOriginalLabel)option.dataset.bccOriginalLabel=doc.name;
      const old=option.dataset.prerequisites??"";
      if(old===BLOCK||old===""||!result.qualified){option.dataset.prerequisites=result.qualified?"":BLOCK;option.dataset.prerequisiteLabels=result.qualified?"":result.reason.replace(/^Requires /,"");}
      const duplicate=[...root.querySelectorAll("select")].some(s=>s!==option.closest("select")&&s.value===option.value);
      const blockedElsewhere=(option.dataset.alreadyKnown==="true"||duplicate)&&option.dataset.repeatable!=="true";
      if(!result.qualified){option.disabled=true;option.textContent=`${option.dataset.bccOriginalLabel} — ${result.reason}`;}
      else if(!blockedElsewhere){option.disabled=false;option.textContent=option.dataset.bccOriginalLabel;}
    }
  };
  if(!root.dataset.bccPrerequisiteListener){root.dataset.bccPrerequisiteListener="true";let pending;root.addEventListener("change",()=>{clearTimeout(pending);pending=setTimeout(()=>update().catch(e=>console.error("BCC | Prerequisite UI",e)),0);});}
  await update();
}
export function registerPrerequisiteRuntime(){
  if(!globalThis[Symbol.for('bcc.prerequisites.policy.v1')]){
    globalThis[Symbol.for('bcc.prerequisites.policy.v1')]=true;
    game.settings?.register?.('world','bccPrerequisitePolicy',{name:'BCC · Política de campanha',hint:'JSON definido pelo GM. Exemplo: {"campaigns":["nome da campanha"]}. Renome individual deve ser aprovado pelo GM na política de qualificação do personagem.',scope:'world',config:true,type:String,default:'{}'});
    game.settings?.register?.('world','bccActorPrerequisitePolicies',{scope:'world',config:false,type:Object,default:{}});
    globalThis.game.bccRuntime??={};game.bccRuntime.setPrerequisitePolicy=async(actor,policy)=>{if(!game.user?.isGM)throw Error('GM required');const key=actor?.uuid??(actor?.id?`Actor.${actor.id}`:null);if(!key)throw Error('Persistent Actor required');const policies=game.settings.get('world','bccActorPrerequisitePolicies')??{};return game.settings.set('world','bccActorPrerequisitePolicies',{...policies,[key]:documentData(policy)});};
  }
  registerContainerRuntime();registerSpellGrantRuntime();registerChargeRuntime();
  installBatchAdapter(globalThis.CONFIG?.Actor?.documentClass??globalThis.Actor?.implementation);
  if(globalThis[KEY])return;globalThis[KEY]=true;
  for(const event of ["createItem","updateItem","deleteItem"])Hooks.on(event,document=>{if(document.pack)documents.delete(document.uuid);});
  Hooks.on("preCreateItem",(document,data,options)=>{
    const actor=document.parent??document.actor,expression=data.flags?.bcc?.prerequisiteExpression;
    if(!actor||actor.type!=="character"||actor.pack||!expression||options?.bccSkipPrerequisites)return;
    const projected=prerequisiteItems(actor,options);
    if(projected&&(options?.characterBuilderLevelUpRollback||options?.characterBuilderRollback)||retainedAcquisition(actor,data))return;
    const result=evaluatePrerequisites(expression,actor,projected?{items:projected.filter(i=>(i._id??i.id)!==data._id)}:{});if(result.qualified)return;
    ui.notifications.warn(`${data.name}: ${result.reason}`);return false;
  });
  Hooks.on("renderApplicationV2",app=>{decorateApplication(app).catch(e=>console.error("BCC | Prerequisite UI",e));});
  const connect=async()=>{
    const stale=[...(game.modules?.values?.()??[])].filter(m=>m.active&&m.flags?.bcc?.exportVersion&&m.flags.bcc.runtimeVersion!=='0.1.2');
    if(stale.length&&game.user?.isGM)ui.notifications.warn(`BCC: gere novamente os módulos exportados antigos antes de testar personagens: ${stale.map(m=>m.id).join(', ')}`);
    if(!game.modules?.get("dnd5e-character-builder")?.active)return;
    try{const path=foundry.utils.getRoute?.("modules/dnd5e-character-builder/scripts/services/level-up-rules-service.mjs")??"modules/dnd5e-character-builder/scripts/services/level-up-rules-service.mjs";const {LevelUpRulesService}=await import(new URL(path,globalThis.location.href).href);await registerCastingAdapter(path);if(typeof LevelUpRulesService?.buildContext==="function"&&typeof LevelUpRulesService?.apply==="function")installConsumerAdapter(LevelUpRulesService);
      const commitPath=path.replace("level-up-rules-service.mjs","level-up-commit-service.mjs"),{LevelUpCommitService}=await import(new URL(commitPath,globalThis.location.href).href);
      if(typeof LevelUpCommitService?.commit==="function")installCommitAdapter(LevelUpCommitService,reconcileSpellGrants);
      const {ActorCommitService}=await import(new URL(path.replace("level-up-rules-service.mjs","actor-commit-service.mjs"),globalThis.location.href).href);
      if(typeof ActorCommitService?.commit==="function")installCommitAdapter(ActorCommitService,reconcileSpellGrants);
    }catch(error){console.error("BCC | Consumer prerequisite adapter unavailable",error);ui.notifications.warn("BCC: não foi possível conectar o avaliador de pré-requisitos ao Character Builder. Consulte o console.");}
  };
  if(game.ready)void connect();else Hooks.once("ready",connect);
}
