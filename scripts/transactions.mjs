import {documentData} from "./document-data.mjs";
import {evaluatePrerequisites} from "./prerequisites.mjs";
const STATE=Symbol.for("bcc.transactions.state.v2"),active=globalThis[STATE]??=new WeakMap(),KEY=Symbol.for("bcc.transactions.v2");
const rows=a=>a?.items?.contents??Array.from(a?.items??[]);
const raw=documentData;
const fingerprint=value=>JSON.stringify((function stable(v){return Array.isArray(v)?v.map(stable):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).sort().filter(k=>!(k==="darkvision"||k==="blindsight"||k==="tremorsense"||k==="truesight")||v.ranges===undefined).map(k=>[k,stable(v[k])])):v;})(raw(value)));
export const transactionFor=actor=>active.get(actor);
export function validateTarget(actor,items,baseline=[],policyActor=actor){
  const previous=new Map(baseline.map(d=>[d._id,d]));
  for(const item of items){
    const expression=item.flags?.bcc?.prerequisiteExpression;if(!expression)continue;
    // Retaining an acquired feature is different from acquiring it again.
    const prior=previous.get(item._id);if(prior&&JSON.stringify(prior.flags?.bcc?.prerequisiteExpression)===JSON.stringify(expression))continue;
    const result=evaluatePrerequisites(expression,actor,{items:items.filter(d=>d._id!==item._id),policyActor});
    if(!result.qualified)throw Error(`${item.name}: ${result.reason}`);
  }
}
export async function withTransaction(actor,draft,operation){
  if(active.has(actor))throw Error("BCC: another document transaction is active for this Actor");
  const baseline=rows(actor).map(raw),target=rows(draft).map(raw);
  validateTarget(draft,target,baseline,actor);
  const context={baseline,target,originalClass:actor._source?.system?.details?.originalClass??actor.system?.details?.originalClass};
  active.set(actor,context);
  let successful=false;try{const result=await operation();successful=true;return result;}finally{active.delete(actor);if(successful)globalThis.Hooks?.callAll?.("bcc.itemsMaterialized",actor);}
}
export function retainedAcquisition(actor,data){const prior=active.get(actor)?.baseline.find(d=>d._id===data._id);return !!prior&&JSON.stringify(prior.flags?.bcc?.prerequisiteExpression)===JSON.stringify(data.flags?.bcc?.prerequisiteExpression);}
export function prerequisiteItems(actor,options={}){
  const context=active.get(actor);if(!context)return null;
  return (options.characterBuilderLevelUpRollback||options.characterBuilderRollback)?context.baseline:context.target;
}
export function installCommitAdapter(service,before=async()=>{}){
  if(service[KEY])return;service[KEY]=true;const commit=service.commit;
  service.commit=async function(actor,draft,...args){await before(draft);return withTransaction(actor,draft,()=>commit.call(this,actor,draft,...args));};
}
export function installBatchAdapter(cls){
  const proto=cls?.prototype;if(!proto?.createEmbeddedDocuments||proto[KEY])return;
  proto[KEY]=true;const create=proto.createEmbeddedDocuments;
  proto.createEmbeddedDocuments=async function(type,data,options={}){
    if(type!=="Item"||this.type!=="character"||this.pack)return create.call(this,type,data,options);
    const existing=active.get(this),own=!existing,baseline=rows(this).map(raw);
    const context=existing??{baseline,target:[...baseline.filter(d=>!data.some(n=>n._id===d._id)),...data.map(raw)]};
    if(own){validateTarget(this,context.target,baseline);active.set(this,context);}
    let completed=false;
    try{
      // The rollback scope is trusted only while a captured commit is active.
      if((options.characterBuilderLevelUpRollback||options.characterBuilderRollback)&&existing){
        const saved=new Map(context.baseline.map(d=>[d._id,d]));
        for(const d of data)if(!saved.has(d._id)||fingerprint(d)!==fingerprint(saved.get(d._id)))throw Error("BCC: rollback payload differs from the captured Item snapshot");
      }
      const result=await create.call(this,type,data,options);
      if((options.characterBuilderLevelUpRollback||options.characterBuilderRollback)&&existing&&typeof context.originalClass==="string"&&this.items?.get?.(context.originalClass)&&this._source?.system?.details?.originalClass!==context.originalClass){
        await this.update({"system.details.originalClass":context.originalClass},{...options,bccRestoreClassIdentity:true});
      }
      completed=true;return result;
    }finally{if(own){active.delete(this);if(completed)globalThis.Hooks?.callAll?.("bcc.itemsMaterialized",this);}}
  };
}
