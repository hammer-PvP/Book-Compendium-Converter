import {documentData} from './document-data.mjs';
/** Optional rest replacements preserve native advancement ownership. */
const KEY=Symbol.for('bcc.featureRest.v1'),running=new WeakSet(),raw=documentData;
const rows=v=>v?.contents??Array.from(v?.values?.()??v??[]);
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
function allowed(actor){return actor?.type==='character'&&!actor.pack&&actor.isOwner&&!Object.values(actor.flags??{}).some(f=>f?.commitSafetyLock||f?.isDraft);}
function chosenAdvancement(actor,feature,rule){
  const remembered=feature.flags?.bcc?.restSpellState;
  if(remembered){const spell=actor.items.get(remembered.itemId),owner=actor.items.get(remembered.ownerId),adv=raw(owner??{}).system?.advancement?.[remembered.advancementId];if(spell&&adv?.value?.added?.[spell.id])return {spell,owner,key:remembered.advancementId,adv};}
  const found=[];
  for(const owner of rows(actor.items))for(const [key,adv]of Object.entries(raw(owner).system?.advancement??{})){
    if(adv.type!=='ItemGrant'||!(adv.configuration?.items??[]).some(i=>i.uuid===rule.initialUuid))continue;
    if(feature.system?.type?.value==='race'&&(owner.type!=='race'||owner.name!==feature.system.requirements))continue;
    if(feature.type==='feat'&&feature.system?.type?.value!=='race'&&owner.id!==feature.id)continue;
    for(const [id,uuid]of Object.entries(adv.value?.added??{}))if(uuid===rule.initialUuid){const spell=actor.items.get(id);if(spell)found.push({spell,owner,key,adv});}
  }
  if(found.length!==1)throw Error(`${feature.name}: não foi possível identificar uma única magia concedida por este recurso. Confira o Advancement de origem.`);return found[0];
}
async function choose(title,options){
  if(!options.length)throw Error(`${title}: nenhuma opção disponível nos livros ativos.`);
  return foundry.applications.api.DialogV2.prompt({window:{title},content:`<p>Escolha a substituição opcional deste descanso.</p><select name="replacement">${options.map(o=>`<option value="${escape(o.value)}">${escape(o.label)}</option>`).join('')}</select>`,ok:{label:'Substituir',callback:(_event,button)=>button.form.elements.replacement.value},rejectClose:false});
}
export function assertRestReplacementReady(feature,type){
  const actor=feature.actor??feature.parent;if(!allowed(actor))throw Error('Esta substituição exige um personagem sob seu controle, fora do fluxo de criação ou level-up.');
  const ready=feature.flags?.bcc?.restReplacementReady;if(!ready?.[type]||ready.actorId!==(actor.uuid??actor.id))throw Error(`${feature.name}: conclua um Long Rest antes de substituir esta escolha.`);return actor;
}
export async function replaceRestSpell(feature,uuid){
  const actor=assertRestReplacementReady(feature,'spell'),rules=feature.flags.bcc.restSpells;
  if(rules?.length!==1)throw Error(`${feature.name}: substituições múltiplas exigem revisão.`);
  const rule=rules[0];if(!rule.pool.some(o=>o.uuid===uuid))throw Error('Magia fora da lista permitida.');
  const current=chosenAdvancement(actor,feature,rule),old=raw(current.spell),origin=`${current.owner.id}.${current.key}`;
  if(old.flags?.dnd5e?.advancementOrigin!==origin)throw Error('A magia tem uma origem independente; a substituição automática foi impedida.');
  if(old.flags?.['dnd5e-character-builder']?.featureSpellOwners?.length>1)throw Error('A magia possui múltiplas concessões; revise sua propriedade antes de substituir.');
  const source=await fromUuid(uuid);if(!source||source.type!=='spell'||Number(source.system.level)!==0)throw Error('O cantrip não está disponível. Instale e ative o livro fornecedor.');
  if(rows(actor.items).some(i=>i.id!==current.spell.id&&i.type==='spell'&&i.system.identifier===source.system.identifier))throw Error('Este personagem já conhece essa magia por outra origem.');
  // Keep the embedded ID and ability; no delete/create gap or second grant.
  const next=raw(source);next._id=current.spell.id;next.system.ability=old.system.ability;next.system.method=old.system.method;next.system.prepared=old.system.prepared;
  next.flags={...next.flags,dnd5e:old.flags.dnd5e,'dnd5e-character-builder':old.flags?.['dnd5e-character-builder']};
  next.flags.bcc={...next.flags.bcc,...Object.fromEntries(['classIdentifier','conditionalSpellOwner'].filter(k=>old.flags?.bcc?.[k]!=null).map(k=>[k,old.flags.bcc[k]]))};
  if(old.flags?.core)next.flags.core={...old.flags.core,sourceId:uuid};next._stats={...old._stats,compendiumSource:uuid};
  const added={...current.adv.value.added,[current.spell.id]:uuid},ownerBefore=raw(current.owner),featureBefore=raw(feature);
  try{
    await current.spell.update(next,{diff:false,recursive:false,bccRestReplacement:true});
    const items=current.adv.configuration.items.map(i=>i.uuid===current.adv.value.added[current.spell.id]?{...i,uuid}:i);
    await current.owner.update({[`system.advancement.${current.key}.value.added`]:added,[`system.advancement.${current.key}.configuration.items`]:items});
    await feature.update({'flags.bcc.restSpellState':{itemId:current.spell.id,ownerId:current.owner.id,advancementId:current.key},'flags.bcc.restReplacementReady.spell':false});
  }catch(error){try{await current.spell.update(old,{diff:false,recursive:false});await current.owner.update({'system.advancement':ownerBefore.system.advancement});await feature.update({'flags.bcc':featureBefore.flags.bcc});}catch(restore){throw new Error(`${feature.name}: falha ao restaurar a substituição; confira o personagem.`,{cause:restore});}throw error;}
  return current.spell;
}
export async function replaceRestTrait(feature,key){
  const actor=assertRestReplacementReady(feature,'trait'),entries=Object.entries(raw(feature).system?.advancement??{}).filter(([,a])=>a.type==='Trait'&&a.flags?.bcc?.restReplacement==='lr');
  if(entries.length!==1)throw Error(`${feature.name}: seleção de proficiência ambígua.`);
  const [id,data]=entries[0],previous=rows(data.value?.chosen);if(previous.length!==1)throw Error(`${feature.name}: conclua a escolha inicial de proficiência.`);
  const [oldKey]=previous;if(key===oldKey)return;
  if(!data.configuration.choices.some(c=>c.pool.some(p=>p===key||p.endsWith(':*')&&key.startsWith(p.slice(0,-1)))))throw Error('Proficiência fora da escolha permitida.');
  for(const owner of rows(actor.items))for(const a of Object.values(raw(owner).system?.advancement??{}))if(!(owner.id===feature.id&&a._id===id)&&a.type==='Trait'&&[...rows(a.value?.chosen),...rows(a.configuration?.grants)].includes(oldKey))throw Error('A proficiência anterior também é concedida por outro recurso; revisão manual necessária.');
  const clone=actor.clone(),native=clone.items.get(feature.id)?.advancement?.byId?.[id];if(!native)throw Error('Advancement nativo de proficiência indisponível.');
  const available=await native.actorSelected();if(!available.available.has(key))throw Error('A proficiência escolhida já está concedida ou não é válida.');
  const section=oldKey.startsWith('skills:')?'skills':'tools',oldId=oldKey.split(':').at(-1);if(Number(actor.system[section]?.[oldId]?.value)!==1)throw Error('A proficiência anterior está ausente ou tem expertise; revisão manual necessária.');
  await native.reverse(0,{key:oldKey});await native.apply(0,{chosen:[key]});
  const before=raw(actor),featureBefore=raw(feature),updated=raw(clone);
  try{await actor.update({'system.skills':updated.system.skills,'system.tools':updated.system.tools});await feature.update({[`system.advancement.${id}.value.chosen`]:[key],'flags.bcc.restReplacementReady.trait':false});}
  catch(error){await actor.update({'system.skills':before.system.skills,'system.tools':before.system.tools});await feature.update({'system.advancement':featureBefore.system.advancement,'flags.bcc':featureBefore.flags.bcc});throw error;}
}
export async function offerRestReplacement(feature,type){
  const actor=assertRestReplacementReady(feature,type);if(running.has(actor))throw Error('Outra substituição deste personagem está em andamento.');running.add(actor);
  try{
    if(type==='spell'){const options=[];for(const ref of feature.flags.bcc.restSpells?.[0]?.pool??[]){const d=await fromUuid(ref.uuid);if(d)options.push({value:ref.uuid,label:d.name});}const selection=await choose(feature.name,options);if(selection)await replaceRestSpell(feature,selection);}
    else{const adv=Object.values(feature.advancement?.byId??{}).find(a=>a.type==='Trait'&&a.flags?.bcc?.restReplacement),state=await adv?.actorSelected(),options=[];
      for(const key of state?.available??[]){if(!adv.configuration.choices.some(c=>rows(c.pool).some(p=>p===key||p.endsWith(':*')&&key.startsWith(p.slice(0,-1)))))continue;const [kind,...parts]=key.split(':'),id=parts.at(-1),meta=(kind==='skills'?CONFIG.DND5E.skills:CONFIG.DND5E.tools)?.[id];options.push({value:key,label:game.i18n.localize(meta?.label??meta??id)});}
      const selection=await choose(feature.name,options);if(selection)await replaceRestTrait(feature,selection);
    }
  }finally{running.delete(actor);}
}
export function registerFeatureRuntime(){
  if(globalThis[KEY])return;globalThis[KEY]=true;
  Hooks.on('dnd5e.restCompleted',(actor,result,config)=>{
    if(!allowed(actor)||!(result.longRest||config.type==='long'))return;const updates=[];
    for(const item of rows(actor.items)){const spell=!!item.flags?.bcc?.restSpells?.length,trait=Object.values(raw(item).system?.advancement??{}).some(a=>a.flags?.bcc?.restReplacement==='lr');if(spell||trait)updates.push({_id:item.id,'flags.bcc.restReplacementReady':{spell,trait,actorId:actor.uuid??actor.id}});}
    if(updates.length)void actor.updateEmbeddedDocuments('Item',updates).then(()=>ui.notifications.info(`${actor.name}: substituições opcionais disponíveis nas Activities dos recursos após o Long Rest.`)).catch(e=>ui.notifications.error(e.message));
  });
  Hooks.on('dnd5e.preUseActivity',activity=>{const type=activity.flags?.bcc?.restReplacement;if(!type)return;void offerRestReplacement(activity.item,type).catch(e=>ui.notifications.warn(e.message));return false;});
  game.bccRuntime??={};Object.assign(game.bccRuntime,{replaceRestSpell,replaceRestTrait});
}
