import {stableId} from "./hash.mjs";
/** Native containers reference sibling Item documents, not embedded Items.
 * Materialize independent contents per bundle; leave catalog templates intact. */
export async function materializeBundles(index,lookup){
  index.bundleIssues=[];
  const templates=index.all.filter(e=>e.kind==="item"&&e.record.packContents?.length);
  async function contents(owner,parent,path,ancestry){
    for(const [i,raw] of owner.record.packContents.entries()){
      const spec=typeof raw==="string"?{item:raw}:raw,quantity=Number(spec.quantity??1);
      let ref=spec.item?lookup(index,"item",spec.item,owner.record.source):null;
      if(!ref&&typeof spec.special==="string"&&spec.special.trim()){
        const matches=index.all.filter(e=>e.kind==="item"&&!e.record._bccBundleInstance&&e.record.name.toLowerCase()===spec.special.toLowerCase()&&e.record.source===owner.record.source);
        ref=matches.length===1?matches[0]:{kind:"item",packId:owner.packId,key:`${owner.key}:literal:${i}`,record:{name:spec.special,source:owner.record.source,page:owner.record.page,_bccRules:owner.record._bccRules,type:"G",entries:[spec.special],_bccPackLiteral:true}};
      }
      if(!ref||ref.virtual||!Number.isInteger(quantity)||quantity<1){index.bundleIssues.push(`${owner.record.name}: missing/invalid pack component ${spec.item}`);continue;}
      if(ancestry.has(ref.key)){index.bundleIssues.push(`${owner.record.name}: circular pack component ${spec.item}`);continue;}
      const instances=ref.record.packContents?.length||ref.record.containerCapacity||String(ref.record.type).split("|")[0]==="C"?quantity:1;
      if(instances>1000||index.all.length+instances>30000){index.bundleIssues.push(`${owner.record.name}: pack expansion exceeds the supported safety limit`);continue;}
      for(let n=0;n<instances;n++){
        const key=`${path}:${i}:${n}:${ref.key}`,_id=await stableId(key),record=structuredClone(ref.record);
        record._bccBundleInstance={parentId:parent._id,template:ref.uuid,quantity:instances===1?quantity:1};
        const child={...ref,key,_id,record,uuid:`Compendium.${ref.packId}.Item.${_id}`};index.byKey.set(key,child);index.all.push(child);
        if(record.packContents?.length)await contents(child,child,key,new Set([...ancestry,ref.key]));
      }
    }
  }
  for(const root of templates)await contents(root,root,`${root.key}:contents`,new Set([root.key]));
  function weight(entry){
    if(!entry.record.packContents?.length)return Number(entry.record.weight??0)*Number(entry.record._bccBundleInstance?.quantity??1);
    const total=index.all.filter(e=>e.record._bccBundleInstance?.parentId===entry._id).reduce((n,c)=>n+weight(c),0),declared=Number(entry.record.weight??0);
    entry.record._bccBundleWeight=Math.max(0,declared-total);entry.record._bccBundleOverweight=entry.record.weight!=null&&total>declared+0.01;
    return total+entry.record._bccBundleWeight;
  }
  for(const root of templates)weight(root);
}
export function applyBundleData(record,system,flags,report,index){
  if(record.packContents?.length){
    system.weight={value:record._bccBundleWeight??0,units:"lb"};
    flags.bundle={version:1,declaredWeight:record.weight??null,declaredPrice:record.value==null?null:record.value/100,priceIncludesContents:true};
    // This is a grouping container, not another physical backpack. The source's
    // actual backpack remains one independent component with its own weight.
    if(!record.containerCapacity)delete system.capacity;
    for(const issue of index.bundleIssues??[])report.unresolved.add(issue);
    if(record._bccBundleOverweight)report.incomplete.add(`${record.name}: component weights exceed the declared package weight; component data retained`);
    if(record._bccBundleWeight)report.information.add(`${record.name}: ${record._bccBundleWeight} lb of declared package weight retained on the grouping container, rather than invented per-component weights`);
  }
  if(record._bccBundleInstance){system.container=record._bccBundleInstance.parentId;system.quantity=record._bccBundleInstance.quantity;flags.bundleComponent=record._bccBundleInstance;}
  if(record._bccPackLiteral){flags.sourceLiteral=true;report.incomplete.add(`${record.name}: literal package component has no standalone source statistics; name and quantity retained`);}
}
