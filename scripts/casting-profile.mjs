import {parseSpellFilter} from './spell-filter.mjs';
export function castingOptions(entries){
  const out=[],abilities={strength:'str',dexterity:'dex',constitution:'con',intelligence:'int',wisdom:'wis',charisma:'cha'};
  function walk(v){if(Array.isArray(v)){v.forEach(walk);return;}if(!v||typeof v!=='object')return;
    if(v.type==='table')for(const row of v.rows??[]){if(!Array.isArray(row))continue;const filter=row.map(String).map(cell=>/\{@filter [^|}]+\|spells\|([^}]+)\}/.exec(cell)?.[1]).find(Boolean),ability=row.map(cell=>abilities[String(cell).toLowerCase()]).find(Boolean);const parsed=filter&&parseSpellFilter(filter);if(parsed?.classes?.length&&ability)out.push({label:String(row[0]),filter,classes:parsed.classes,ability});}
    Object.values(v).forEach(walk);
  }walk(entries);return [...new Map(out.map(o=>[JSON.stringify(o),o])).values()];
}
/** Source progression tokens describe algorithms, never class-name exceptions. */
export function castingProfile(record) {
  const source=record.casterProgression,rate=({full:[1,false,'spell'],'1/2':[2,false,'spell'],'1/3':[3,false,'spell'],artificer:[2,true,'spell'],pact:[1,false,'pact']})[source];
  if(!rate)return source?{version:1,unsupported:source}:null;
  const table=(record.classTableGroups??[]).find(g=>Array.isArray(g.rowsSpellProgression));
  const columns=table?.colLabels?.map(label=>Number(/\|level=(\d+)(?:\||\})/.exec(String(label))?.[1]??0));
  const slotLevels=table?.rowsSpellProgression?.map(row=>Math.max(0,...row.map((slots,i)=>Number(slots)>0?columns?.[i]??0:0)));
  const fixed=record.spellsKnownProgressionFixed;
  const access=Array.isArray(fixed)?'spellbook':record.preparedSpellsChange==='restLong'||record.preparedSpells?'fullList':record.preparedSpellsProgression||record.spellsKnownProgression?'limited':null;
  return {version:1,divisor:rate[0],roundUp:rate[1],method:rate[2],access,change:record.preparedSpellsChange??null,fixed:fixed??null,sourceProgression:source,slotLevels:slotLevels??null,options:record._bccCastingOptions??[]};
}
export function consumerProgression(profile) {
  if(!profile||profile.unsupported)throw Error(`BCC: unsupported casting progression ${profile?.unsupported??'missing profile'}`);
  if(profile.method==='pact')return 'pact';
  const label=({1:'full',2:'half',3:'third'})[profile.divisor];
  if(!label)throw Error(`BCC: no consumer casting algorithm for divisor ${profile.divisor}`);
  return label;
}
const KEY=Symbol.for('bcc.casting.consumer.v1'),VIEW=Symbol.for('bcc.casting.view.v1'),STATE=Symbol.for('bcc.casting.queue.v1');
const state=globalThis[STATE]??={tail:Promise.resolve()};
const itemsOf=actor=>actor.items?.contents??Array.from(actor.items??[]);
/** Consumer-only view: native Actor/Class sources and slot arithmetic stay intact. */
export function castingView(actor) {
  if(actor?.[VIEW])return actor;
  const docs=itemsOf(actor),profiles=docs.filter(d=>d.type==='class'&&d.flags?.bcc?.castingProfile);
  if(!profiles.length)return actor;
  const map=new Map(profiles.map(d=>{
    const p=d.flags.bcc.castingProfile,roles=docs.filter(i=>i.flags?.bcc?.castingRole?.classIdentifier===d.system.identifier),role=roles[0]?.flags.bcc.castingRole;
    if(p.options?.length&&(!role||roles.length!==1))throw Error(`BCC: ${d.name}: select exactly one source-defined spellcasting option in Class Progression`);
    const system={...d.system,spellcasting:{...d.system.spellcasting,...(role?{ability:role.ability}:{}),progression:(p.slotLevels?p.slotLevels[Number(d.system.levels??1)-1]===0:Number(d.system.levels??1)<p.divisor&&!p.roundUp&&p.method!=="pact")?"none":consumerProgression(p)}};
    const view=new Proxy({}, {get(_target,k){const t=d;if(k==='system')return system;if(k==='toObject')return ()=>({...t.toObject(true),system:{...t.toObject(true).system,spellcasting:{...system.spellcasting}}});const v=Reflect.get(t,k,t);return typeof v==='function'?v.bind(t):v;}});
    return [d,view];
  }));
  const all=()=>itemsOf(actor).map(d=>map.get(d)??d),items=new Proxy({}, {get(_target,k){const t=actor.items;if(k==='contents')return all();if(k===Symbol.iterator||k==='values')return ()=>all().values();if(['find','filter','map','some','every','reduce','forEach'].includes(k))return (...args)=>all()[k](...args);if(k==='get')return id=>all().find(d=>(d.id??d._id)===id);const v=Reflect.get(t,k,t);return typeof v==='function'?v.bind(t):v;}});
  return new Proxy({}, {get(_target,k){const t=actor;if(k===VIEW)return true;if(k==='items')return items;const v=Reflect.get(t,k,t);return typeof v==='function'?v.bind(t):v;}});
}
export function installCastingService(service,models,draftIndex,methods) {
  if(service[KEY])return;service[KEY]=true;
  for(const method of methods){const original=service[method];if(typeof original!=='function')continue;
    service[method]=async function(...args){
      const draft=args[draftIndex];if(draft?.[VIEW])return original.apply(this,args);
      const projected=castingView(draft),view=projected===draft?new Proxy({}, {get(_t,k){if(k===VIEW)return true;const value=Reflect.get(draft,k,draft);return typeof value==='function'?value.bind(draft):value;}}):projected;
      const run=async()=>{
        const restored=[];let restoreRegistry;
        try {
          for(const cls of itemsOf(draft).filter(d=>d.type==='class'&&d.flags?.bcc?.castingProfile)){
            const p=cls.flags.bcc.castingProfile,id=cls.system.identifier;
            if(!p.access)throw Error(`BCC: ${cls.name}: source does not define a spell-access model`);
            for(const [kind,set]of Object.entries(models)){restored.push([set,id,set.has(id)]);set.delete(id);if(kind===p.access)set.add(id);}
          }
          const registry=globalThis.dnd5e?.registry?.spellLists;
          if(registry){const originalFor=registry.forType;registry.forType=function(type,id){const list=originalFor.call(this,type,id),role=itemsOf(draft).map(i=>i.flags?.bcc?.castingRole).find(r=>r?.classIdentifier===id);if(type!=='class'||!role||!list)return list;return new Proxy({}, {get(_t,k){if(k==='indexes')return list.indexes.filter(d=>role.identifiers.includes(d.system?.identifier));const value=Reflect.get(list,k,list);return typeof value==='function'?value.bind(list):value;}});};restoreRegistry=()=>registry.forType=originalFor;}
          for(const cls of itemsOf(draft).filter(d=>d.type==='class'&&d.flags?.bcc?.castingProfile?.options?.length)){const role=itemsOf(draft).find(i=>i.flags?.bcc?.castingRole?.classIdentifier===cls.system.identifier)?.flags.bcc.castingRole;if(role&&cls.system.spellcasting.ability!==role.ability&&typeof cls.update==='function')await cls.update({'system.spellcasting.ability':role.ability});}
          const levelState=Object.values(draft.flags??{}).find(v=>v?.levelUpState)?.levelUpState,selected=levelState?.selectedClassId;
          const clsForList=view.items.find(d=>d.type==='class'&&(!selected||(d.id??d._id)===selected));
          if(clsForList?.flags?.bcc?.castingProfile&&clsForList.system.spellcasting.progression!=='none'&&registry){
            for(let attempt=0;attempt<20&&registry.ready===false;attempt++)await new Promise(resolve=>setTimeout(resolve,50));
            const list=registry.forType('class',clsForList.system.identifier);
            if(!list?.indexes?.length)throw Error(`BCC: ${clsForList.name}: the source-defined class spell list is empty or unavailable; check the supplying compendium and selected casting option`);
          }
          args[draftIndex]=view;const result=await original.apply(this,args);
          const cls=itemsOf(draft).find(d=>d.type==='class'&&d.system.identifier===result?.classIdentifier),p=cls?.flags?.bcc?.castingProfile;
          if(p?.access==='spellbook'&&p.fixed&&result&&'spellCount' in result){
            const old=result.spellCount,count=Number(p.fixed[Number(result.newClassLevel??result.classLevel??cls.system.levels??1)-1]??0);result.spellCount=count;
            if('needsSpellChoice' in result)result.needsSpellChoice=count>0;
            if('requiredSpellSelections' in result){result.requiredSpellSelections+=count-old;result.spellSelectionComplete=!result.spellListIssue&&result.selectedSpellSelections===result.requiredSpellSelections&&!result.duplicateSelectionCount&&result.features?.complete!==false&&result.metamagic?.complete!==false&&(!result.pactOfTheTome?.visible||result.pactOfTheTome.complete)&&Boolean(result.replacement?.removeId)===Boolean(result.replacement?.addIdentifier)&&Boolean(result.cantripReplacement?.removeId)===Boolean(result.cantripReplacement?.addIdentifier);result.hasChoices=Boolean(result.spellListIssue)||result.cantripCount>0||count>0||result.savant?.count>0||result.invocations?.count>0||result.replacement?.available||result.cantripReplacement?.available||result.invocations?.replacement?.available||result.features?.hasChoices||result.pactOfTheTome?.visible||result.metamagic?.active;result.noAdditionalWork=!result.hasChoices&&!result.hasAutomatic;}
            result.note=`${cls.name}: choose ${count} source-defined spellbook spell(s).`;
          }
          return result;
        } finally {restoreRegistry?.();for(const [set,id,had]of restored.reverse()){set.delete(id);if(had)set.add(id);}}
      };
      const promise=state.tail.then(run,run);state.tail=promise.catch(()=>{});return promise;
    };
  }
}
export async function registerCastingAdapter(basePath) {
  const {SPELL_ACCESS_MODELS}=await import(new URL(basePath.replace(/services\/[^/]+$/,'constants.mjs'),globalThis.location.href).href);
  const {SpellAccessService}=await import(new URL(basePath.replace(/[^/]+$/,'spell-access-service.mjs'),globalThis.location.href).href);
  const {LevelUpRulesService}=await import(new URL(basePath.replace(/[^/]+$/,'level-up-rules-service.mjs'),globalThis.location.href).href);
  installCastingService(SpellAccessService,SPELL_ACCESS_MODELS,0,['buildContext','save']);
  installCastingService(LevelUpRulesService,SPELL_ACCESS_MODELS,1,['buildContext','apply']);
}
