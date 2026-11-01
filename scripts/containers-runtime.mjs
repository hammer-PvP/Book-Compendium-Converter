import {documentData} from "./document-data.mjs";
const KEY=Symbol.for("bcc.containers.runtime.v1");
/** Native containers have quantity 1. Consumers may request several units in a
 * transformer; split each unit and its contents before document creation. */
export function splitContainerInstances(data,randomId){
  const out=[...data];
  for(const root of out){
    const quantity=Number(root.system?.quantity??1);
    if(root.type!=="container"||!root.flags?.bcc||quantity<=1)continue;
    if(!Number.isInteger(quantity)||quantity>1000)throw Error(`${root.name}: invalid container quantity`);
    root.system.quantity=1;
    const tree=[root];for(let at=0;at<tree.length;at++)for(const child of out)if(child.system?.container===tree[at]._id&&!tree.includes(child))tree.push(child);
    for(let n=1;n<quantity;n++){
      const ids=new Map(tree.map(d=>[d._id,randomId()]));
      for(const doc of tree){const copy=documentData(doc);copy._id=ids.get(doc._id);if(ids.has(copy.system?.container))copy.system.container=ids.get(copy.system.container);out.push(copy);}
    }
  }
  return out;
}
export function registerContainerRuntime(){
  if(globalThis[KEY])return;globalThis[KEY]=true;
  const install=()=>{const cls=globalThis.Item?.implementation??globalThis.CONFIG?.Item?.documentClass;if(typeof cls?.createWithContents!=="function")return;
    const original=cls.createWithContents;cls.createWithContents=async function(...args){const data=await original.apply(this,args);return data?splitContainerInstances(data,()=>foundry.utils.randomID()):data;};
  };
  if(game.ready)install();else Hooks.once("ready",install);
}
