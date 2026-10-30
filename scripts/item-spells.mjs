/** Interpret structured item spell recipes without executing or copying importer code. */
export function attachedSpellRecipes(record,report) {
  const source=record.attachedSpells,result=[];
  const issue=message=>report?.incomplete.add(`${record.name}: ${message}`);
  const append=(values,context)=>{
    if(!Array.isArray(values)){issue("unsupported item spell recipe");return;}
    for(const uid of values)if(typeof uid==="string")result.push({uid,...context});
    else issue("non-UID item spell selection requires review");
  };
  if(Array.isArray(source)){append(source,{manual:true});issue("legacy item spell list has no structured consumption; review spell use requirements");return result;}
  for(const [mode,value] of Object.entries(source??{})) {
    if(["ability","resourceName"].includes(mode))continue;
    if(["will","ritual","other"].includes(mode)){append(value,{mode,manual:mode==="other"});if(mode==="other")issue("conditional item spell usage retained for manual review");continue;}
    if(["daily","rest","limited","charges"].includes(mode)) {
      for(const [key,values] of Object.entries(value??{})){
        const count=Number.parseInt(key),shared=!key.endsWith("e")&&(values?.length??0)>1;
        if(!Number.isFinite(count)){issue(`unsupported item spell count ${key}`);continue;}
        append(values,{mode,count,shared});
        if(mode!=="charges"&&shared)issue(`shared ${mode} spell pool ${key} needs manual use tracking`);
      }
    }else issue(`unsupported item spell mode ${mode}`);
  }
  return result;
}
export function addItemSpellActivities(record,system,index,lookup,report) {
  const specs=attachedSpellRecipes(record,report);let sequence=0;
  for(const spec of specs) {
    const ref=lookup(index,"spell",spec.uid,record.source);
    if(!ref){report.unresolved.add(`${record.name}: attached spell ${spec.uid}`);continue;}
    if(Object.values(system.activities??{}).some(a=>a.type==="cast"&&a.spell?.uuid===ref.uuid))continue;
    const _id=`bccCast${String(++sequence).padStart(9,"0")}`,level=Number(/#(\d+)$/.exec(spec.uid)?.[1]??ref.record.level??0);
    const activity={_id,type:"cast",name:ref.record.name,spell:{uuid:ref.uuid,level,spellbook:false,...typeof record.attachedSpells?.ability==="string"?{ability:record.attachedSpells.ability}:{}},consumption:{spellSlot:false,targets:[]}};
    if(spec.mode==="charges") {
      if(system.uses?.max)activity.consumption.targets=[{type:"itemUses",value:String(spec.count)}];
      else report.incomplete.add(`${record.name}: item spell charges have no maximum; consumption needs review`);
    }else if(spec.count&&!spec.shared){
      activity.uses={max:String(spec.count),spent:0,recovery:spec.mode==="limited"?[]:[{period:spec.mode==="rest"?"sr":"day",type:"recoverAll"}]};
      activity.consumption.targets=[{type:"activityUses",value:"1"}];
    }
    if(spec.mode==="ritual"||spec.manual)report.incomplete.add(`${record.name}: ${ref.record.name} casting restrictions require review`);
    (system.activities??={})[_id]=activity;
  }
}
