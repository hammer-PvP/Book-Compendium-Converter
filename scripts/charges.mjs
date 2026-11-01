import {documentData} from './document-data.mjs';
/** Bounded additive dice expressions; unsupported operators remain explicit. */
export function chargeRange(formula){
  const text=String(formula).replace(/\s+/g,'');
  if(!/^[+-]?(?:\d*d\d+|\d+)(?:[+-](?:\d*d\d+|\d+))*$/i.test(text))return null;
  let min=0,max=0;for(const term of text.matchAll(/([+-]?)(\d*d\d+|\d+)/gi)){
    const sign=term[1]==='-'?-1:1,d=/^(\d*)d(\d+)$/i.exec(term[2]);
    const count=d?Number(d[1]||1):0,faces=d?Number(d[2]):0;if(d&&(!faces||count>1000||faces>10000))return null;
    const lo=d?count:Number(term[2]),hi=d?count*faces:Number(term[2]);min+=sign===1?lo:-hi;max+=sign===1?hi:-lo;
  }return min>=0&&Number.isSafeInteger(max)?{min,max}:null;
}
export function configureCharges(record,system,flags,report){
  if(record.charges==null)return;
  const formula=String(record.charges).replace(/\{@dice ([^}|]+).*?\}/g,'$1');
  if(!/\d*d\d+/i.test(formula))return;
  const bounds=chargeRange(formula);if(!bounds){system.uses.max='';report.incomplete.add(`${record.name}: unsupported initial charge formula ${formula}`);return;}
  const explicit=String(record.foundrySystem?.['uses.max']??'');
  const capacity=/^\d+$/.test(explicit)?Number(explicit):null;
  if(capacity!=null&&capacity<bounds.max)report.incomplete.add(`${record.name}: source initial charges exceed supplemental capacity; review required`);
  flags.initialCharges={version:1,formula,...bounds,capacity:capacity!=null&&capacity>=bounds.max?capacity:null};
  system.uses={...system.uses,max:String(flags.initialCharges.capacity??bounds.max),spent:0};
  for(const activity of Object.values(system.activities??{}))if(activity.uses?.max&&activity.consumption?.targets?.some(t=>t.type==='activityUses')){
    report.incomplete.add(`${record.name}: independent Activity charge pool and item initial charges both declared; verify pool and conditional consumption`);
    flags.chargePoolReview=true;
    flags.chargePoolSource??=[];flags.chargePoolSource.push({activity:activity._id,uses:documentData(activity.uses),consumption:documentData(activity.consumption)});
    activity.uses={max:'',spent:0,recovery:[]};activity.consumption.targets=activity.consumption.targets.filter(t=>t.type!=='activityUses');
    activity.flags??={};activity.flags.bcc={...activity.flags.bcc,manualChargeConsumption:true};
  }
}
export async function initializeCharges(data,{roll,randomId,preserve=false}={}){
  if(preserve)return data;
  const output=[];
  for(const input of data){
    const spec=input.flags?.bcc?.initialCharges;
    if(!spec||spec.initialized){output.push(input);continue;}
    const quantity=Number(input.system?.quantity??1);
    if(!Number.isInteger(quantity)||quantity<1||quantity>1000)throw Error(`${input.name}: invalid charged-item quantity`);
    for(let unit=0;unit<quantity;unit++){
      const copy=documentData(input),value=Number(await roll(spec.formula));
      if(!Number.isInteger(value)||value<spec.min||value>spec.max)throw Error(`${input.name}: invalid initial charge result`);
      if(unit)copy._id=randomId();copy.system.quantity=1;copy.system.uses.max=String(spec.capacity??value);copy.system.uses.spent=spec.capacity==null?0:spec.capacity-value;
      copy.flags.bcc.initialCharges={...spec,initialized:true,result:value};output.push(copy);
    }
  }return output;
}
const KEY=Symbol.for('bcc.charges.runtime.v1');
export function registerChargeRuntime(){
  if(globalThis[KEY])return;globalThis[KEY]=true;
  const install=()=>{const cls=globalThis.CONFIG?.Actor?.documentClass,proto=cls?.prototype;if(!proto?.createEmbeddedDocuments)return;
    const initialize=(data,options={})=>initializeCharges(data,{preserve:!!(options.characterBuilderRollback||options.characterBuilderLevelUpRollback||options.bccPreserveCharges),roll:async formula=>(await new Roll(formula).evaluate()).total,randomId:()=>foundry.utils.randomID()});
    const itemClass=globalThis.Item?.implementation??globalThis.CONFIG?.Item?.documentClass;
    if(typeof itemClass?.createDocuments==='function'){const create=itemClass.createDocuments;itemClass.createDocuments=async function(data,options={}){return create.call(this,options.pack?data:await initialize(data,options),options);};}
    if(typeof cls.createDocuments==='function'){const create=cls.createDocuments;cls.createDocuments=async function(data,options={}){const output=options.pack?data:await Promise.all(data.map(async row=>row.items?{...row,items:await initialize(row.items,options)}:row));return create.call(this,output,options);};}
    const original=proto.createEmbeddedDocuments;
    proto.createEmbeddedDocuments=async function(type,data,options={}){
      if(type==='Item'&&!this.pack)data=await initializeCharges(data,{preserve:!!(options.characterBuilderRollback||options.characterBuilderLevelUpRollback||options.bccPreserveCharges),roll:async formula=>(await new Roll(formula).evaluate()).total,randomId:()=>foundry.utils.randomID()});
      return original.call(this,type,data,options);
    };
  };if(game.ready)install();else Hooks.once('ready',install);
}
